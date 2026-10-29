/**
 * What the extension reads from Goodreads, as Schemas. The Goodreads service decodes every response
 * with them; a decode failure means Goodreads changed its format, which is reported as
 * `FormatChanged`, never as a miss (ARCHITECTURE.md §4). Only the fields the extension reads are
 * listed and each is required unless a missing value is a normal case, so a renamed field fails
 * with an error that names it instead of turning into a wrong rating. Fields not listed are ignored.
 */
import * as Schema from 'effect/Schema'
import * as SchemaIssue from 'effect/SchemaIssue'

/**
 * One result of `book/auto_complete?format=json`, the list `scoreCandidates` takes. The shape
 * matches `Candidate` in `src/core/matching.ts`.
 */
export const AutocompleteResult = Schema.Struct({
  bookId: Schema.String,
  /** Path on goodreads.com, e.g. `/book/show/5907.The_Hobbit`; it may carry a query string. */
  bookUrl: Schema.String,
  /** Full title with edition and series text, e.g. `Dune (Dune, #1)`. */
  title: Schema.String,
  /** Title without the series suffix. */
  bookTitleBare: Schema.optional(Schema.String),
  author: Schema.Struct({ name: Schema.String }),
  /** Goodreads sends it as a string (`"4.29"`); some results carry a number. */
  avgRating: Schema.Union([Schema.String, Schema.Finite]),
  ratingsCount: Schema.Finite,
})

export const AutocompleteResponse = Schema.Array(AutocompleteResult)

// The book page: the `__NEXT_DATA__` JSON holds Apollo's normalised cache, `apolloState`, a map from
// entity key to entity. Most `Book` entities in it are stubs (`__typename` and `id`), so an entity
// is decoded only after it has been chosen.

/** The envelope: only the part that holds the entities, left as untyped records. */
export const NextData = Schema.Struct({
  props: Schema.Struct({
    pageProps: Schema.Struct({
      apolloState: Schema.Record(Schema.String, Schema.Unknown),
    }),
  }),
})

/** `null` when Goodreads has no date. Apollo writes every field a page asks for, so a missing key is a changed format. */
const PublicationTime = Schema.NullOr(Schema.Finite)

/** The book the page is about. */
export const BookEntity = Schema.Struct({
  __typename: Schema.Literal('Book'),
  legacyId: Schema.Finite,
  bookGenres: Schema.Array(
    Schema.Struct({ genre: Schema.Struct({ name: Schema.String }) })
  ),
  /** HTML, `null` when there is none. */
  description: Schema.NullOr(Schema.String),
  /** The text-only form of `description`, which the userscript falls back to; not always asked for. */
  'description({"stripped":true})': Schema.optional(
    Schema.NullOr(Schema.String)
  ),
  /** This edition's details; its publication time is the fallback for the work's. */
  details: Schema.Struct({ publicationTime: PublicationTime }),
  work: Schema.optional(Schema.Struct({ __ref: Schema.String })),
})

/** The work the book belongs to; its publication time is when the book was first published. */
export const WorkEntity = Schema.Struct({
  __typename: Schema.Literal('Work'),
  details: Schema.Struct({ publicationTime: PublicationTime }),
})

/** What the extension takes from a book page. */
export const BookPageData = Schema.Struct({
  genres: Schema.Array(Schema.String),
  /** HTML as Goodreads sends it; the service turns it into text and caps it. */
  descriptionHtml: Schema.String,
  /** Milliseconds since the epoch; absent when Goodreads has no publication date. */
  firstPublished: Schema.optional(Schema.Finite),
})
export type BookPageData = typeof BookPageData.Type

const isEntity = (value: unknown, typename: string): value is object =>
  typeof value === 'object' &&
  value !== null &&
  '__typename' in value &&
  value.__typename === typename

/** A decode failure at `path` with `message`, in the shape the other failures here have. */
const failure = (path: ReadonlyArray<PropertyKey>, message: string) =>
  new Schema.SchemaError(
    new SchemaIssue.Pointer(path, new SchemaIssue.InvalidValue({ message }))
  )

/**
 * The genres, overview and first-published time of the book `bookId` from the parsed
 * `__NEXT_DATA__` of its page, ported from the userscript's `fetchDetails`. The book is the entity
 * whose `legacyId` is `bookId`, else the first one with genres; its work is the one it refers to,
 * else the first. The first-published time is the work's, else the edition's.
 *
 * Throws a `SchemaError` when the page does not have that shape; the error names the field.
 */
export function bookPageData(nextData: unknown, bookId: string): BookPageData {
  const { apolloState } =
    Schema.decodeUnknownSync(NextData)(nextData).props.pageProps
  const entities = Object.values(apolloState)
  const books = entities.filter(entity => isEntity(entity, 'Book')) as {
    legacyId?: unknown
    bookGenres?: ArrayLike<unknown>
  }[]
  const chosen =
    books.find(book => String(book.legacyId) === bookId) ??
    books.find(book => book.bookGenres?.length)
  if (!chosen) {
    throw failure(
      ['props', 'pageProps', 'apolloState'],
      `Expected a Book entity for ${bookId}`
    )
  }
  const book = Schema.decodeUnknownSync(BookEntity)(chosen)
  const workRef = book.work?.__ref
  const rawWork =
    (workRef === undefined ? undefined : apolloState[workRef]) ??
    entities.find(entity => isEntity(entity, 'Work'))
  const work =
    rawWork === undefined
      ? undefined
      : Schema.decodeUnknownSync(WorkEntity)(rawWork)
  const firstPublished =
    work?.details.publicationTime ?? book.details.publicationTime
  return {
    genres: book.bookGenres.map(edge => edge.genre.name),
    descriptionHtml:
      book.description ?? book['description({"stripped":true})'] ?? '',
    ...(typeof firstPublished === 'number' && { firstPublished }),
  }
}
