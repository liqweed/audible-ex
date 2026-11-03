import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import { TestClock } from 'effect/testing'
import { IDBFactory } from 'fake-indexeddb'
import { catalogUrl } from './AudibleCatalog'
import { BookCache } from './BookCache'
import { autocompleteUrl, bookPageUrl } from './Goodreads'
import { fakeHttp, html, json } from './HttpTest'
import { answerInspector } from './inspector'
import { LookupQueue } from './LookupQueue'
import { PortServer } from './PortServer'
import type { PortLike } from './port'
import { liveLayer } from './runtime'

const FIXTURES = join(import.meta.dir, '../../test/fixtures')
const fixture = (path: string) => readFileSync(join(FIXTURES, path), 'utf8')

const HAIL_MARY = 'B08G9PRS1K'
const HAIL_MARY_ID = '54493401'

/** What the three sources answer for Project Hail Mary, from the saved fixtures. */
const reply = (url: string) => {
  if (url === catalogUrl('api.audible.com', [HAIL_MARY])) {
    return json(JSON.parse(fixture('audible/com/catalog.json')))
  }
  if (url === autocompleteUrl('Project Hail Mary')) {
    return json(
      JSON.parse(fixture('goodreads/autocomplete/project-hail-mary.title.json'))
    )
  }
  if (url === bookPageUrl(HAIL_MARY_ID)) {
    return html(
      fixture(`goodreads/book/${HAIL_MARY_ID}-project-hail-mary.html`)
    )
  }
  return new Response('not in the fixtures', { status: 404 })
}

describe('the live layer graph', () => {
  test('serves a port end to end over the real services, a fake network and a fake IndexedDB', async () => {
    const http = fakeHttp(reply)
    const sent: Array<Record<string, unknown>> = []
    let onMessage: (message: unknown) => void = () => {}
    const port: PortLike = {
      name: 'agx',
      postMessage: message => sent.push(message as Record<string, unknown>),
      onMessage: { addListener: l => (onMessage = l) },
      onDisconnect: { addListener: () => {} },
    }
    // IndexedDB is real (fake-indexeddb) and so asynchronous; the clock is not.
    const driveUntil = (done: () => boolean) =>
      Effect.gen(function* () {
        for (let i = 0; i < 200 && !done(); i++) {
          yield* TestClock.adjust(50)
          yield* Effect.promise(() => new Promise(r => setTimeout(r, 2)))
        }
      })

    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* PortServer
        yield* server.accept(port)
        onMessage({ _tag: 'Hello', region: 'US', page: 'search' })
        onMessage({
          _tag: 'Lookup',
          items: [{ asin: HAIL_MARY, pinned: true }],
        })
        yield* driveUntil(() => sent.some(m => m.details !== undefined))
      }).pipe(
        Effect.provide(
          liveLayer(new IDBFactory(), http.layer).pipe(
            Layer.provideMerge(TestClock.layer())
          )
        )
      )
    )

    const updates = sent.filter(m => m._tag === 'BookUpdate')
    expect(updates.map(m => m.status)).toEqual(['loading', 'ready', 'ready'])
    // The tab is also told its progress: the looked-up book is pending in the first message.
    const progress = sent.filter(m => m._tag === 'Progress')
    expect(progress[0]).toMatchObject({ queued: 1, active: 0, done: 0 })
    const last = updates.at(-1) as {
      rating: { url: string; loose: boolean }
      details: { genres: string[]; year: number }
    }
    expect(last.rating.url).toBe(
      'https://www.goodreads.com/book/show/54493401-project-hail-mary'
    )
    expect(last.details.year).toBe(2021)
    expect(last.details.genres.length).toBeGreaterThan(0)
    // Catalogue, autocomplete, book page: one request each, none with cookies.
    expect(http.requests.map(r => new URL(r.url).host)).toEqual([
      'api.audible.com',
      'www.goodreads.com',
      'www.goodreads.com',
    ])
    expect(http.requests.every(r => r.credentials === 'omit')).toBe(true)
  })
})

describe('the cache the popup reads', () => {
  test('is the one the port server writes to, opened once', async () => {
    const factory = new IDBFactory()
    let opens = 0
    const counting = new Proxy(factory, {
      get(target, key) {
        if (key === 'open')
          return (...args: Parameters<IDBFactory['open']>) => {
            opens++
            return target.open(...args)
          }
        return Reflect.get(target, key, target)
      },
    })
    const stats = await Effect.runPromise(
      Effect.gen(function* () {
        yield* PortServer
        const cache = yield* BookCache
        yield* cache.setRating({
          _tag: 'Miss',
          asin: HAIL_MARY,
        })
        return yield* cache.stats
      }).pipe(
        Effect.provide(
          liveLayer(counting, fakeHttp(reply).layer).pipe(
            Layer.provideMerge(TestClock.layer())
          )
        )
      )
    )
    expect(stats.books).toBe(1)
    expect(opens).toBe(1)
  })
})

