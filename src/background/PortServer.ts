/**
 * The port server (ARCHITECTURE.md §5): one session per tab's `agx` port. It decodes `Hello`,
 * `Lookup` and `Retry`, asks the `LookupQueue`, and sends a `BookUpdate` as each answer arrives:
 * at once for a cached book, `loading` and then the result for the others, and `ready` again when
 * the details land. Updates are encoded with `BackgroundMessage` before they are posted.
 *
 * A message that does not decode is dropped and logged; the port stays open and keeps working. A
 * `Lookup` before the `Hello` is dropped too, since the region is unknown. A lookup is shared with
 * every other tab through the queue; when this port disconnects only its own interest ends (its
 * waiting fibres), never the shared work.
 *
 * After a worker restart the content script opens a new port, says `Hello` and sends again every
 * ASIN that had not resolved: a fresh session with no memory of the old one, answered from the cache
 * where it can be. Within a session an ASIN already being looked up is not started twice, so a
 * repeated `Lookup` is harmless. Nothing here sends `Progress` yet (issue #34).
 */

import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import type { RegionCode } from '../core/regions'
import {
  BackgroundMessage,
  type BookError,
  type BookUpdate,
  ContentMessage,
} from '../schema/messages'
import { type LookupError, LookupQueue, type RatingResult } from './LookupQueue'
import type { PortLike } from './port'

type Update = typeof BookUpdate.Type
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
  static layer: Layer.Layer<PortServer, never, LookupQueue> = Layer.effect(
    PortServer,
    Effect.gen(function* () {
      const queue = yield* LookupQueue
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
            /** ASINs this port is waiting on, so a repeated `Lookup` starts nothing new. */
            const inFlight = new Set<string>()

            const send = (update: Update) =>
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

            /** The lookup of one ASIN, from the first update to the last. */
            const lookupOne = (
              lookupRegion: RegionCode,
              asin: string,
              pinned: boolean
            ) =>
              queue
                .rating(
                  { region: lookupRegion, asin, pinned },
                  send({ _tag: 'BookUpdate', asin, status: 'loading' })
                )
                .pipe(
                  Effect.flatMap(result =>
                    result._tag === 'Miss'
                      ? send({ _tag: 'BookUpdate', asin, status: 'notFound' })
                      : withDetails(asin, result)
                  ),
                  Effect.catch(error =>
                    send({
                      _tag: 'BookUpdate',
                      asin,
                      status: 'failed',
                      error: {
                        reason: reasonOf(error),
                        message: error.message,
                      },
                    })
                  ),
                  Effect.ensuring(Effect.sync(() => inFlight.delete(asin)))
                )

            const start = (
              items: ReadonlyArray<{ asin: string; pinned: boolean }>
            ) =>
              Effect.gen(function* () {
                if (region === undefined) {
                  return yield* Effect.logWarning(
                    'Dropped a lookup that came before Hello',
                    { port: port.name, items: items.length }
                  )
                }
                for (const { asin, pinned } of items) {
                  if (inFlight.has(asin)) continue
                  inFlight.add(asin)
                  yield* Effect.forkScoped(lookupOne(region, asin, pinned))
                }
              })

            const dispatch = (message: ContentMessage) => {
              switch (message._tag) {
                case 'Hello':
                  return Effect.sync(() => {
                    region = message.region
                  })
                case 'Lookup':
                  return start(message.items)
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
                  Effect.logError('A port message failed to be handled', cause)
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
