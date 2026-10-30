import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import { TestClock } from 'effect/testing'
import { renameKey } from '../../test/rename-key'
import { bareTitle, titleAuthorQuery } from '../core/matching'
import { FormatChanged, HttpError, RateLimited } from './errors'
import {
  autocompleteUrl,
  bookPageUrl,
  Goodreads,
  type GoodreadsService,
  nextDataJson,
} from './Goodreads'
import { fakeHttp, html, json, type Reply } from './HttpTest'

const FIXTURES = join(import.meta.dir, '../../test/fixtures/goodreads')
const read = (path: string) => readFileSync(join(FIXTURES, path), 'utf8')
const autocompleteFixture = (slug: string, kind: 'title' | 'title-author') =>
  JSON.parse(read(`autocomplete/${slug}.${kind}.json`))
const bookFile = (slug: string) => {
  const file = readdirSync(join(FIXTURES, 'book')).find(f =>
    f.endsWith(`-${slug}.html`)
  )
  if (!file) throw new Error(`no book page for ${slug}`)
  return file
}
const bookPage = (slug: string) => read(`book/${bookFile(slug)}`)
const bookIdOfSlug = (slug: string) => bookFile(slug).split('-')[0] as string

/** The `__NEXT_DATA__` JSON of a saved book page, as an object to break in a test. */
const pageData = (slug: string) =>
  JSON.parse(nextDataJson(bookPage(slug)) ?? '') as unknown