describe('manual corrections through the live service graph', () => {
  test('persists the selected book, refreshes it after expiry without autocomplete, and deletes it', async () => {
    const http = fakeHttp(reply)
    await Effect.runPromise(
      Effect.gen(function* () {
        const cache = yield* BookCache
        const queue = yield* LookupQueue
        const corrected = yield* answerInspector({
          _tag: 'CorrectCachedBook',
          asin: HAIL_MARY,
          url: `${bookPageUrl(HAIL_MARY_ID)}?source=search`,
        })
        expect(corrected._tag).toBe('CacheChanged')
        expect((yield* cache.list)[0]).toMatchObject({
          manual: true,
          bookId: HAIL_MARY_ID,
        })
        yield* TestClock.adjust(31 * 864e5)
        const rating = yield* queue.rating({
          region: 'US',
          asin: HAIL_MARY,
          pinned: false,
        })
        expect(rating).toMatchObject({ _tag: 'Found', bookId: HAIL_MARY_ID })
        expect(http.requests.map(r => r.url)).toEqual([
          bookPageUrl(HAIL_MARY_ID),
          bookPageUrl(HAIL_MARY_ID),
        ])
        yield* answerInspector({ _tag: 'DeleteCachedBook', asin: HAIL_MARY })
        expect(yield* cache.list).toEqual([])
      }).pipe(
        Effect.provide(
          liveLayer(new IDBFactory(), http.layer).pipe(
            Layer.provideMerge(TestClock.layer())
          )
        )
      )
    )
  })
  test('failed and invalid corrections preserve the existing match and never search', async () => {
    const http = fakeHttp(() => new Response('not found', { status: 404 }))
    await Effect.runPromise(
      Effect.gen(function* () {
        const cache = yield* BookCache
        yield* cache.setRating({ _tag: 'Miss', asin: HAIL_MARY })
        const failed = yield* answerInspector({
          _tag: 'CorrectCachedBook',
          asin: HAIL_MARY,
          url: bookPageUrl('999'),
        })
        expect(failed._tag).toBe('Failed')
        expect(
          Option.getOrUndefined(yield* cache.getRating(HAIL_MARY))?._tag
        ).toBe('Miss')
        expect(Option.isNone(yield* cache.getOverride(HAIL_MARY))).toBe(true)
        const invalid = yield* answerInspector({
          _tag: 'CorrectCachedBook',
          asin: HAIL_MARY,
          url: 'https://evil.test/book/show/999',
        })
        expect(invalid._tag).toBe('Failed')
        expect(http.requests).toHaveLength(1)
      }).pipe(Effect.provide(liveLayer(new IDBFactory(), http.layer)))
    )
  })
})

test('a manual correction wins over an automatic search already in flight', async () => {
  let releaseSearch: () => void = () => {}
  const held = new Promise<void>(resolve => {
    releaseSearch = resolve
  })
  let searching = false
  const http = fakeHttp(async url => {
    if (url.includes('auto_complete')) {
      searching = true
      await held
    }
    if (url === bookPageUrl('5907'))
      return html(fixture('goodreads/book/5907-the-hobbit.html'))
    return reply(url)
  })
  await Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* LookupQueue
      const cache = yield* BookCache
      const automatic = yield* Effect.forkChild(
        queue.rating({ region: 'US', asin: HAIL_MARY, pinned: false })
      )
      for (let i = 0; i < 100 && !searching; i++)
        yield* Effect.promise(() => new Promise(r => setTimeout(r, 2)))
      expect(searching).toBe(true)
      yield* queue.correct(HAIL_MARY, '5907')
      releaseSearch()
      const result = yield* Fiber.join(automatic)
      expect(result).toMatchObject({
        _tag: 'Found',
        bookId: '5907',
        url: bookPageUrl('5907'),
      })
      expect(
        Option.getOrUndefined(yield* cache.getRating(HAIL_MARY))
      ).toMatchObject({ url: bookPageUrl('5907') })
    }).pipe(Effect.provide(liveLayer(new IDBFactory(), http.layer)))
  )
})
