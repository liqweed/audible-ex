/**
 * The port server (ARCHITECTURE.md §5): one session per tab's `agx` port. It decodes `Hello`,
 * `Lookup`, `DetailsLookup` and `Retry`, asks the `LookupQueue`, and sends a `BookUpdate` as each answer
 * arrives: at once for a cached book, `loading` and then the result for the others, and `ready`
 * again when the details land. A `ratingOnly` lookup stops after the rating; the content script asks
 * for the details with `DetailsLookup` if its filters do not hide the book (eager filtering). Updates are
 * encoded with `BackgroundMessage` before they are posted.
 *
 * A message that does not decode is dropped and logged; the port stays open and keeps working. A
 * `Lookup` before the `Hello` is dropped too, since the region is unknown. A lookup is shared with
 * every other tab through the queue; when this port disconnects only its own interest ends (its
 * waiting fibres), never the shared work.
 *
 * After a worker restart the content script opens a new port, says `Hello` and sends again every
 * ASIN that had not resolved: a fresh session with no memory of the old one, answered from the cache
 * where it can be. Within a session an ASIN already being looked up is not started twice, so a
 * repeated `Lookup` is harmless.
 *
 * Each session also reports to the `ProgressHub` when a lookup begins and how its rating ended, and
 * the hub's publisher sends the tab its `Progress` counters.
 */

import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import type { RegionCode } from '../core/regions'
import type { PinList } from '../schema/cache'
import {
  BackgroundMessage,
  type BookError,
  ContentMessage,
} from '../schema/messages'
import { AudibleCatalog } from './AudibleCatalog'
import { type LookupError, LookupQueue, type RatingResult } from './LookupQueue'
import { ProgressHub } from './ProgressHub'
import type { PortLike } from './port'

type PortServerDependencies = LookupQueue | ProgressHub | AudibleCatalog

type FoundRating = Extract<RatingResult, { _tag: 'Found' }>

export interface PortServerService {
  /**
   * Starts serving `port` and returns at once. The session ends, and its waiting lookups with it,
   * when the port disconnects or the layer's scope closes.
   */
  readonly accept: (port: PortLike) => Effect.Effect<void>
}

/** The reason code of a failure, as `BookUpdate` names it. */
export const reasonOf = (
  error: LookupError
): (typeof BookError.Type)['reason'] => {
  switch (error._tag) {
    case 'HttpError':
      return 'httpError'
    case 'RateLimited':
      return 'rateLimited'
    case 'FormatChanged':
      return 'formatChanged'
    case 'NoMetadata':
      return 'noMetadata'
    case 'CircuitOpen':
      return reasonOf(error.lastFailure)
  }
}

const ratingOf = ({ r, n, url, loose }: FoundRating) => ({ r, n, url, loose })

const decodeContent = Schema.decodeUnknownEffect(ContentMessage)
const encodeBackground = Schema.encodeEffect(BackgroundMessage)

export class PortServer extends Context.Service<
  PortServer,
  PortServerService
