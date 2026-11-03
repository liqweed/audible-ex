/**
 * Shapes that more than one schema module uses: identifiers, timestamps, and the rating and details
 * of a book as the cache stores them and the port carries them. Effect is imported by path
 * (`effect/Schema`) because the content script bundles this module (ARCHITECTURE.md §6).
 */
import * as Schema from 'effect/Schema'
import { REGIONS } from '../core/regions'

/** An Audible ASIN: 10 upper-case letters or digits, as `asinFromHref` extracts it. */
export const Asin = Schema.String.check(Schema.isPattern(/^[A-Z0-9]{10}$/))

/** A Goodreads book id, digits only (`bookId` in `auto_complete`, `legacyId` on the book page). */
export const GoodreadsId = Schema.String.check(Schema.isPattern(/^\d+$/))

/** Milliseconds since the Unix epoch, as `Date.now()` returns them. */
export const EpochMs = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** A count of books or requests. */
export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** The marketplace codes of `src/core/regions.ts`, so the two cannot drift apart. */
export const Region = Schema.Literals(REGIONS.map(region => region.code))

/** The overview is capped at 600 characters, however long Goodreads' text is (PRD, R5). */
export const DESCRIPTION_MAX = 600

/** The most genres kept for a book, as the userscript keeps them. */
export const GENRES_MAX = 10

/**
 * The Goodreads rating a badge shows. `url` is the book's page on goodreads.com, which every badge
 * links to; `loose` marks an approximate match (the author matched, the title only roughly).
 */
export const Rating = Schema.Struct({
  r: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 5 })),
  n: Count,
  url: Schema.String.check(
    Schema.isPattern(/^https:\/\/www\.goodreads\.com\/book\/show\/[^?#\s]+$/)
  ),
  loose: Schema.Boolean,
})

/**
 * What the Goodreads book page adds: the labels and year under a badge and the hover overview.
 * `year` is 0 when Goodreads has no publication date, and negative for a book first published
 * before year 1 (The Iliad); `desc` is plain text.
 */
export const Details = Schema.Struct({
  genres: Schema.Array(Schema.String).check(Schema.isMaxLength(GENRES_MAX)),
  year: Schema.Int,
  desc: Schema.String.check(Schema.isMaxLength(DESCRIPTION_MAX)),
})

/** Public cash price from Audible; credits are not cash prices. */
export const Price = Schema.Struct({
  amount: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
})
