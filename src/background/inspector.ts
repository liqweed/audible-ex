import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { goodreadsBookId } from '../core/goodreads-url'
import { type InspectorReply, InspectorRequest } from '../schema/inspector'
import { BookCache } from './BookCache'
import { LookupQueue } from './LookupQueue'
import { fromExtensionPage, type Sender } from './popup'

class InvalidGoodreadsUrl extends Data.TaggedError('InvalidGoodreadsUrl')<{
  readonly message: string
}> {}

export const decodeInspectorRequest =
  Schema.decodeUnknownOption(InspectorRequest)
export const answerInspector = (
  request: InspectorRequest
): Effect.Effect<InspectorReply, never, BookCache | LookupQueue> =>
  Effect.gen(function* () {
    const cache = yield* BookCache
    switch (request._tag) {
      case 'ListCachedBooks':
        return { _tag: 'CachedBooks', books: yield* cache.list } as const
      case 'DeleteCachedBook':
        yield* cache.deleteBook(request.asin)
        break
      case 'CorrectCachedBook': {
        const bookId = yield* Effect.try({
          try: () => goodreadsBookId(request.url),
          catch: error =>
            new InvalidGoodreadsUrl({
              message: error instanceof Error ? error.message : String(error),
            }),
        })
        const queue = yield* LookupQueue
        yield* queue.correct(request.asin, bookId)
        break
      }
    }
    return { _tag: 'CacheChanged' } as const
  }).pipe(
    Effect.catch(error =>
      Effect.logWarning('The cache inspector request failed', error).pipe(
        Effect.as<InspectorReply>({ _tag: 'Failed', message: error.message })
      )
    )
  )

export function handleInspectorMessage(
  run: (effect: ReturnType<typeof answerInspector>) => Promise<InspectorReply>,
  message: unknown,
  sender: Sender,
  base: string,
  respond: (reply: InspectorReply) => void
): boolean {
  if (!fromExtensionPage(sender, base)) return false
  const request = decodeInspectorRequest(message)
  if (Option.isNone(request)) return false
  run(answerInspector(request.value)).then(respond, error => {
    console.error('audible-ex: the cache inspector request failed', error)
    respond({
      _tag: 'Failed',
      message: error instanceof Error ? error.message : String(error),
    })
  })
  return true
}