>()('audible-ex/PortServer') {
  static layer: Layer.Layer<PortServer, never, PortServerDependencies> =
    Layer.effect(
      PortServer,
      Effect.gen(function* () {
        const catalog = yield* AudibleCatalog
        const queue = yield* LookupQueue
        const hub = yield* ProgressHub
        const scope = yield* Effect.scope

        const session = (
          port: PortLike,
          inbox: Queue.Dequeue<unknown, Cause.Done>,
          isClosed: () => boolean
        ) =>
          Effect.scoped(
            Effect.gen(function* () {
              /** Set by `Hello`; the `Lookup` messages do not carry it. */
              let region: RegionCode | undefined
              /** Set by `Hello`; a pinned book is on the Wish List when this page is. */
              let list: PinList = 'library'
              /** ASINs this port is waiting on, so a repeated `Lookup` starts nothing new. */
              const inFlight = new Set<string>()
              const detailsInFlight = new Set<string>()
              const pricesInFlight = new Set<string>()

              const send = (update: BackgroundMessage) =>
                encodeBackground(update).pipe(
                  Effect.flatMap(message =>
                    Effect.suspend(() => {
                      try {
                        port.postMessage(message)
                        return Effect.void
                      } catch (error) {
                        // A port that has just gone away throws; its session is ending anyway.
                        return Effect.logDebug(
                          'Port closed before an update',
                          error
                        )
                      }
                    })
                  ),
                  Effect.catch(error =>
                    Effect.logWarning('An update does not encode', error)
                  )
                )

              /**
               * The book is found; sends it `ready` with its details. When the details must be read
               * first, `ready` goes out with the rating alone before the wait. A details failure
               * leaves the badge as it is: the rating is still good.
               */
              const withDetails = (asin: string, found: FoundRating) => {
                const rating = ratingOf(found)
                return queue
                  .details(
                    found.bookId,
                    send({ _tag: 'BookUpdate', asin, status: 'ready', rating })
                  )
                  .pipe(
                    Effect.matchEffect({
                      onSuccess: details =>
                        send({
                          _tag: 'BookUpdate',
                          asin,
                          status: 'ready',
                          rating,
                          details,
                        }),
                      onFailure: error =>
                        Effect.logWarning(
                          `Details of ${found.bookId} (${asin}) failed`,
                          error
                        ),
                    })
                  )
              }

              const progress = yield* hub.track(counters =>
                send({ _tag: 'Progress', ...counters })
              )

              /** The lookup of one ASIN, from the first update to the last. */
              const lookupOne = (
                lookupRegion: RegionCode,
                asin: string,
                pinned: boolean,
                ratingOnly: boolean
              ) => {
                // The queue runs `onMiss` only when the cache did not have the rating.
                let fromCache = true
                return queue
                  .rating(
                    { region: lookupRegion, asin, pinned, list },
                    Effect.suspend(() => {
                      fromCache = false
                      return send({
                        _tag: 'BookUpdate',
                        asin,
                        status: 'loading',
                      })
                    })
                  )
                  .pipe(
                    Effect.tap(result =>
                      Effect.sync(() =>
                        progress.end(asin, {
                          result: result._tag === 'Miss' ? 'notFound' : 'found',
                          cached: fromCache,
                        })
                      )
                    ),
                    Effect.flatMap(result =>
                      result._tag === 'Miss'
                        ? send({ _tag: 'BookUpdate', asin, status: 'notFound' })
                        : ratingOnly
                          ? send({
                              _tag: 'BookUpdate',
                              asin,
                              status: 'ready',
                              rating: ratingOf(result),
                            })
                          : withDetails(asin, result)
                    ),
                    Effect.catch(error =>
                      Effect.sync(() =>
                        progress.end(asin, { result: 'failed', cached: false })
                      ).pipe(
                        Effect.andThen(
                          send({
                            _tag: 'BookUpdate',
                            asin,
                            status: 'failed',
                            error: {
                              reason: reasonOf(error),
                              message: error.message,
                            },
                          })
                        )
                      )
                    ),
                    Effect.ensuring(Effect.sync(() => inFlight.delete(asin)))
                  )
              }

              /**
               * The rest of a `ratingOnly` lookup: the rating from the cache, then the details. Not a
               * new lookup for the progress counters, whose rating is already settled. A failure
               * leaves the `ready` with the rating standing, as in `withDetails`.
               */
              const detailsOne = (lookupRegion: RegionCode, asin: string) =>
                queue
                  .rating({ region: lookupRegion, asin, pinned: false })
                  .pipe(
                    Effect.flatMap(result =>
                      result._tag === 'Miss'
                        ? send({ _tag: 'BookUpdate', asin, status: 'notFound' })
                        : withDetails(asin, result)
                    ),
                    Effect.catch(error =>
                      Effect.logWarning(`Details of ${asin} failed`, error)
                    ),
                    Effect.ensuring(
                      Effect.sync(() => detailsInFlight.delete(asin))
                    )
                  )

              const start = (
                items: ReadonlyArray<{
                  asin: string
                  pinned: boolean
                  ratingOnly?: boolean | undefined
                  cacheOnly?: boolean | undefined
                }>
              ) =>
                Effect.gen(function* () {
                  if (region === undefined) {
                    return yield* Effect.logWarning(
                      'Dropped a lookup that came before Hello',
                      { port: port.name, items: items.length }
                    )
                  }
                  // Read here, not in the forked lookup: the session takes its next message only
                  // after this one, so a plain lookup sent once the price is known cannot overtake
                  // a cache-only one and be dropped as a repeat.
                  const cached = yield* Effect.forEach(
                    items,
                    ({ asin, cacheOnly }) =>
                      cacheOnly && !inFlight.has(asin)
                        ? Effect.map(queue.cachedRating(asin), Option.isSome)
                        : Effect.succeed(true),
                    { concurrency: 'unbounded' }
                  )
                  for (const [
                    i,
                    { asin, pinned, ratingOnly, cacheOnly },
                  ] of items.entries()) {
                    if (inFlight.has(asin)) continue
                    // Not in the cache: nothing to answer and nothing to count.
                    if (!cached[i]) continue
                    inFlight.add(asin)
                    progress.begin(asin)
                    yield* Effect.forkScoped(
                      lookupOne(
                        region,
                        asin,
                        pinned,
                        ratingOnly === true || cacheOnly === true
                      )
                    )
                  }
                })

              const dispatch = (message: ContentMessage) => {
                switch (message._tag) {
                  case 'Hello':
                    return Effect.sync(() => {
                      region = message.region
                      list =
                        message.page === 'wishlist' ? 'wishlist' : 'library'
                    })
                  case 'Lookup':
                    return start(message.items)
                  case 'DetailsLookup': {
                    const lookupRegion = region
                    if (lookupRegion === undefined) {
                      return Effect.logWarning(
                        'Dropped a details request that came before Hello',
                        { port: port.name, asins: message.asins.length }
                      )
                    }
                    return Effect.forEach(
                      message.asins,
                      asin => {
                        if (detailsInFlight.has(asin)) return Effect.void
                        detailsInFlight.add(asin)
                        return Effect.forkScoped(detailsOne(lookupRegion, asin))
                      },
                      { discard: true }
                    )
                  }
                  case 'PriceLookup': {
                    const lookupRegion = region
                    if (lookupRegion === undefined) return Effect.void
                    return Effect.forEach(
                      [...new Set(message.asins)],
                      asin => {
                        if (pricesInFlight.has(asin)) return Effect.void
                        pricesInFlight.add(asin)
                        return catalog.lookup(lookupRegion, asin).pipe(
                          Effect.matchEffect({
                            onSuccess: meta =>
                              send({
                                _tag: 'PriceUpdate',
                                asin,
                                ...(meta.price && { price: meta.price }),
                              }),
                            onFailure: error =>
                              Effect.logWarning(
                                'Public price lookup failed',
                                { region: lookupRegion, asin },
                                error
                              ).pipe(
                                Effect.andThen(
                                  send({ _tag: 'PriceUpdate', asin })
                                )
                              ),
                          }),
                          Effect.ensuring(
                            Effect.sync(() => pricesInFlight.delete(asin))
                          ),
                          Effect.forkScoped
                        )
                      },
                      { discard: true }
                    )
                  }
                  case 'Retry':
                    // Failures are never cached, so looking up again is all a retry is.
                    return start(
                      message.asins.map(asin => ({ asin, pinned: false }))
                    )
                }
              }

              const handle = (raw: unknown) =>
                decodeContent(raw).pipe(
                  Effect.matchEffect({
                    onFailure: error =>
                      Effect.logWarning(
                        'Dropped a port message that does not decode',
                        { port: port.name, issue: error.message }
                      ),
                    onSuccess: dispatch,
                  }),
                  // Whatever goes wrong with one message must not end the session.
                  Effect.catchCause(cause =>
                    Effect.logError(
                      'A port message failed to be handled',
                      cause
                    )
                  )
                )

              // The inbox ends with `Done` on disconnect; messages still queued then are dropped.
              yield* Effect.gen(function* () {
                while (true) {
                  const raw = yield* Queue.take(inbox)
                  if (isClosed()) return
                  yield* handle(raw)
                }
              }).pipe(Effect.ignore)
            })
          )

        return PortServer.of({
          accept: port =>
            Effect.gen(function* () {
              const inbox = yield* Queue.unbounded<unknown, Cause.Done>()
              let closed = false
              port.onMessage.addListener(message => {
                Queue.offerUnsafe(inbox, message)
              })
              port.onDisconnect.addListener(() => {
                closed = true
                Queue.endUnsafe(inbox)
              })
              yield* Effect.forkIn(
                session(port, inbox, () => closed),
                scope
              )
            }),
        })
      })
    )
}
