import { describe, expect, spyOn, test } from 'bun:test'
import * as Effect from 'effect/Effect'
import type { PopupReply } from '../schema/popup'
import { BookCache } from './BookCache'
import { BookCacheTest } from './BookCacheTest'
import { answer, decodeRequest, handlePopupMessage } from './popup'

const sample = (n: number) => ({
  rating: {
    _tag: 'Miss' as const,
    asin: `B00000000${n}`,
  },
})

/** A cache with two books, one of them pinned. */
const filled = Effect.gen(function* () {
  const cache = yield* BookCache
  yield* cache.setRating(sample(1).rating)
  yield* cache.setRating(sample(2).rating)
  yield* cache.pin('B000000002')
})

const withCache = <A, E>(effect: Effect.Effect<A, E, BookCache>) =>
  effect.pipe(Effect.orDie, Effect.provide(BookCacheTest))

describe('decodeRequest', () => {
  test.each([
    [{ _tag: 'CacheStats' }, true],
    [{ _tag: 'ClearCache', scope: 'unpinned' }, true],
    [{ _tag: 'ClearCache', scope: 'all' }, true],
    [{ _tag: 'ClearCache', scope: 'everything' }, false],
    [{ _tag: 'ClearCache' }, false],
    [{ _tag: 'Hello' }, false],
    ['CacheStats', false],
    [null, false],
  ])('%j is %p', (message, ok) => {
    expect(decodeRequest(message)._tag === 'Some').toBe(ok)
  })
})

describe('answer', () => {
  test('reports how many books are cached and how many are pinned', async () => {
    const reply = await Effect.runPromise(
      withCache(
        Effect.gen(function* () {
          yield* filled
          return yield* answer({ _tag: 'CacheStats' })
        })
      )
    )
    expect(reply).toMatchObject({ _tag: 'Stats', books: 2, pinned: 1 })
  })

  test('clearing the unpinned keeps the pinned book cached', async () => {
    const [cleared, stats] = await Effect.runPromise(
      withCache(
        Effect.gen(function* () {
          yield* filled
          const cleared = yield* answer({
            _tag: 'ClearCache',
            scope: 'unpinned',
          })
          return [cleared, yield* answer({ _tag: 'CacheStats' })] as const
        })
      )
    )
    expect(cleared).toEqual({ _tag: 'Cleared', deleted: 1 })
    expect(stats).toMatchObject({ books: 1, pinned: 1 })
  })

  test('clearing everything leaves nothing, pins included', async () => {
    const [cleared, stats] = await Effect.runPromise(
      withCache(
        Effect.gen(function* () {
          yield* filled
          const cleared = yield* answer({ _tag: 'ClearCache', scope: 'all' })
          return [cleared, yield* answer({ _tag: 'CacheStats' })] as const
        })
      )
    )
    expect(cleared).toEqual({ _tag: 'Cleared', deleted: 2 })
    expect(stats).toMatchObject({ books: 0, entries: 0, pinned: 0 })
  })
})

describe('handlePopupMessage', () => {
  const run = (
    effect: Parameters<Parameters<typeof handlePopupMessage>[0]>[0]
  ) => Effect.runPromise(withCache(effect))

  const ask = async (message: unknown, sender: { tab?: unknown } = {}) => {
    const replies: PopupReply[] = []
    const handled = handlePopupMessage(run, message, sender, r =>
      replies.push(r)
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    return { handled, replies }
  }

  test('answers a request from the popup', async () => {
    const { handled, replies } = await ask({ _tag: 'CacheStats' })
    expect(handled).toBe(true)
    expect(replies).toEqual([
      { _tag: 'Stats', books: 0, entries: 0, bytes: 0, pinned: 0 },
    ])
  })

  test('leaves a message it does not know to others', async () => {
    const { handled, replies } = await ask({ _tag: 'Something' })
    expect(handled).toBe(false)
    expect(replies).toEqual([])
  })

  test('does not clear the cache for a message that came from a web page', async () => {
    const { handled, replies } = await ask(
      { _tag: 'ClearCache', scope: 'all' },
      { tab: { id: 1 } }
    )
    expect(handled).toBe(false)
    expect(replies).toEqual([])
  })

  test('replies Failed when the runtime cannot run the request', async () => {
    const log = spyOn(console, 'error').mockImplementation(() => {})
    const replies: PopupReply[] = []
    handlePopupMessage(
      () => Promise.reject(new Error('IndexedDB is blocked')),
      { _tag: 'CacheStats' },
      {},
      r => replies.push(r)
    )
    await new Promise(resolve => setTimeout(resolve, 5))
    log.mockRestore()
    expect(replies).toEqual([
      { _tag: 'Failed', message: 'IndexedDB is blocked' },
    ])
  })
})
