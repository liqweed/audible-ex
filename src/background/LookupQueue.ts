/**
 * The lookup queue (ARCHITECTURE.md §4): the one place a book is looked up, for every tab. The
 * userscript's `ratingFor`, `detailsFor`, `grQueued` and `pumpGr`.
 *
 * - **Dedupe.** One lookup per ASIN and one details read per Goodreads book id is in flight at a
 *   time, however many ports ask; later askers wait for the same result. The shared work runs in the
 *   layer's scope, not in the asker's fibre, so a tab that goes away does not cancel what another
 *   tab is waiting for (the cache keeps the result for the next one).
 * - **Pace.** Every Goodreads request, search and book page, is a job. Three workers take jobs, and a
 *   worker holds 250 ms after each job before it takes the next. Ratings go before details. The
 *   Audible catalogue is batched by `AudibleCatalog` itself and takes no permit. A search that
 *   needs the author query makes its two requests back to back, as the userscript's does.
 * - **Back off.** A `RateLimited` from any job pauses every worker: 5 s, 10 s, 20 s … up to 2 min,
 *   raised to `Retry-After` (`src/core/backoff.ts`), and starts again at 5 s after a success. The job
 *   that was limited runs again after the pause, up to `MAX_RATE_LIMIT_RETRIES` times, and then
 *   fails with `RateLimited`. Responses to requests that were already in flight when the pause began
 *   count once, not once per worker.
 * - **Break.** After `BREAKER_THRESHOLD` failures in a row the circuit breaker stops all Goodreads
 *   traffic for `BREAKER_COOLDOWN_MS` (`src/core/breaker.ts`). Jobs that reach it meanwhile fail at
 *   once with `CircuitOpen` instead of waiting, and the content script's Retry runs them again. When
 *   the cooldown is over one job goes through as a probe and the rest wait for its verdict.
 *
 * Cache trouble never fails a lookup: a read that fails is a miss, a write that fails loses only the
 * caching. Failed lookups are never cached.
 */

import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import { clampRetryAfter, pauseMs } from '../core/backoff'
import {
  admission,
  BREAKER_CLOSED,
  type BreakerState,
  onFailure,
  onSuccess,
  releaseProbe,
  startProbe,
} from '../core/breaker'
import type { RegionCode } from '../core/regions'
import type { Details } from '../schema/common'
import { AudibleCatalog, type AudibleCatalogError } from './AudibleCatalog'
import { BookCache, type CacheError } from './BookCache'
import {
  CircuitOpen,
  type FormatChanged,
  type HttpError,
  type RateLimited,
} from './errors'
import { Goodreads, type GoodreadsError } from './Goodreads'

/** At most this many Goodreads requests are in flight (D9). */
export const GOODREADS_WORKERS = 3

/** What a worker holds after each job before it takes the next (D9). */
export const REQUEST_GAP = Duration.millis(250)

/**
 * How many times a job that was rate-limited runs again after the pause. With the backoff that is
 * waits of 5 s, 10 s and 20 s (at least) before the job gives up with `RateLimited`.
 */
export const MAX_RATE_LIMIT_RETRIES = 3

/** Everything that can fail a lookup. Cache errors are absorbed and are not among them. */
export type LookupError = AudibleCatalogError | GoodreadsError | CircuitOpen

/** The Goodreads book chosen for an ASIN, or that there is none. */
export type RatingResult =
  | { readonly _tag: 'Miss' }
  | {
      readonly _tag: 'Found'
      readonly bookId: string
      readonly r: number
      readonly n: number
      readonly url: string
      readonly loose: boolean
    }

export interface RatingRequest {
  readonly region: RegionCode
  readonly asin: string
  /** Seen in Library or Wish List: records the pin even when the rating is already cached. */
  readonly pinned: boolean
}

export interface LookupQueueService {
  /** Validate a manual choice through the same workers, then save it atomically. */
  readonly correct: (
    asin: string,
    bookId: string
  ) => Effect.Effect<void, LookupError | CacheError>

  /**
   * The rating of `request.asin`: from the cache at once, otherwise looked up (Audible metadata,
   * then the Goodreads search through the queue) and cached. `onMiss` runs before the wait when the
   * cache did not have it, so the caller can say "loading"; it does not run on a cache hit.
   */
  readonly rating: (
    request: RatingRequest,
    onMiss?: Effect.Effect<void>
  ) => Effect.Effect<RatingResult, LookupError>
  /**
   * Genres, year and overview of a Goodreads book: from the cache at once, otherwise read from the
   * book page through the queue, after any waiting ratings. `onMiss` is as for `rating`.
   */
  readonly details: (
    bookId: string,
    onMiss?: Effect.Effect<void>
  ) => Effect.Effect<typeof Details.Type, LookupError>
  /** When the current rate-limit pause ends (epoch milliseconds), or none when traffic is not paused. */
  readonly pausedUntil: Effect.Effect<Option.Option<number>>
  /**
   * The ASINs whose Goodreads search is running right now (a request is out), for every tab; the
   * progress counters tell these from the lookups still waiting.
   */
  readonly running: Effect.Effect<ReadonlySet<string>>
}

