import { describe, expect, test } from 'bun:test'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Option from 'effect/Option'
import { TestClock } from 'effect/testing'
import { RETRY_AFTER_MAX_MS } from '../core/backoff'
import { BREAKER_COOLDOWN_MS, BREAKER_THRESHOLD } from '../core/breaker'
import {
  CircuitOpen,
  FormatChanged,
  HttpError,
  NoMetadata,
  RateLimited,
} from './errors'
import {
  GOODREADS_WORKERS,
  type LookupError,
  LookupQueue,
  type LookupQueueService,
  MAX_RATE_LIMIT_RETRIES,
  type RatingResult,
  REQUEST_GAP,
} from './LookupQueue'
import {
  asin,
  type Behaviour,
  type Call,
  detailsFor,
  fakes,
  type Latch,
  latch,
  type MemoryCache,
  matchFor,
  memoryCache,
  settle,
} from './LookupTest'

const GAP = Duration.toMillis(REQUEST_GAP)
const URL = 'https://www.goodreads.com/book/auto_complete'

const limited = (retryAfter?: Duration.Duration) =>
  new RateLimited({ status: 429, url: URL, retryAfter })
const httpError = () =>
  new HttpError({ status: 500, url: URL, cause: undefined })

interface Scenario {
  readonly queue: LookupQueueService
  readonly calls: Call[]
  readonly cache: MemoryCache
  /** The `at` of each Goodreads search so far. */
  readonly searches: () => number[]
  /** Starts a rating lookup for book `n` in the background and lets it run as far as it can. */
  readonly ask: (
    n: number
  ) => Effect.Effect<Fiber.Fiber<RatingResult, LookupError>>
}

/** Runs `body` against a queue over fake services, on a `TestClock`. */
const scenario = (
  name: string,
  behaviour: Behaviour,
  body: (s: Scenario) => Effect.Effect<void, unknown>,
  cacheOptions: { broken?: boolean } = {}
) =>
  test(name, () => {
    const cache = memoryCache(cacheOptions)
    const fake = fakes(behaviour)
    const layer = LookupQueue.layer.pipe(
      Layer.provide(Layer.merge(cache.layer, fake.layer)),
      Layer.provideMerge(TestClock.layer())
    )
    return Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* LookupQueue
        yield* body({
          queue,
          calls: fake.calls,
          cache,
          searches: () =>
            fake.calls.filter(c => c.kind === 'search').map(c => c.at),
          ask: n =>
            Effect.forkChild(
              queue.rating({ region: 'US', asin: asin(n), pinned: false })
            ).pipe(Effect.tap(() => settle)),
        })
      }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(Logger.layer([])))))
    )
  })

const finished = (fiber: Fiber.Fiber<unknown, unknown>) =>
  fiber.pollUnsafe() !== undefined

/** The failure of a fibre, as a value. */
const failureOf = (fiber: Fiber.Fiber<unknown, unknown>) =>
  Effect.flip(Fiber.join(fiber))

/** A search that holds each book until its latch opens. */
const holding = (holds: Record<number, Latch>): Behaviour => ({
  search: n =>
    (holds[n]?.wait ?? Effect.void).pipe(Effect.as(Option.some(matchFor(n)))),
})

