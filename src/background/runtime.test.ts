import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { TestClock } from 'effect/testing'
import { IDBFactory } from 'fake-indexeddb'
import { catalogUrl } from './AudibleCatalog'
import { BookCache } from './BookCache'
import { autocompleteUrl, bookPageUrl } from './Goodreads'
import { fakeHttp, html, json } from './HttpTest'
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

    expect(sent.map(m => m.status)).toEqual(['loading', 'ready', 'ready'])
    const last = sent.at(-1) as {
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
