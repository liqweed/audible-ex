import * as Schema from 'effect/Schema'
import { Asin, EpochMs, GoodreadsId, Rating } from './common'

/** A local summary, without book descriptions or an export format. */
export const CachedBook = Schema.Struct({
  asin: Asin,
  title: Schema.String,
  author: Schema.String,
  savedAt: EpochMs,
  bookId: Schema.optional(GoodreadsId),
  rating: Schema.optional(Rating),
  manual: Schema.Boolean,
  pinned: Schema.Boolean,
})
export type CachedBook = typeof CachedBook.Type
export const InspectorRequest = Schema.Union([
  Schema.TaggedStruct('ListCachedBooks', {}),
  Schema.TaggedStruct('ListGenres', {}),
  Schema.TaggedStruct('DeleteCachedBook', { asin: Asin }),
  Schema.TaggedStruct('CorrectCachedBook', {
    asin: Asin,
    url: Schema.String.check(Schema.isMaxLength(2048)),
  }),
])
export type InspectorRequest = typeof InspectorRequest.Type
export const InspectorReply = Schema.Union([
  Schema.TaggedStruct('CachedBooks', { books: Schema.Array(CachedBook) }),
  Schema.TaggedStruct('Genres', { genres: Schema.Array(Schema.String) }),
  Schema.TaggedStruct('CacheChanged', {}),
  Schema.TaggedStruct('Failed', { message: Schema.String }),
])
export type InspectorReply = typeof InspectorReply.Type