/** Ratings run before details (the userscript's `grQueue` before `grLowQueue`). */
type Lane = 'rating' | 'details'

/** A Goodreads request waiting for a worker. */
interface Job {
  readonly run: Effect.Effect<unknown, GoodreadsError>
  readonly finish: (
    exit: Exit.Exit<unknown, GoodreadsError | CircuitOpen>
  ) => Effect.Effect<void>
}

/** What a worker was cleared to do for one attempt. */
type Clearance =
  | { readonly kind: 'rejected'; readonly error: CircuitOpen }
  | {
      readonly kind: 'go'
      /** This attempt is the half-open breaker's probe. */
      readonly probe: boolean
      /** The pause generation when the attempt started (see `settle`). */
      readonly generation: number
    }

const make = Effect.gen(function* () {
  const cache = yield* BookCache
  const catalog = yield* AudibleCatalog
  const goodreads = yield* Goodreads
  const scope = yield* Effect.scope

  // ---------- state shared by the workers ----------
  // Plain variables: every change is synchronous, so no two fibres interleave inside one.
  let pausedUntil = 0
  /** Counts rate-limit pauses that were started; an attempt that began before one is "stale". */
  let generation = 0
  /** Rate-limit pauses in a row since the last fresh success: the exponent of the backoff. */
  let step = 0
  let breaker: BreakerState = BREAKER_CLOSED
  let lastFailure: HttpError | RateLimited | FormatChanged | undefined
  let probeSettled: Deferred.Deferred<void> | undefined

  const lanes: Record<Lane, Job[]> = { rating: [], details: [] }
  /** One token per waiting job; a worker takes a token, then the first job of the best lane. */
  const tokens = yield* Queue.unbounded<void>()

  /** Asks the breaker and the pause what an attempt may do now; waits as long as it must. */
  const clearance: Effect.Effect<Clearance> = Effect.gen(function* () {
    while (true) {
      const now = yield* Clock.currentTimeMillis
      const verdict = admission(breaker, now)
      if (verdict === 'reject' && lastFailure !== undefined) {
        return {
          kind: 'rejected',
          error: new CircuitOpen({
            lastFailure,
            reopensAt: breaker.openUntil ?? now,
          }),
        } as const
      }
      if (verdict === 'wait') {
        yield* probeSettled ? Deferred.await(probeSettled) : Effect.yieldNow
        continue
      }
      if (now < pausedUntil) {
        yield* Effect.sleep(pausedUntil - now)
        continue
      }
      // Nothing above yielded since `admission`, so the probe is claimed by exactly one job.
      const probe = verdict === 'probe'
      if (probe) {
        breaker = startProbe(breaker)
        probeSettled = Deferred.makeUnsafe<void>()
      }
      return { kind: 'go', probe, generation } as const
    }
  })

  /**
   * Accounts for the outcome of one attempt and says whether the job should run again. A
   * `RateLimited` that arrives after another job already started a pause since this attempt began
   * (`stale`) adds no step to the backoff and no failure to the breaker: it is the same incident.
   */
  const settle = (
    go: Extract<Clearance, { kind: 'go' }>,
    exit: Exit.Exit<unknown, GoodreadsError>,
    retries: number
  ): Effect.Effect<'done' | 'retry'> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const stale = go.generation !== generation
      let outcome: 'done' | 'retry' = 'done'

      if (Exit.isSuccess(exit)) {
        if (go.probe || !stale) breaker = onSuccess()
        if (!stale) step = 0
      } else {
        const failure = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
        if (failure?._tag === 'RateLimited') {
          const asked =
            failure.retryAfter === undefined
              ? undefined
              : Duration.toMillis(failure.retryAfter)
          if (stale) {
            pausedUntil = Math.max(pausedUntil, now + clampRetryAfter(asked))
            breaker = go.probe ? releaseProbe(breaker) : breaker
          } else {
            generation++
            step++
            pausedUntil = Math.max(pausedUntil, now + pauseMs(step, asked))
            breaker = onFailure(breaker, now)
            lastFailure = failure
          }
          if (retries < MAX_RATE_LIMIT_RETRIES) outcome = 'retry'
        } else if (failure !== undefined) {
          breaker = onFailure(breaker, now)
          lastFailure = failure
        } else if (go.probe) {
          // A defect or an interruption says nothing about Goodreads; let the next job probe.
          breaker = releaseProbe(breaker)
        }
      }

      if (go.probe) {
        const settled = probeSettled
        probeSettled = undefined
        if (settled) yield* Deferred.done(settled, Exit.void)
      }
      return outcome
    })

  /** Runs one job to its end, trying again after a rate-limit pause. */
  const runJob = (job: Job) =>
    Effect.gen(function* () {
      let retries = 0
      while (true) {
        const cleared = yield* clearance
        if (cleared.kind === 'rejected') {
          // No request was made, so the worker owes no gap.
          return { exit: Exit.fail(cleared.error), requested: false }
        }
        const exit = yield* Effect.exit(job.run)
        const next = yield* settle(cleared, exit, retries)
        if (next === 'done') return { exit, requested: true }
        retries++
        yield* Effect.sleep(REQUEST_GAP)
      }
    })

  const worker = Effect.forever(
    Effect.gen(function* () {
      yield* Queue.take(tokens)
      const job = lanes.rating.shift() ?? lanes.details.shift()
      if (!job) return
      const { exit, requested } = yield* runJob(job)
      yield* job.finish(exit)
      if (requested) yield* Effect.sleep(REQUEST_GAP)
    })
  )
  for (let i = 0; i < GOODREADS_WORKERS; i++) {
    yield* Effect.forkIn(worker, scope)
  }

  /** Queues a Goodreads request and waits for its result. Every Goodreads call goes through here. */
  const submit = <A>(
    lane: Lane,
    run: Effect.Effect<A, GoodreadsError>
  ): Effect.Effect<A, GoodreadsError | CircuitOpen> =>
    Effect.suspend(() => {
      const done = Deferred.makeUnsafe<A, GoodreadsError | CircuitOpen>()
      lanes[lane].push({
        run,
        // The queue only ever completes a job with the exit of its own `run`.
        finish: exit =>
          Deferred.done(
            done,
            exit as Exit.Exit<A, GoodreadsError | CircuitOpen>
          ),
      })
      Queue.offerUnsafe(tokens, undefined)
      return Deferred.await(done)
    })

  // ---------- dedupe ----------
  /**
   * Runs `work` once per `key` at a time. The work is forked into the layer's scope, so the first
   * asker going away does not cancel it for the others.
   */
  const shared = <A, E>(
    inFlight: Map<string, Deferred.Deferred<A, E>>,
    key: string,
    work: Effect.Effect<A, E>
  ): Effect.Effect<A, E> =>
    Effect.suspend(() => {
      const running = inFlight.get(key)
      if (running) return Deferred.await(running)
      const deferred = Deferred.makeUnsafe<A, E>()
      inFlight.set(key, deferred)
      return work.pipe(
        Effect.exit,
        Effect.flatMap(exit =>
          Effect.suspend(() => {
            inFlight.delete(key)
            return Deferred.done(deferred, exit)
          })
        ),
        Effect.forkIn(scope),
        Effect.andThen(Deferred.await(deferred))
      )
    })

  // ---------- cache that never fails a lookup ----------
  const soft = <A>(
    operation: string,
    effect: Effect.Effect<A, CacheError>,
    fallback: A
  ): Effect.Effect<A> =>
    effect.pipe(
      Effect.catch(error =>
        Effect.logWarning(
          `Book cache ${operation} failed; carrying on without it`,
          error
        ).pipe(Effect.as(fallback))
      )
    )

  const manual = (asin: string) =>
    soft('read', cache.getOverride(asin), Option.none())
  const cachedRating = (asin: string) =>
    Effect.gen(function* () {
      const rating = yield* soft('read', cache.getRating(asin), Option.none())
      const override = yield* manual(asin)
      return Option.filter(
        rating,
        r =>
          Option.isNone(override) ||
          (r._tag === 'Found' && r.bookId === override.value.bookId)
      )
    })

  const cachedDetails = (bookId: string) =>
    soft('read', cache.getDetails(bookId), Option.none()).pipe(
      Effect.map(
        Option.map(({ genres, year, desc }): typeof Details.Type => ({
          genres,
          year,
          desc,
        }))
      )
    )

  // ---------- the lookup of one ASIN ----------
  const runningRatings = new Set<string>()

  /** Marks `asin` as running for as long as one attempt of its search runs (not while it waits). */
  const whileRunning = <A, E>(asin: string, search: Effect.Effect<A, E>) =>
    Effect.suspend(() => {
      runningRatings.add(asin)
      return search
    }).pipe(Effect.ensuring(Effect.sync(() => runningRatings.delete(asin))))

  const metaFor = (region: RegionCode, asin: string) =>
    Effect.gen(function* () {
      const cached = yield* soft('read', cache.getMeta(asin), Option.none())
      if (Option.isSome(cached)) {
        return { title: cached.value.title, author: cached.value.author }
      }
      const meta = yield* catalog.lookup(region, asin)
      // Public prices are page-local and must never take the metadata cache's 30-day lifetime.
      const { title, author } = meta
      yield* soft('write', cache.setMeta({ asin, title, author }), undefined)
      return meta
    })

  const ratingFlow = ({
    region,
    asin,
  }: RatingRequest): Effect.Effect<RatingResult, LookupError> =>
    Effect.gen(function* () {
      // Asked again here: another asker may have stored it since the caller looked.
      const stored = yield* cachedRating(asin)
      if (Option.isSome(stored)) return stored.value as RatingResult

      const override = yield* manual(asin)
      if (Option.isSome(override)) {
        const bookId = override.value.bookId
        const book = yield* submit(
          'rating',
          whileRunning(asin, goodreads.book(bookId))
        )
        yield* soft(
          'write',
          cache.setDetails({ bookId, ...book.details }),
          undefined
        )
        yield* soft(
          'write',
          cache.setRating({ asin, _tag: 'Found', bookId, ...book.rating }),
          undefined
        )
        const latest = yield* manual(asin)
        if (Option.isSome(latest) && latest.value.bookId !== bookId)
          return yield* ratingFlow({ region, asin, pinned: false })
        return { _tag: 'Found', bookId, ...book.rating } as const
      }
      const meta = yield* metaFor(region, asin)
      const match = yield* submit(
        'rating',
        whileRunning(asin, goodreads.search(meta))
      )
      const result: RatingResult = Option.isNone(match)
        ? { _tag: 'Miss' }
        : {
            _tag: 'Found',
            bookId: match.value.bookId,
            r: match.value.rating,
            n: match.value.count,
            url: match.value.url,
            loose: match.value.loose,
          }
      yield* soft('write', cache.setRating({ asin, ...result }), undefined)
      // A correction may have completed while the automatic search was in flight.
      const latest = yield* manual(asin)
      if (Option.isSome(latest))
        return yield* ratingFlow({ region, asin, pinned: false })
      return result
    })

  const detailsFlow = (bookId: string) =>
    Effect.gen(function* () {
      const stored = yield* cachedDetails(bookId)
      if (Option.isSome(stored)) return stored.value

      const details = yield* submit('details', goodreads.details(bookId))
      yield* soft('write', cache.setDetails({ bookId, ...details }), undefined)
      return details
    })

  const ratingsInFlight = new Map<
    string,
    Deferred.Deferred<RatingResult, LookupError>
  >()
  const detailsInFlight = new Map<
    string,
    Deferred.Deferred<typeof Details.Type, LookupError>
  >()

  return LookupQueue.of({
    correct: (asin, bookId) =>
      Effect.gen(function* () {
        const book = yield* submit('rating', goodreads.book(bookId))
        yield* cache.correct(
          { _tag: 'Found', asin, bookId, ...book.rating },
          { bookId, ...book.details }
        )
      }),
    rating: (request, onMiss = Effect.void) =>
      Effect.gen(function* () {
        if (request.pinned) {
          yield* soft('pin', cache.pin(request.asin), undefined)
        }
        const stored = yield* cachedRating(request.asin)
        if (Option.isSome(stored)) return stored.value as RatingResult
        yield* onMiss
        return yield* shared(ratingsInFlight, request.asin, ratingFlow(request))
      }),
    details: (bookId, onMiss = Effect.void) =>
      Effect.gen(function* () {
        const stored = yield* cachedDetails(bookId)
        if (Option.isSome(stored)) return stored.value
        yield* onMiss
        return yield* shared(detailsInFlight, bookId, detailsFlow(bookId))
      }),
    pausedUntil: Effect.map(Clock.currentTimeMillis, now =>
      now < pausedUntil ? Option.some(pausedUntil) : Option.none()
    ),
    running: Effect.sync(() => new Set(runningRatings)),
  })
})

export class LookupQueue extends Context.Service<
  LookupQueue,
  LookupQueueService
>()('audible-ex/LookupQueue') {
  /**
   * The queue over the cache, the catalogue and Goodreads. Its workers and any lookup in flight
   * stop with the layer's scope.
   */
  static layer: Layer.Layer<
    LookupQueue,
    never,
    BookCache | AudibleCatalog | Goodreads
  > = Layer.effect(LookupQueue, make)
}