describe('LookupQueue.rating', () => {
  scenario('answers a cached rating at once, with no request', {}, s =>
    Effect.gen(function* () {
      s.cache.ratings.set(asin(1), {
        _tag: 'Found',
        asin: asin(1),
        savedAt: 0,
        ...matchFor(1),
        r: 4.5,
        n: 10,
      })
      let missed = false
      const rating = yield* s.queue.rating(
        { region: 'US', asin: asin(1), pinned: false },
        Effect.sync(() => {
          missed = true
        })
      )
      expect(rating._tag).toBe('Found')
      expect(missed).toBe(false)
      expect(s.calls).toEqual([])
    })
  )

  scenario(
    'looks an uncached book up, caches it, and runs onMiss first',
    {},
    s =>
      Effect.gen(function* () {
        const order: string[] = []
        const fiber = yield* Effect.forkChild(
          s.queue.rating(
            { region: 'US', asin: asin(1), pinned: false },
            Effect.sync(() => order.push('miss'))
          )
        )
        const rating = yield* Fiber.join(fiber)
        expect(order).toEqual(['miss'])
        expect(rating).toEqual({
          _tag: 'Found',
          bookId: matchFor(1).bookId,
          r: 4.25,
          n: 1234,
          url: matchFor(1).url,
          loose: false,
        })
        expect(s.cache.ratings.get(asin(1))?._tag).toBe('Found')
        expect(s.cache.meta.get(asin(1))?.title).toBe(`Title ${asin(1)}`)
        expect(s.calls.map(c => c.kind)).toEqual(['catalog', 'search'])
      })
  )

  scenario('uses cached metadata instead of asking Audible again', {}, s =>
    Effect.gen(function* () {
      s.cache.meta.set(asin(1), {
        asin: asin(1),
        savedAt: 0,
        title: `Title ${asin(1)}`,
        author: 'Someone',
      })
      yield* Fiber.join(yield* s.ask(1))
      expect(s.calls.map(c => c.kind)).toEqual(['search'])
    })
  )

  scenario(
    'stores a book that is not on Goodreads as a miss',
    {
      search: () => Effect.succeedNone,
    },
    s =>
      Effect.gen(function* () {
        const result = yield* Fiber.join(yield* s.ask(1))
        expect(result).toEqual({ _tag: 'Miss' })
        expect(s.cache.ratings.get(asin(1))?._tag).toBe('Miss')
      })
  )

  scenario('records a pin even when the rating is cached', {}, s =>
    Effect.gen(function* () {
      s.cache.ratings.set(asin(1), { _tag: 'Miss', asin: asin(1), savedAt: 0 })
      yield* s.queue.rating({ region: 'US', asin: asin(1), pinned: true })
      yield* s.queue
        .rating({ region: 'US', asin: asin(2), pinned: false })
        .pipe(Effect.forkChild)
      expect(s.cache.pins).toEqual([asin(1)])
    })
  )

  scenario(
    'fails with NoMetadata without touching Goodreads, and caches nothing',
    {
      catalog: a => Effect.fail(new NoMetadata({ asin: a })),
    },
    s =>
      Effect.gen(function* () {
        const error = yield* failureOf(yield* s.ask(1))
        expect(error).toBeInstanceOf(NoMetadata)
        expect(s.calls.map(c => c.kind)).toEqual(['catalog'])
        expect(s.cache.ratings.size).toBe(0)
      })
  )

  scenario(
    'does not cache a failure: the next ask looks again',
    {
      search: (n, call) =>
        call === 1
          ? Effect.fail(
              new FormatChanged({ source: 'autocomplete', detail: 'x' })
            )
          : Effect.succeedSome(matchFor(n)),
    },
    s =>
      Effect.gen(function* () {
        const error = yield* failureOf(yield* s.ask(1))
        expect(error).toBeInstanceOf(FormatChanged)
        expect(s.cache.ratings.size).toBe(0)
        yield* TestClock.adjust(GAP)
        const again = yield* Fiber.join(yield* s.ask(1))
        expect(again._tag).toBe('Found')
        expect(s.searches()).toHaveLength(2)
      })
  )

  scenario(
    'carries on when the cache cannot be read or written',
    {},
    s =>
      Effect.gen(function* () {
        const rating = yield* s.queue.rating({
          region: 'US',
          asin: asin(1),
          pinned: true,
        })
        expect(rating._tag).toBe('Found')
        expect(yield* s.queue.details('1001')).toEqual(detailsFor(1))
      }),
    { broken: true }
  )
})

