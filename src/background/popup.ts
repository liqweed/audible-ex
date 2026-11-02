/**
 * Answers the popup's requests (ARCHITECTURE.md §5): how much the cache holds, and emptying it.
 * These are the userscript's menu commands. A request that does not decode is not ours and gets no
 * answer, so another listener, if there ever is one, can take it.
 */
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { type PopupReply, PopupRequest } from '../schema/popup'
import { BookCache } from './BookCache'

export const decodeRequest = Schema.decodeUnknownOption(PopupRequest)

/** What to answer a request with; a cache that cannot be read is a `Failed` reply, not a crash. */
export const answer = (
  request: PopupRequest
): Effect.Effect<PopupReply, never, BookCache> =>
  Effect.gen(function* () {
    const cache = yield* BookCache
    if (request._tag === 'CacheStats') {
      return { _tag: 'Stats', ...(yield* cache.stats) } satisfies PopupReply
    }
    const deleted = yield* cache.clear(request.scope)
    return { _tag: 'Cleared', deleted } satisfies PopupReply
  }).pipe(
    Effect.catch(error =>
      Effect.logWarning('The popup request failed', error).pipe(
        Effect.as<PopupReply>({ _tag: 'Failed', message: error.message })
      )
    )
  )

/**
 * True for a message from the extension's own pages. A content script (which has a tab) runs inside
 * a web page, so what it relays is not trusted to clear the cache.
 */
export const fromExtensionPage = (sender: { tab?: unknown }): boolean =>
  sender.tab === undefined

/**
 * The `runtime.onMessage` listener's body. Returns true when it will answer through `respond`
 * (Chrome then keeps the channel open), false when the message is not for it. `run` is the worker's
 * runtime; it rejects when the cache cannot even be opened, which is also a `Failed` reply.
 */
export function handlePopupMessage(
  run: (
    effect: Effect.Effect<PopupReply, never, BookCache>
  ) => Promise<PopupReply>,
  message: unknown,
  sender: { tab?: unknown },
  respond: (reply: PopupReply) => void
): boolean {
  if (!fromExtensionPage(sender)) return false
  const request = decodeRequest(message)
  if (Option.isNone(request)) return false
  run(answer(request.value)).then(respond, error => {
    console.error('audible-ex: the popup request failed', error)
    respond({
      _tag: 'Failed',
      message: error instanceof Error ? error.message : String(error),
    })
  })
  return true
}
