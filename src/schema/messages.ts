/**
 * The messages on the `agx` port between a tab's content script and the background worker
 * (ARCHITECTURE.md §5): one tagged union per direction, decoded on receipt on both sides. The
 * popup's one-off `sendMessage` requests are not port messages and are not here.
 */
import * as Schema from 'effect/Schema'
import { Asin, Count, Details, EpochMs, Price, Rating, Region } from './common'

// ---------- content script → background ----------

/** The kind of Audible page the tab shows. */
export const Page = Schema.Literals([
  'home',
  'search',
  'category',
  'deals',
  'library',
  'wishlist',
  'other',
])

/** First message on a port: which marketplace and page this tab shows. */
export const Hello = Schema.TaggedStruct('Hello', {
  region: Region,
  page: Page,
})

/**
 * The ASINs that scrolled into view; `pinned` is set on Library and Wish List rows. `ratingOnly`
 * stops the lookup after the rating, when the filters may hide the book on it (eager filtering);
 * the content script asks for the rest with `DetailsLookup` if they do not. `cacheOnly` answers the
 * rating only if the cache has it and otherwise does nothing, not even count the book: its price may
 * still hide it, and the content script sends a plain lookup once the price lets it through.
 */
export const Lookup = Schema.TaggedStruct('Lookup', {
  items: Schema.Array(
    Schema.Struct({
      asin: Asin,
      pinned: Schema.Boolean,
      ratingOnly: Schema.optional(Schema.Boolean),
      cacheOnly: Schema.optional(Schema.Boolean),
    })
  ),
})

/** Read the Goodreads book page of ASINs whose `ratingOnly` lookup has answered with a rating. */
export const DetailsLookup = Schema.TaggedStruct('DetailsLookup', {
  asins: Schema.Array(Asin),
})

/** Look up again the ASINs whose lookup failed. */
export const Retry = Schema.TaggedStruct('Retry', {
  asins: Schema.Array(Asin),
})

/** Fresh prices for visible ASINs, requested only while a price limit is active. */
export const PriceLookup = Schema.TaggedStruct('PriceLookup', {
  asins: Schema.Array(Asin),
})

export const ContentMessage = Schema.Union([
  Hello,
  Lookup,
  DetailsLookup,
  Retry,
  PriceLookup,
])
export type ContentMessage = typeof ContentMessage.Type

// ---------- background → content script ----------

/** Why a lookup failed; the tags are the errors of ARCHITECTURE.md §4. */
export const BookError = Schema.Struct({
  reason: Schema.Literals([
    'httpError',
    'rateLimited',
    'formatChanged',
    'noMetadata',
  ]),
  message: Schema.String,
})

/**
 * What is known about one book. `ready` carries the `rating`, and the `details` once the book page
 * has been read; `failed` carries the `error`; `loading` and `notFound` carry neither. A `ready`
 * without a rating or a `failed` without an error is refused, with the error naming the field.
 * (`queued` is a state of the content script's store only; the background never sends it.)
 */
export const BookUpdate = Schema.TaggedStruct('BookUpdate', {
  asin: Asin,
  status: Schema.Literals(['loading', 'ready', 'notFound', 'failed']),
  rating: Schema.optional(Rating),
  details: Schema.optional(Details),
  error: Schema.optional(BookError),
}).check(
  Schema.makeFilter(update => {
    if (update.status === 'ready' && update.rating === undefined) {
      return { path: ['rating'], issue: 'Missing key' }
    }
    if (update.status === 'failed' && update.error === undefined) {
      return { path: ['error'], issue: 'Missing key' }
    }
    return undefined
  })
)

/** This tab's lookup counters; `pausedUntil` is set while the queue backs off. */
export const Progress = Schema.TaggedStruct('Progress', {
  queued: Count,
  active: Count,
  done: Count,
  cached: Count,
  notFound: Count,
  failed: Count,
  pausedUntil: Schema.optional(EpochMs),
})

/** No price means unavailable (including request failure); ratings remain usable. */
export const PriceUpdate = Schema.TaggedStruct('PriceUpdate', {
  asin: Asin,
  price: Schema.optional(Price),
})

export const BackgroundMessage = Schema.Union([
  BookUpdate,
  Progress,
  PriceUpdate,
])
export type BackgroundMessage = typeof BackgroundMessage.Type