describe('LookupQueue dedupe', () => {
  const gate = latch()

  scenario(
    'two askers for one ASIN cause one lookup and both get the result',
    {
      search: n => gate.wait.pipe(Effect.as(Option.some(matchFor(n)))),
    },
    s =>
      Effect.gen(function* () {
        const first = yield* s.ask(1)
        const second = yield* s.ask(1)
        yield* settle
        yield* gate.open
        const [a, b] = [yield* Fiber.join(first), yield* Fiber.join(second)]
        expect(a).toEqual(b)
        expect(s.calls.filter(c => c.kind === 'catalog')).toHaveLength(1)
        expect(s.searches()).toHaveLength(1)
      })
  )

  scenario(
    'the first asker going away does not cancel the lookup for the second',
    {
      search: n => gate.wait.pipe(Effect.as(Option.some(matchFor(n)))),
    },
    s =>
      Effect.gen(function* () {
        const first = yield* s.ask(1)
        const second = yield* s.ask(1)
        yield* settle
        yield* Fiber.interrupt(first)
        yield* gate.open
        const result = yield* Fiber.join(second)
        expect((result as { _tag: string })._tag).toBe('Found')
        expect(s.searches()).toHaveLength(1)
      })
  )

  const bookGate = latch()
  scenario(
    'two askers for one book id cause one book-page read',
    {
      details: () => bookGate.wait.pipe(Effect.as(detailsFor(7))),
    },
    s =>
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(s.queue.details('1007'))
        const second = yield* Effect.forkChild(s.queue.details('1007'))
        yield* settle
        yield* bookGate.open
        expect(yield* Fiber.join(first)).toEqual(detailsFor(7))
        expect(yield* Fiber.join(second)).toEqual(detailsFor(7))
        expect(s.calls.filter(c => c.kind === 'details')).toHaveLength(1)
        expect(s.cache.details.get('1007')?.year).toBe(2007)
      })
  )

  scenario('details already cached are answered with no request', {}, s =>
    Effect.gen(function* () {
      s.cache.details.set('1007', {
        bookId: '1007',
        savedAt: 0,
        ...detailsFor(7),
      })
      expect(yield* s.queue.details('1007')).toEqual(detailsFor(7))
      expect(s.calls).toEqual([])
    })
  )
})

describe('LookupQueue pacing', () => {
  scenario(
    'holds each worker 250 ms after a job before it takes the next',
    {},
    s =>
      Effect.gen(function* () {
        const fibers = []
        for (let n = 1; n <= 7; n++) fibers.push(yield* s.ask(n))
        yield* settle
        expect(s.searches()).toEqual([0, 0, 0])
        yield* TestClock.adjust(GAP - 1)
        expect(s.searches()).toHaveLength(3)
        yield* TestClock.adjust(1)
        expect(s.searches()).toEqual([0, 0, 0, GAP, GAP, GAP])
        yield* TestClock.adjust(GAP)
        expect(s.searches()).toEqual([0, 0, 0, GAP, GAP, GAP, 2 * GAP])
        for (const f of fibers) yield* Fiber.join(f)
      })
  )

  test('runs at most 3 requests at a time', () => {
    const gateAll = latch()
    let active = 0
    let peak = 0
    const fake = fakes({
      search: n =>
        Effect.gen(function* () {
          active++
          peak = Math.max(peak, active)
          yield* gateAll.wait
          active--
          return Option.some(matchFor(n))
        }),
    })
    return Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* LookupQueue
        const fibers = []
        for (let n = 1; n <= 8; n++) {
          fibers.push(
            yield* Effect.forkChild(
              queue.rating({ region: 'US', asin: asin(n), pinned: false })
            )
          )
        }
        yield* settle
        expect(active).toBe(GOODREADS_WORKERS)
        yield* gateAll.open
        for (let i = 0; i < 4; i++) yield* TestClock.adjust(GAP)
        for (const f of fibers) yield* Fiber.join(f)
        expect(peak).toBe(GOODREADS_WORKERS)
      }).pipe(
        Effect.provide(
          LookupQueue.layer.pipe(
            Layer.provide(Layer.merge(memoryCache().layer, fake.layer)),
            Layer.provideMerge(TestClock.layer())
          )
        )
      )
    )
  })

  const holds = { 1: latch(), 2: latch(), 3: latch() }
  scenario(
    'serves ratings before details, however they were queued',
    holding(holds),
    s =>
      Effect.gen(function* () {
        yield* s.ask(1)
        yield* s.ask(2)
        yield* s.ask(3)
        yield* settle
        // All three workers are busy. A book page is queued first, then a rating.
        const page = yield* Effect.forkChild(s.queue.details('1009'))
        const rating = yield* s.ask(4)
        yield* settle
        expect(s.calls.map(c => c.kind)).not.toContain('details')

        // One worker frees up: it takes the rating, though the page was queued first.
        yield* holds[1].open
        yield* TestClock.adjust(GAP)
        expect(s.searches()).toHaveLength(4)
        expect(s.calls.map(c => c.kind)).not.toContain('details')

        // The next one free takes the page.
        yield* holds[2].open
        yield* TestClock.adjust(GAP)
        expect(s.calls.at(-1)).toMatchObject({ kind: 'details', key: '1009' })
        yield* holds[3].open
        yield* TestClock.adjust(GAP)
        yield* Fiber.join(page)
        yield* Fiber.join(rating)
      })
  )
})

