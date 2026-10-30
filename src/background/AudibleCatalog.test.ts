import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import { TestClock } from 'effect/testing'
import {
  AudibleCatalog,
  BATCH_MAX,
  type BookMeta,
  catalogUrl,
} from './AudibleCatalog'
import { FormatChanged, HttpError, NoMetadata, RateLimited } from './errors'
import { fakeHttp, json, type Reply } from './HttpTest'

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dir, `../../test/fixtures/audible/${name}/catalog.json`),
      'utf8'
    )
  )

const ARTEMIS = 'B0721NKM4B'
const EXOPLANET = 'B0HDF95QBD'
/** The `.com` edition of Project Hail Mary, which `.co.uk` does not list. */
const PHM_US = 'B08G9PRS1K'

/** A valid ASIN for each number. */
const asin = (n: number) => `B${String(n).padStart(9, '0')}`

/** A catalogue that carries every ASIN it is asked for, titled after the ASIN. */
const carriesAll = (url: string): Reply => {
  const asins = new URL(url).searchParams.get('asins')?.split(',') ?? []
  return json({
    products: asins.map(a => ({
      asin: a,
      title: `Title ${a}`,
      authors: [{ name: `Author ${a}` }],
    })),
  })
}

/** Runs `body` against the catalogue over a fake network, on a `TestClock`. */
const scenario = (
  name: string,
  reply: (url: string) => Reply,
  body: (
    catalog: typeof AudibleCatalog.Service,
    requests: ReturnType<typeof fakeHttp>['requests']
  ) => Effect.Effect<void, unknown>
) =>
  test(name, () => {
    const http = fakeHttp(reply)
    return Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* AudibleCatalog
        yield* body(catalog, http.requests)
      }).pipe(
        Effect.provide(
          Layer.merge(
            Layer.provide(AudibleCatalog.layer, http.layer),
            TestClock.layer()
          )
        )
      )
    )
  })

/** Starts the lookups together, lets the batch window pass, and collects every outcome. */
const lookupAll = (
  catalog: typeof AudibleCatalog.Service,
  lookups: readonly (readonly ['UK' | 'US', string])[]
) =>
  Effect.gen(function* () {
    const fibers = yield* Effect.forEach(lookups, ([region, a]) =>
      Effect.forkChild(Effect.exit(catalog.lookup(region, a)))
    )
    yield* TestClock.adjust(Duration.millis(500))
    return yield* Effect.forEach(fibers, Fiber.join)
  })

const meta = (exit: Exit.Exit<BookMeta, unknown>) => {
  if (!Exit.isSuccess(exit)) throw new Error('expected a success')
  return exit.value
}
const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit)) throw new Error('expected a failure')
  return exit.cause.reasons[0] && 'error' in exit.cause.reasons[0]
    ? exit.cause.reasons[0].error
    : undefined
}