const pageWith = (data: unknown) =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`

const HAIL_MARY = { title: 'Project Hail Mary', author: 'Andy Weir' }
const dune = {
  title: 'Dune: Book One in the Dune Chronicles',
  author: 'Frank Herbert',
}

/** Autocomplete answers keyed by the query `q`; an unlisted query is an empty list. */
const autocompleteRoutes =
  (answers: Record<string, unknown>) =>
  (url: string): Reply => {
    const query = new URL(url).searchParams.get('q') ?? ''
    return json(answers[query] ?? [])
  }

/** Runs `body` against the service over a fake network, on a `TestClock`. */
const scenario = (
  name: string,
  reply: (url: string) => Reply,
  body: (
    goodreads: GoodreadsService,
    requests: ReturnType<typeof fakeHttp>['requests']
  ) => Effect.Effect<void, unknown>
) =>
  test(name, () => {
    const http = fakeHttp(reply)
    return Effect.runPromise(
      Effect.gen(function* () {
        const goodreads = yield* Goodreads
        yield* body(goodreads, http.requests)
      }).pipe(
        Effect.provide(
          Layer.merge(
            Layer.provide(Goodreads.layer, http.layer),
            TestClock.layer()
          )
        )
      )
    )
  })

/** The error of a failed effect, as a value. */
const errorOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    if (!Exit.isFailure(exit)) throw new Error('expected a failure')
    const reason = exit.cause.reasons[0]
    return reason && 'error' in reason ? (reason.error as E) : undefined
  })

describe('Goodreads.search', () => {
  scenario(
    'a book that matches exactly takes one request, the title-only search',
    autocompleteRoutes({
      'Project Hail Mary': autocompleteFixture('project-hail-mary', 'title'),
    }),
    (goodreads, requests) =>
      Effect.gen(function* () {
        const match = yield* goodreads.search(HAIL_MARY)
        const listed = autocompleteFixture('project-hail-mary', 'title').find(
          (b: { bookId: string }) => b.bookId === '54493401'
        )
        expect(match).toEqual(
          Option.some({
            bookId: '54493401',
            rating: Number(listed.avgRating),
            count: listed.ratingsCount,
            url: 'https://www.goodreads.com/book/show/54493401-project-hail-mary',
            loose: false,
          })
        )
        expect(requests.map(r => r.url)).toEqual([
          autocompleteUrl('Project Hail Mary'),
        ])
      })
  )

  scenario(
    'an approximate match is loose, found after the title-and-author search',
    autocompleteRoutes({
      'The Dune Saga': autocompleteFixture('dune', 'title'),
      'The Dune Saga Frank Herbert': autocompleteFixture(
        'dune',
        'title-author'
      ),
    }),
    (goodreads, requests) =>
      Effect.gen(function* () {
        // The author matches, the title only roughly: no score-3 candidate in either list.
        const match = yield* goodreads.search({
          title: 'The Dune Saga',
          author: 'Frank Herbert',
        })
        expect(Option.isSome(match) && match.value.loose).toBe(true)
        expect(requests.map(r => r.url)).toEqual([
          autocompleteUrl('The Dune Saga'),
          autocompleteUrl('The Dune Saga Frank Herbert'),
        ])
      })
  )

  scenario(
    'the title and author search can find the book the title-only list lacks',
    autocompleteRoutes({
      Dune: [],
      'Dune Frank Herbert': autocompleteFixture('dune', 'title-author'),
    }),
    (goodreads, requests) =>
      Effect.gen(function* () {
        const match = yield* goodreads.search({
          title: 'Dune',
          author: 'Frank Herbert',
        })
        expect(Option.isSome(match) && match.value.loose).toBe(false)
        expect(requests).toHaveLength(2)
      })
  )

  scenario(
    'a book that is not on Goodreads is a result, not an error',
    autocompleteRoutes({
      Dune: autocompleteFixture('dune', 'title'),
      'Dune Zzyzx Nobody': autocompleteFixture('dune', 'title-author'),
    }),
    (goodreads, requests) =>
      Effect.gen(function* () {
        // The title is there, but no candidate is by this author.
        const match = yield* goodreads.search({
          title: 'Dune',
          author: 'Zzyzx Nobody',
        })
        expect(match).toEqual(Option.none())
        expect(requests).toHaveLength(2)
      })
  )

  scenario(
    'an empty list is a miss; with no author there is no second search',
    () => json([]),
    (goodreads, requests) =>
      Effect.gen(function* () {
        expect(yield* goodreads.search({ title: 'Nothing Like It' })).toEqual(
          Option.none()
        )
        expect(requests).toHaveLength(1)
      })
  )

  scenario(
    'searches for the bare title, then the bare title and the author',
    () => json([]),
    (goodreads, requests) =>
      Effect.gen(function* () {
        yield* goodreads.search(dune)
        expect(requests.map(r => r.url)).toEqual([
          autocompleteUrl(bareTitle(dune.title)),
          autocompleteUrl(titleAuthorQuery(dune.title, dune.author)),
        ])
        expect(requests[0]?.url).toBe(
          'https://www.goodreads.com/book/auto_complete?format=json&q=Dune'
        )
      })
  )

  scenario(
    'sends no cookies and asks for JSON',
    () => json([]),
    (goodreads, requests) =>
      Effect.gen(function* () {
        yield* goodreads.search(dune)
        expect(requests.length).toBeGreaterThan(0)
        for (const request of requests) {
          expect(request.credentials).toBe('omit')
          expect(Object.keys(request.headers)).toEqual(['accept'])
          expect(request.accept).toBe('application/json')
        }
      })
  )

  scenario(
    'a rate-limited answer is RateLimited with its Retry-After',
    () => json({}, { status: 429, headers: { 'Retry-After': '45' } }),
    goodreads =>
      Effect.gen(function* () {
        const error = yield* errorOf(goodreads.search(HAIL_MARY))
        expect(error).toBeInstanceOf(RateLimited)
        expect((error as RateLimited).status).toBe(429)
        expect((error as RateLimited).retryAfter).toEqual(Duration.seconds(45))
      })
  )

  scenario(
    '503 is RateLimited, without a Retry-After when none is sent',
    () => new Response('', { status: 503 }),
    goodreads =>
      Effect.gen(function* () {
        const error = yield* errorOf(goodreads.search(HAIL_MARY))
        expect(error).toBeInstanceOf(RateLimited)
        expect((error as RateLimited).retryAfter).toBeUndefined()
      })
  )

  scenario(
    'another failing status is an HttpError carrying it',
    () => new Response('', { status: 500 }),
    goodreads =>
      Effect.gen(function* () {
        const error = yield* errorOf(goodreads.search(HAIL_MARY))
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(500)
      })
  )

  scenario(
    'a network failure is an HttpError with status 0',
    () => Promise.reject(new TypeError('Failed to fetch')),
    goodreads =>
      Effect.gen(function* () {
        const error = yield* errorOf(goodreads.search(HAIL_MARY))
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(0)
      })
  )

  scenario(
    'a request that never answers is an HttpError after 15 seconds',
    () => new Promise<Response>(() => {}),
    goodreads =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          errorOf(goodreads.search(HAIL_MARY))
        )
        yield* TestClock.adjust(Duration.seconds(16))
        const error = yield* Fiber.join(fiber)
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(0)
      })
  )

  scenario(
    'a renamed field is FormatChanged naming it, not a miss',
    () =>
      json(
        renameKey(
          autocompleteFixture('project-hail-mary', 'title'),
          'ratingsCount',
          'ratingCount'
        )
      ),
    goodreads =>
      Effect.gen(function* () {
        const error = yield* errorOf(goodreads.search(HAIL_MARY))
        expect(error).toBeInstanceOf(FormatChanged)
        expect((error as FormatChanged).source).toBe('autocomplete')
        expect((error as FormatChanged).detail).toContain('ratingsCount')
      })
  )

  scenario(
    'an empty or 202 autocomplete answer is RateLimited, not FormatChanged',
    url => (url.includes('Hail') ? html('') : html('[]', { status: 202 })),
    goodreads =>
      Effect.gen(function* () {
        const empty = yield* errorOf(goodreads.search(HAIL_MARY))
        expect(empty).toBeInstanceOf(RateLimited)
        const accepted = yield* errorOf(goodreads.search(dune))
        expect(accepted).toBeInstanceOf(RateLimited)
        expect((accepted as RateLimited).status).toBe(202)
      })
  )

  scenario(
    'an answer that is not a list is FormatChanged',
    () => json({ error: 'Not found' }),
    goodreads =>
      Effect.gen(function* () {
        expect(yield* errorOf(goodreads.search(HAIL_MARY))).toBeInstanceOf(
          FormatChanged
        )
      })
  )

  scenario(
    'an HTML answer is FormatChanged',
    () => html('<html>Please verify you are human</html>'),
    goodreads =>
      Effect.gen(function* () {
        expect(yield* errorOf(goodreads.search(HAIL_MARY))).toBeInstanceOf(
          FormatChanged
        )
      })
  )
})

describe('Goodreads.details', () => {
  scenario(
    'reads genres, year and overview from the book page',
    () => html(bookPage('project-hail-mary')),
    (goodreads, requests) =>
      Effect.gen(function* () {
        const details = yield* goodreads.details('54493401')
        expect(details.year).toBe(2021)
        expect(details.genres.length).toBeGreaterThan(0)
        expect(details.genres.length).toBeLessThanOrEqual(10)
        expect(details.genres).toContain('Science Fiction')
        expect(details.desc.length).toBeGreaterThan(0)
        expect(details.desc).not.toContain('<')
        expect(requests.map(r => r.url)).toEqual([bookPageUrl('54493401')])
        expect(requests[0]?.url).toBe(
          'https://www.goodreads.com/book/show/54493401'
        )
      })
  )

  scenario(
    'asks for HTML and sends no cookies',
    () => html(bookPage('project-hail-mary')),
    (goodreads, requests) =>
      Effect.gen(function* () {
        yield* goodreads.details('54493401')
        expect(requests.map(r => [r.credentials, r.accept])).toEqual([
          ['omit', 'text/html'],
        ])
      })
  )

  scenario(
    'caps the overview at 600 characters',
    () => {
      const data = pageData('project-hail-mary') as {
        props: {
          pageProps: { apolloState: Record<string, { description?: string }> }
        }
      }
      for (const entity of Object.values(data.props.pageProps.apolloState)) {
        if (entity.description !== undefined)
          entity.description = `<p>${'word '.repeat(400)}</p>`
      }
      return html(pageWith(data))
    },
    goodreads =>
      Effect.gen(function* () {
        const { desc } = yield* goodreads.details('54493401')
        expect(desc).toHaveLength(600)
      })
  )

  // The userscript's own `fetchDetails`, run on the same saved page, is the reference.
  const SLUGS = readdirSync(join(FIXTURES, 'book')).map(file =>
    file.replace(/^\d+-/, '').replace(/\.html$/, '')
  )
  test('has the twenty saved pages this comparison is meant to run on', () => {
    expect(SLUGS).toHaveLength(20)
  })
  for (const slug of SLUGS) {
    scenario(
      `${slug}: the same genres, overview and year as the userscript`,
      () => html(bookPage(slug)),
      goodreads =>
        Effect.gen(function* () {
          const id = bookIdOfSlug(slug)
          expect(yield* goodreads.details(id)).toEqual(
            userscriptDetails(slug, id)
          )
        })
    )
  }

  scenario(
    'a page that answers 202 is RateLimited, not FormatChanged',
    () => html('', { status: 202 }),
    goodreads =>
      Effect.gen(function* () {
        const error = yield* errorOf(goodreads.details('54493401'))
        expect(error).toBeInstanceOf(RateLimited)
        expect((error as RateLimited).status).toBe(202)
      })
  )

  scenario(
    'an empty page is RateLimited',
    () => html(''),
    goodreads =>
      Effect.gen(function* () {
        expect(yield* errorOf(goodreads.details('54493401'))).toBeInstanceOf(
          RateLimited
        )
      })
  )

  scenario(
    'a page with a 429 is RateLimited with its Retry-After',
    () => html('', { status: 429, headers: { 'Retry-After': '120' } }),
    goodreads =>
      Effect.gen(function* () {
        const error = yield* errorOf(goodreads.details('54493401'))
        expect((error as RateLimited).retryAfter).toEqual(Duration.seconds(120))
      })
  )

  scenario(
    'a missing book is an HttpError 404',
    () => html('Not found', { status: 404 }),
    goodreads =>
      Effect.gen(function* () {
        const error = yield* errorOf(goodreads.details('1'))
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(404)
      })
  )

  scenario(
    'a page without __NEXT_DATA__ is FormatChanged',
    () => html('<html><body><h1>The Goodreads redesign</h1></body></html>'),
    goodreads =>
      Effect.gen(function* () {
        const error = yield* errorOf(goodreads.details('54493401'))
        expect(error).toBeInstanceOf(FormatChanged)
        expect((error as FormatChanged).source).toBe('bookPage')
      })
  )

  scenario(
    'a __NEXT_DATA__ that is not JSON is FormatChanged',
    () =>
      html('<script id="__NEXT_DATA__" type="application/json">{oops</script>'),
    goodreads =>
      Effect.gen(function* () {
        expect(yield* errorOf(goodreads.details('54493401'))).toBeInstanceOf(
          FormatChanged
        )
      })
  )

  scenario(
    'a renamed field is FormatChanged naming it',
    () =>
      html(
        pageWith(
          renameKey(pageData('project-hail-mary'), 'bookGenres', 'genreEdges')
        )
      ),
    goodreads =>
      Effect.gen(function* () {
        const error = yield* errorOf(goodreads.details('54493401'))
        expect(error).toBeInstanceOf(FormatChanged)
        expect((error as FormatChanged).source).toBe('bookPage')
        expect((error as FormatChanged).detail).toContain('bookGenres')
      })
  )

  scenario(
    'a publication time no date can hold is FormatChanged',
    () =>
      html(
        pageWith(
          JSON.parse(
            JSON.stringify(pageData('project-hail-mary')).replace(
              /"publicationTime":\s*-?\d+/g,
              '"publicationTime":1e20'
            )
          )
        )
      ),
    goodreads =>
      Effect.gen(function* () {
        const error = yield* errorOf(goodreads.details('54493401'))
        expect(error).toBeInstanceOf(FormatChanged)
      })
  )

  scenario(
    'a book with no publication date has year 0',
    () => {
      const data = JSON.stringify(pageData('project-hail-mary')).replace(
        /"publicationTime":\s*-?\d+/g,
        '"publicationTime":null'
      )
      return html(pageWith(JSON.parse(data)))
    },
    goodreads =>
      Effect.gen(function* () {
        expect((yield* goodreads.details('54493401')).year).toBe(0)
      })
  )
})

describe('nextDataJson', () => {
  test('is the text between the script tags', () => {
    expect(
      nextDataJson(
        '<p>x</p><script id="__NEXT_DATA__" type="application/json">{"a":1}</script>'
      )
    ).toBe('{"a":1}')
  })

  test('is undefined without the script, or without its end', () => {
    expect(nextDataJson('<script id="other">{}</script>')).toBeUndefined()
    expect(nextDataJson('<script id="__NEXT_DATA__">{')).toBeUndefined()
  })
})

/** The parts of an Apollo entity the userscript reads. */
interface Entity {
  __typename?: string
  legacyId?: number
  bookGenres?: { genre?: { name?: string } }[]
  description?: string
  work?: { __ref?: string }
  details?: { publicationTime?: number | null }
  [key: string]: unknown
}

/**
 * `fetchDetails` of the userscript (v2.4.0) applied to a saved page: its `htmlToText` uses
 * `DOMParser`, which happy-dom provides under `bun test`.
 */
function userscriptDetails(slug: string, id: string) {
  const state = JSON.parse(nextDataJson(bookPage(slug)) ?? '').props.pageProps
    .apolloState as Record<string, Entity>
  const books = Object.values(state).filter(v => v?.__typename === 'Book')
  const book =
    books.find(b => String(b.legacyId) === String(id)) ??
    books.find(b => b.bookGenres?.length) ??
    {}
  const workRef = book.work?.__ref
  const work =
    (workRef === undefined ? undefined : state[workRef]) ??
    Object.values(state).find(v => v?.__typename === 'Work')
  const pubTime =
    work?.details?.publicationTime ?? book.details?.publicationTime
  const htmlToText = (source: string) => {
    const doc = new DOMParser().parseFromString(
      source.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n'),
      'text/html'
    )
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
  }
  return {
    genres: (book.bookGenres ?? [])
      .map(g => g?.genre?.name)
      .filter((name): name is string => Boolean(name))
      .slice(0, 10),
    desc: htmlToText(
      book.description || String(book['description({"stripped":true})'] ?? '')
    ).slice(0, 600),
    year:
      typeof pubTime === 'number' && Number.isFinite(pubTime)
        ? new Date(pubTime).getUTCFullYear()
        : 0,
  }
}
