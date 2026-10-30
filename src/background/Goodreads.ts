/**
 * The two Goodreads reads (ARCHITECTURE.md §4): `search` finds the book that matches an Audible book
 * through `book/auto_complete`, and `details` reads genres, overview and first-published year from
 * the book page's `__NEXT_DATA__`. The userscript's `searchGoodreads` and `fetchDetails`.
 *
 * This service only does the requests and the decoding. Pacing (the 3 workers, the 250 ms gap, the
 * backoff on `RateLimited`) belongs to the `LookupQueue`: every call here goes through it, and
 * nothing may call this service around it. Responses are decoded with the Schemas of
 * `src/schema/goodreads.ts`; a response that does not decode is `FormatChanged`, never a miss. The
 * matching rules are `src/core/matching.ts`.
 */

// @effect-diagnostics unstableApiUsage:off (effect/http is unstable by Effect's label; DECISIONS.md D16)

import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import type { HttpClient } from 'effect/http'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { htmlToText, truncate } from '../core/html'
import {
  type BookQuery,
  bareTitle,
  chooseMatch,
  type Match,
  needsAuthorSearch,
  scoreCandidates,
  titleAuthorQuery,
} from '../core/matching'
import { DESCRIPTION_MAX, type Details, GENRES_MAX } from '../schema/common'
import {
  AutocompleteResponse,
  type BookPageData,
  bookPageData,
} from '../schema/goodreads'
import {
  FormatChanged,
  type FormatSource,
  type HttpError,
  RateLimited,
} from './errors'
import { getText, type TextResponse } from './httpGet'

export type GoodreadsError = HttpError | RateLimited | FormatChanged

export interface GoodreadsService {
  /**
   * The Goodreads book for an Audible book: the title-only search first, the title and author search
   * only when that has no exact match (`needsAuthorSearch`). `Option.none` is "not on Goodreads", a
   * normal result.
   */
  readonly search: (
    book: BookQuery
  ) => Effect.Effect<Option.Option<Match>, GoodreadsError>
  /**
   * What the book page of Goodreads book `bookId` adds: genres (at most 10), the overview as plain
   * text (at most 600 characters) and the year first published (0 when Goodreads has none).
   */
  readonly details: (
    bookId: string
  ) => Effect.Effect<typeof Details.Type, GoodreadsError>
}

const ORIGIN = 'https://www.goodreads.com'

export const autocompleteUrl = (query: string) =>
  `${ORIGIN}/book/auto_complete?format=json&q=${encodeURIComponent(query)}`

export const bookPageUrl = (bookId: string) => `${ORIGIN}/book/show/${bookId}`

const START_TAG = /<script id="__NEXT_DATA__"[^>]*>/

/** The JSON text inside the book page's `__NEXT_DATA__` script, or none when the page has no such script. */
export function nextDataJson(html: string): string | undefined {
  const start = START_TAG.exec(html)
  if (!start) return undefined
  const from = start.index + start[0].length
  const to = html.indexOf('</script>', from)
  return to < 0 ? undefined : html.slice(from, to)
}

const formatChanged = (source: FormatSource, error: unknown) =>
  new FormatChanged({
    source,
    detail: error instanceof Error ? error.message : String(error),
  })

const decodeAutocomplete = (text: string) =>
  Schema.decodeEffect(Schema.fromJsonString(AutocompleteResponse))(text).pipe(
    Effect.mapError(error => formatChanged('autocomplete', error))
  )

/**
 * First published: the year of the time Goodreads gives, 0 when it gives none. A time no date can
 * hold (the year is `NaN`) is a changed format, not a year.
 */
const yearOf = (firstPublished: number | undefined) => {
  if (firstPublished === undefined) return Effect.succeed(0)
  const year = new Date(firstPublished).getUTCFullYear()
  return Number.isNaN(year)
    ? Effect.fail(
        formatChanged('bookPage', `Unusable publication time ${firstPublished}`)
      )
    : Effect.succeed(year)
}

const toDetails = (page: BookPageData) =>
  Effect.map(yearOf(page.firstPublished), (year): typeof Details.Type => ({
    genres: page.genres.filter(Boolean).slice(0, GENRES_MAX),
    year,
    desc: truncate(htmlToText(page.descriptionHtml), DESCRIPTION_MAX),
  }))

/** A `202` or an empty body is a bot or rate challenge, not a changed format (phase 0 spike). */
const challenge = (url: string, { status, text }: TextResponse) =>
  status === 202 || text.trim() === ''
    ? Effect.fail(new RateLimited({ status, url, retryAfter: undefined }))
    : Effect.void

export class Goodreads extends Context.Service<Goodreads, GoodreadsService>()(
  'audible-ex/Goodreads'
) {
  /** The service over the `HttpClient` in the environment (`FetchHttpClient` in the worker). */
  static layer: Layer.Layer<Goodreads, never, HttpClient.HttpClient> =
    Layer.effect(
      Goodreads,
      Effect.gen(function* () {
        const context = yield* Effect.context<HttpClient.HttpClient>()

        const autocomplete = (query: string) =>
          Effect.gen(function* () {
            const url = autocompleteUrl(query)
            const response = yield* getText(url, 'application/json')
            yield* challenge(url, response)
            return yield* decodeAutocomplete(response.text)
          })

        const search: GoodreadsService['search'] = book =>
          Effect.gen(function* () {
            const first = scoreCandidates(
              yield* autocomplete(bareTitle(book.title)),
              book
            )
            const second = needsAuthorSearch(first, book)
              ? scoreCandidates(
                  yield* autocomplete(
                    titleAuthorQuery(book.title, book.author ?? '')
                  ),
                  book
                )
              : []
            return Option.fromUndefinedOr(chooseMatch(first, second))
          }).pipe(Effect.provideContext(context))

        const details: GoodreadsService['details'] = bookId =>
          Effect.gen(function* () {
            const url = bookPageUrl(bookId)
            const response = yield* getText(url, 'text/html')
            yield* challenge(url, response)
            const { text } = response
            const json = nextDataJson(text)
            if (json === undefined) {
              return yield* new FormatChanged({
                source: 'bookPage',
                detail: 'The page has no __NEXT_DATA__ script',
              })
            }
            return yield* toDetails(
              yield* Effect.try({
                try: () => bookPageData(JSON.parse(json), bookId),
                catch: error => formatChanged('bookPage', error),
              })
            )
          }).pipe(Effect.provideContext(context))

        return Goodreads.of({ search, details })
      })
    )
}