describe('AudibleCatalog', () => {
  scenario(
    'returns the title and first author, from the marketplace API host',
    () => json(fixture('uk')),
    catalog =>
      Effect.gen(function* () {
        const [artemis, exoplanet] = yield* lookupAll(catalog, [
          ['UK', ARTEMIS],
          ['UK', EXOPLANET],
        ])
        expect(meta(artemis as Exit.Exit<BookMeta>)).toEqual({
          title: 'Artemis',
          author: 'Andy Weir',
        })
        // Audible lists two authors; the first is the one the search uses.
        expect(meta(exoplanet as Exit.Exit<BookMeta>)).toEqual({
          title: 'Exoplanet',
          author: 'Benjamin Percy',
        })
      })
  )

  scenario(
    'asks the API host of the page’s marketplace with the userscript’s response groups',
    () => json(fixture('uk')),
    (catalog, requests) =>
      Effect.gen(function* () {
        yield* lookupAll(catalog, [
          ['UK', ARTEMIS],
          ['UK', EXOPLANET],
        ])
        expect(requests.map(r => r.url)).toEqual([
          `https://api.audible.co.uk/1.0/catalog/products?asins=${ARTEMIS},${EXOPLANET}&response_groups=contributors,product_desc`,
        ])
        expect(requests[0]?.url).toBe(
          catalogUrl('api.audible.co.uk', [ARTEMIS, EXOPLANET])
        )
      })
  )

  scenario(
    'sends no cookies and asks for JSON',
    () => json(fixture('uk')),
    (catalog, requests) =>
      Effect.gen(function* () {
        yield* lookupAll(catalog, [['UK', ARTEMIS]])
        expect(requests.map(r => r.credentials)).toEqual(['omit'])
        // Only `Accept`: no tracing headers, no cookies by another name.
        expect(requests.map(r => Object.keys(r.headers))).toEqual([['accept']])
        expect(requests.map(r => r.accept)).toEqual(['application/json'])
      })
  )

  scenario(
    'twenty concurrent lookups make one request',
    carriesAll,
    (catalog, requests) =>
      Effect.gen(function* () {
        const asins = Array.from({ length: 20 }, (_, i) => asin(i))
        const outcomes = yield* lookupAll(
          catalog,
          asins.map(a => ['UK', a] as const)
        )
        expect(requests).toHaveLength(1)
        expect(new URL(requests[0]?.url ?? '').searchParams.get('asins')).toBe(
          asins.join(',')
        )
        expect(outcomes.map(o => meta(o as Exit.Exit<BookMeta>).title)).toEqual(
          asins.map(a => `Title ${a}`)
        )
      })
  )

  scenario(
    'asks once for an ASIN many fibres want',
    carriesAll,
    (catalog, requests) =>
      Effect.gen(function* () {
        const outcomes = yield* lookupAll(
          catalog,
          Array.from({ length: 5 }, () => ['UK', asin(7)] as const)
        )
        expect(requests).toHaveLength(1)
        expect(new URL(requests[0]?.url ?? '').searchParams.get('asins')).toBe(
          asin(7)
        )
        expect(outcomes.every(Exit.isSuccess)).toBe(true)
      })
  )

  scenario(
    'splits more than 40 ASINs into requests of at most 40',
    carriesAll,
    (catalog, requests) =>
      Effect.gen(function* () {
        const count = BATCH_MAX + 5
        const outcomes = yield* lookupAll(
          catalog,
          Array.from({ length: count }, (_, i) => ['UK', asin(i)] as const)
        )
        const sizes = requests.map(
          r => new URL(r.url).searchParams.get('asins')?.split(',').length
        )
        expect(sizes).toEqual([BATCH_MAX, 5])
        expect(outcomes.every(Exit.isSuccess)).toBe(true)
      })
  )

  scenario(
    'a failing second request fails only its own ASINs',
    (() => {
      let calls = 0
      return (url: string) =>
        ++calls === 1 ? carriesAll(url) : new Response('', { status: 500 })
    })(),
    catalog =>
      Effect.gen(function* () {
        const outcomes = yield* lookupAll(
          catalog,
          Array.from(
            { length: BATCH_MAX + 2 },
            (_, i) => ['UK', asin(i)] as const
          )
        )
        const ok = outcomes.slice(0, BATCH_MAX)
        const failed = outcomes.slice(BATCH_MAX)
        expect(ok.every(Exit.isSuccess)).toBe(true)
        for (const outcome of failed) {
          expect(failure(outcome as Exit.Exit<unknown>)).toBeInstanceOf(
            HttpError
          )
        }
      })
  )

  scenario(
    'makes one request per marketplace host',
    carriesAll,
    (catalog, requests) =>
      Effect.gen(function* () {
        const outcomes = yield* lookupAll(catalog, [
          ['UK', asin(1)],
          ['US', asin(2)],
          ['UK', asin(3)],
        ])
        const asinsOf = (host: string) =>
          requests
            .filter(r => new URL(r.url).host === host)
            .map(r => new URL(r.url).searchParams.get('asins'))
        expect(requests).toHaveLength(2)
        expect(asinsOf('api.audible.co.uk')).toEqual([`${asin(1)},${asin(3)}`])
        expect(asinsOf('api.audible.com')).toEqual([asin(2)])
        expect(outcomes.every(Exit.isSuccess)).toBe(true)
      })
  )

  scenario(
    'an ASIN the marketplace does not carry is NoMetadata; the others still resolve',
    () => json(fixture('uk')),
    catalog =>
      Effect.gen(function* () {
        const [artemis, missing] = yield* lookupAll(catalog, [
          ['UK', ARTEMIS],
          ['UK', PHM_US],
        ])
        expect(meta(artemis as Exit.Exit<BookMeta>).title).toBe('Artemis')
        expect(failure(missing as Exit.Exit<unknown>)).toEqual(
          new NoMetadata({ asin: PHM_US })
        )
      })
  )

  scenario(
    'an ASIN missing from the response is NoMetadata too',
    () => json({ products: [] }),
    catalog =>
      Effect.gen(function* () {
        const [outcome] = yield* lookupAll(catalog, [['UK', ARTEMIS]])
        expect(failure(outcome as Exit.Exit<unknown>)).toBeInstanceOf(
          NoMetadata
        )
      })
  )

  scenario(
    'a book with no author has an empty author',
    () => json({ products: [{ asin: ARTEMIS, title: 'Artemis' }] }),
    catalog =>
      Effect.gen(function* () {
        const [outcome] = yield* lookupAll(catalog, [['UK', ARTEMIS]])
        expect(meta(outcome as Exit.Exit<BookMeta>)).toEqual({
          title: 'Artemis',
          author: '',
        })
      })
  )

  scenario(
    'a rate-limited answer fails every lookup of the batch, with Retry-After',
    () => json({}, { status: 429, headers: { 'Retry-After': '30' } }),
    catalog =>
      Effect.gen(function* () {
        const outcomes = yield* lookupAll(catalog, [
          ['UK', ARTEMIS],
          ['UK', EXOPLANET],
        ])
        for (const outcome of outcomes) {
          const error = failure(outcome as Exit.Exit<unknown>)
          expect(error).toBeInstanceOf(RateLimited)
          expect((error as RateLimited).retryAfter).toEqual(
            Duration.seconds(30)
          )
        }
      })
  )

  scenario(
    'another failing status is an HttpError carrying it',
    () => new Response('', { status: 500 }),
    catalog =>
      Effect.gen(function* () {
        const [outcome] = yield* lookupAll(catalog, [['UK', ARTEMIS]])
        const error = failure(outcome as Exit.Exit<unknown>)
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(500)
      })
  )

  scenario(
    'a network failure is an HttpError with status 0',
    () => Promise.reject(new TypeError('Failed to fetch')),
    catalog =>
      Effect.gen(function* () {
        const [outcome] = yield* lookupAll(catalog, [['UK', ARTEMIS]])
        const error = failure(outcome as Exit.Exit<unknown>)
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(0)
      })
  )

  scenario(
    'a response in another format is FormatChanged, naming the field',
    () => json({ products: [{ asin: ARTEMIS, name: 'Artemis', authors: [] }] }),
    catalog =>
      Effect.gen(function* () {
        const [outcome] = yield* lookupAll(catalog, [['UK', ARTEMIS]])
        const error = failure(outcome as Exit.Exit<unknown>)
        expect(error).toBeInstanceOf(FormatChanged)
        expect((error as FormatChanged).source).toBe('catalog')
        expect((error as FormatChanged).detail).toContain('title')
      })
  )

  scenario(
    'a body that is not JSON is FormatChanged',
    () => new Response('<html>maintenance</html>'),
    catalog =>
      Effect.gen(function* () {
        const [outcome] = yield* lookupAll(catalog, [['UK', ARTEMIS]])
        expect(failure(outcome as Exit.Exit<unknown>)).toBeInstanceOf(
          FormatChanged
        )
      })
  )

  scenario(
    'a request that never answers fails with an HttpError after 15 seconds',
    () => new Promise<Response>(() => {}),
    catalog =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.exit(catalog.lookup('UK', ARTEMIS))
        )
        yield* TestClock.adjust(Duration.seconds(10))
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust(Duration.seconds(10))
        const error = failure(yield* Fiber.join(fiber))
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(0)
      })
  )
})
