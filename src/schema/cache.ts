/**
 * The records `BookCache` keeps in IndexedDB (ARCHITECTURE.md §4, §8), one Schema per object store.
 * Each record carries the time it was stored (`savedAt`), which the 30-day and 7-day limits and the
 * daily purge read; the key is a field of the record (`asin` or `bookId`).
 */
import * as Schema from 'effect/Schema'
import { Asin, Details, EpochMs, GoodreadsId, Rating } from './common'

/**
 * Store `ratings`, keyed by ASIN: the Goodreads book chosen for an Audible book, or the fact that
 * there is none (kept 30 days and 7 days). A failed lookup is not cached.
 */
export const RatingRecord = Schema.Union([
  Schema.TaggedStruct('Found', {
    asin: Asin,
    savedAt: EpochMs,
    bookId: GoodreadsId,
    ...Rating.fields,
  }),
  Schema.TaggedStruct('Miss', { asin: Asin, savedAt: EpochMs }),
])

/** Store `meta`, keyed by ASIN: what the Audible catalogue says about the book. */
export const MetaRecord = Schema.Struct({
  asin: Asin,
  savedAt: EpochMs,
  title: Schema.String.check(Schema.isNonEmpty()),
  /** The first author's name, or empty when Audible lists none. */
  author: Schema.String,
})

/** Store `details`, keyed by Goodreads book id and shared by every marketplace's ASINs. */
export const DetailsRecord = Schema.Struct({
  bookId: GoodreadsId,
  savedAt: EpochMs,
  ...Details.fields,
})

/** Store `pins`, keyed by ASIN: a book last seen in the Library or Wish List at `lastSeen`. */
export const PinRecord = Schema.Struct({
  asin: Asin,
  lastSeen: EpochMs,
})