describe('LookupQueue.running', () => {
  const holds = { 1: latch(), 2: latch() }

  scenario(
    'names the ASINs whose search is running, and only those',
    holding(holds),
    s =>
      Effect.gen(function* () {
        expect(yield* s.queue.running).toEqual(new Set())
        const first = yield* s.ask(1)
        const second = yield* s.ask(2)
        yield* settle
        expect(yield* s.queue.running).toEqual(new Set([asin(1), asin(2)]))

        yield* holds[1].open
        yield* settle
        expect(yield* s.queue.running).toEqual(new Set([asin(2)]))

        yield* holds[2].open
        yield* settle
        expect(yield* s.queue.running).toEqual(new Set())
        yield* Fiber.join(first)
        yield* Fiber.join(second)
      })
  )
})

describe('LookupQueue backoff', () => {
  const firstTimeLimited = (n: number, call: number) =>
    call === 1 ? Effect.fail(limited()) : Effect.succeedSome(matchFor(n))

  scenario(
    'a 429 pauses every worker for 5 s, then the job runs again',
    {
      search: (n, call) =>
        n === 1 ? firstTimeLimited(n, call) : Effect.succeedSome(matchFor(n)),
    },
    s =>
      Effect.gen(function* () {
        const limitedAsk = yield* s.ask(1)
        yield* settle
        expect(s.searches()).toEqual([0])
        expect(yield* s.queue.pausedUntil).toEqual(Option.some(5_000))

        // A different book, asked while paused, waits for the pause too, though a worker is idle.
        yield* TestClock.adjust(100)
        const other = yield* s.ask(2)
        yield* settle
        expect(s.searches()).toEqual([0])
        yield* TestClock.adjust(4_899)
        expect(s.searches()).toEqual([0])
        yield* TestClock.adjust(1)
        expect(s.searches()).toEqual([0, 5_000, 5_000])
        expect(yield* s.queue.pausedUntil).toEqual(Option.none())
        expect((yield* Fiber.join(limitedAsk)) as object).toMatchObject({
          _tag: 'Found',
        })
        yield* Fiber.join(other)
      })
  )

  scenario(
    'the pause doubles with each 429 in a row: 5 s, 10 s, 20 s',
    {
      search: (n, call) =>
        call <= 3 ? Effect.fail(limited()) : Effect.succeedSome(matchFor(n)),
    },
    s =>
      Effect.gen(function* () {
        const fiber = yield* s.ask(1)
        yield* settle
        yield* TestClock.adjust(5_000)
        expect(yield* s.queue.pausedUntil).toEqual(Option.some(5_000 + 10_000))
        yield* TestClock.adjust(10_000)
        expect(yield* s.queue.pausedUntil).toEqual(Option.some(15_000 + 20_000))
        yield* TestClock.adjust(20_000)
        expect(s.searches()).toEqual([0, 5_000, 15_000, 35_000])
        expect((yield* Fiber.join(fiber)) as object).toMatchObject({
          _tag: 'Found',
        })
      })
  )

  scenario(
    'the backoff starts again at 5 s after a success',
    {
      search: (n, call) =>
        n === 1 && call <= 2
          ? Effect.fail(limited())
          : n === 2 && call === 1
            ? Effect.fail(limited())
            : Effect.succeedSome(matchFor(n)),
    },
    s =>
      Effect.gen(function* () {
        const first = yield* s.ask(1)
        yield* settle
        yield* TestClock.adjust(5_000 + 10_000)
        yield* Fiber.join(first)
        expect(s.searches()).toEqual([0, 5_000, 15_000])

        // Book 1 succeeded at 15 s. A new 429 pauses 5 s, not 20 s.
        const second = yield* s.ask(2)
        yield* settle
        expect(yield* s.queue.pausedUntil).toEqual(Option.some(15_000 + 5_000))
        yield* TestClock.adjust(5_000)
        yield* Fiber.join(second)
      })
  )

  scenario(
    'three requests limited together are one incident, not three',
    {
      // Each request is in flight for 10 ms, so all three are out before the first answer.
      search: (n, call) =>
        Effect.sleep(10).pipe(
          Effect.andThen(
            call === 1
              ? Effect.fail(limited())
              : Effect.succeedSome(matchFor(n))
          )
        ),
    },
    s =>
      Effect.gen(function* () {
        const fibers = [yield* s.ask(1), yield* s.ask(2), yield* s.ask(3)]
        expect(s.searches()).toEqual([0, 0, 0])
        yield* TestClock.adjust(10)
        // One pause of 5 s; the other two answers add neither a step nor a failure.
        expect(yield* s.queue.pausedUntil).toEqual(Option.some(10 + 5_000))
        yield* TestClock.adjust(5_000)
        expect(s.searches()).toEqual([0, 0, 0, 5_010, 5_010, 5_010])
        yield* TestClock.adjust(10)
        for (const f of fibers) yield* Fiber.join(f)
      })
  )

  scenario(
    'gives up with RateLimited after the retries are used',
    {
      search: () => Effect.fail(limited()),
    },
    s =>
      Effect.gen(function* () {
        const fiber = yield* s.ask(1)
        yield* settle
        yield* TestClock.adjust(5_000 + 10_000 + 20_000)
        const error = yield* failureOf(fiber)
        expect(error).toBeInstanceOf(RateLimited)
        expect(s.searches()).toHaveLength(MAX_RATE_LIMIT_RETRIES + 1)
        expect(s.cache.ratings.size).toBe(0)
      })
  )

  scenario(
    'honours a Retry-After longer than the backoff',
    {
      search: (n, call) =>
        call === 1
          ? Effect.fail(limited(Duration.seconds(30)))
          : Effect.succeedSome(matchFor(n)),
    },
    s =>
      Effect.gen(function* () {
        const fiber = yield* s.ask(1)
        yield* settle
        expect(yield* s.queue.pausedUntil).toEqual(Option.some(30_000))
        yield* TestClock.adjust(29_999)
        expect(s.searches()).toEqual([0])
        yield* TestClock.adjust(1)
        expect(s.searches()).toEqual([0, 30_000])
        yield* Fiber.join(fiber)
      })
  )

  scenario(
    'a short Retry-After does not shorten the backoff',
    {
      search: (n, call) =>
        call === 1
          ? Effect.fail(limited(Duration.seconds(1)))
          : Effect.succeedSome(matchFor(n)),
    },
    s =>
      Effect.gen(function* () {
        const fiber = yield* s.ask(1)
        yield* settle
        expect(yield* s.queue.pausedUntil).toEqual(Option.some(5_000))
        yield* TestClock.adjust(5_000)
        yield* Fiber.join(fiber)
      })
  )

  scenario(
    'caps a huge Retry-After',
    {
      search: (n, call) =>
        call === 1
          ? Effect.fail(limited(Duration.hours(1)))
          : Effect.succeedSome(matchFor(n)),
    },
    s =>
      Effect.gen(function* () {
        const fiber = yield* s.ask(1)
        yield* settle
        expect(yield* s.queue.pausedUntil).toEqual(
          Option.some(RETRY_AFTER_MAX_MS)
        )
        yield* TestClock.adjust(RETRY_AFTER_MAX_MS)
        yield* Fiber.join(fiber)
      })
  )

  scenario(
    'book pages are paused and retried like searches',
    {
      details: (_id, call) =>
        call === 1 ? Effect.fail(limited()) : Effect.succeed(detailsFor(5)),
    },
    s =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(s.queue.details('1005'))
        yield* settle
        yield* TestClock.adjust(5_000)
        expect(yield* Fiber.join(fiber)).toEqual(detailsFor(5))
        expect(s.calls.map(c => c.at)).toEqual([0, 5_000])
      })
  )
})

describe('LookupQueue circuit breaker', () => {
  const failing: Behaviour = { search: () => Effect.fail(httpError()) }

  /** Fails `BREAKER_THRESHOLD` lookups in a row, the last at `GAP`. */
  const trip = (s: Scenario) =>
    Effect.gen(function* () {
      const fibers = []
      for (let n = 1; n <= BREAKER_THRESHOLD; n++) fibers.push(yield* s.ask(n))
      yield* TestClock.adjust(GAP)
      for (const f of fibers) {
        expect(yield* failureOf(f)).toBeInstanceOf(HttpError)
      }
    })

  scenario(
    'opens after repeated failures: new lookups fail at once, with no request',
    failing,
    s =>
      Effect.gen(function* () {
        yield* trip(s)
        expect(s.searches()).toHaveLength(BREAKER_THRESHOLD)

        const refused = yield* s.ask(50)
        yield* settle
        expect(finished(refused)).toBe(true)
        const error = yield* failureOf(refused)
        expect(error).toBeInstanceOf(CircuitOpen)
        expect((error as CircuitOpen).lastFailure).toBeInstanceOf(HttpError)
        expect((error as CircuitOpen).reopensAt).toBe(GAP + BREAKER_COOLDOWN_MS)
        expect(s.searches()).toHaveLength(BREAKER_THRESHOLD)
        // Nothing was cached, so a retry after the cooldown can still succeed.
        expect(s.cache.ratings.size).toBe(0)
      })
  )

  scenario(
    'does not open when a success comes between the failures',
    {
      search: n =>
        n === BREAKER_THRESHOLD
          ? Effect.succeedSome(matchFor(n))
          : Effect.fail(httpError()),
    },
    s =>
      Effect.gen(function* () {
        // Failures 1-4, a success, then failures 6-9: never five in a row.
        for (let n = 1; n < 2 * BREAKER_THRESHOLD; n++) {
          const fiber = yield* s.ask(n)
          yield* TestClock.adjust(GAP)
          yield* Fiber.await(fiber)
        }
        expect(s.searches()).toHaveLength(2 * BREAKER_THRESHOLD - 1)
      })
  )

  scenario(
    'lets one probe through after the cooldown; a good one closes it',
    {
      search: n =>
        n <= BREAKER_THRESHOLD
          ? Effect.fail(httpError())
          : Effect.succeedSome(matchFor(n)),
    },
    s =>
      Effect.gen(function* () {
        yield* trip(s)
        yield* TestClock.adjust(BREAKER_COOLDOWN_MS)
        const probe = yield* s.ask(51)
        yield* Fiber.join(probe)
        // Closed again: the next lookup is not refused.
        yield* TestClock.adjust(GAP)
        const after = yield* s.ask(52)
        expect((yield* Fiber.join(after)) as object).toMatchObject({
          _tag: 'Found',
        })
      })
  )

  scenario(
    'holds other jobs while the probe runs, then lets them through',
    {
      search: n =>
        n <= BREAKER_THRESHOLD
          ? Effect.fail(httpError())
          : Effect.succeedSome(matchFor(n)),
    },
    s =>
      Effect.gen(function* () {
        yield* trip(s)
        yield* TestClock.adjust(BREAKER_COOLDOWN_MS)
        const a = yield* s.ask(51)
        const b = yield* s.ask(52)
        yield* settle
        // Both started at the same moment; one was the probe and the other waited, then both ran.
        yield* TestClock.adjust(GAP)
        expect((yield* Fiber.join(a)) as object).toMatchObject({
          _tag: 'Found',
        })
        expect((yield* Fiber.join(b)) as object).toMatchObject({
          _tag: 'Found',
        })
      })
  )

  test('a failed probe opens it for another cooldown, and the waiting jobs fail', () => {
    const gateProbe = latch()
    const behaviour: Behaviour = {
      search: n =>
        n === 51
          ? gateProbe.wait.pipe(Effect.andThen(Effect.fail(httpError())))
          : Effect.fail(httpError()),
    }
    const cache = memoryCache()
    const fake = fakes(behaviour)
    return Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* LookupQueue
        const searchesFor = (n: number) =>
          fake.calls.filter(c => c.kind === 'search' && c.key.includes(asin(n)))
        const ask = (n: number) =>
          Effect.forkChild(
            queue.rating({ region: 'US', asin: asin(n), pinned: false })
          ).pipe(Effect.tap(() => settle))
        for (let n = 1; n <= BREAKER_THRESHOLD; n++) yield* ask(n)
        yield* TestClock.adjust(GAP)
        yield* TestClock.adjust(BREAKER_COOLDOWN_MS)
        const probe = yield* ask(51)
        const waiting = yield* ask(52)
        yield* settle
        expect(searchesFor(51)).toHaveLength(1)
        expect(searchesFor(52)).toHaveLength(0)
        yield* gateProbe.open
        yield* settle
        expect(yield* failureOf(probe)).toBeInstanceOf(HttpError)
        expect(yield* failureOf(waiting)).toBeInstanceOf(CircuitOpen)
        // Still open for a fresh cooldown from the probe's failure.
        const again = yield* ask(53)
        yield* settle
        expect(yield* failureOf(again)).toBeInstanceOf(CircuitOpen)
        expect(searchesFor(53)).toHaveLength(0)
      }).pipe(
        Effect.provide(
          LookupQueue.layer.pipe(
            Layer.provide(Layer.merge(cache.layer, fake.layer)),
            Layer.provideMerge(TestClock.layer())
          )
        )
      )
    )
  })

  scenario(
    'counts a 429 incident once, and opens on repeated ones',
    {
      search: () => Effect.fail(limited()),
    },
    s =>
      Effect.gen(function* () {
        // One lookup, rate-limited on every try: 4 incidents (5 s, 10 s, 20 s pauses), so it gives
        // up with RateLimited before the breaker opens.
        const first = yield* s.ask(1)
        yield* settle
        yield* TestClock.adjust(35_000)
        expect(yield* failureOf(first)).toBeInstanceOf(RateLimited)
        // The fifth incident opens it: the next lookup's first try is the fifth failure.
        const second = yield* s.ask(2)
        yield* settle
        yield* TestClock.adjust(80_000)
        const error = yield* failureOf(second)
        expect(error).toBeInstanceOf(CircuitOpen)
        expect((error as CircuitOpen).lastFailure).toBeInstanceOf(RateLimited)
      })
  )
})
