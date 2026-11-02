/**
 * The popup's one-off requests to the background (`runtime.sendMessage`, ARCHITECTURE.md §5) and the
 * replies. They replace the userscript's menu commands. Not port messages: a port belongs to a tab
 * with a book list, and the popup has neither.
 */
import * as Schema from 'effect/Schema'
import { Count } from './common'

/** How much the cache holds; the reply is `Stats`. */
export const CacheStatsRequest = Schema.TaggedStruct('CacheStats', {})

/**
 * Empties the cache. `unpinned` keeps the books seen in Library and Wish List; `all` leaves nothing.
 * The reply is `Cleared`.
 */
export const ClearCacheRequest = Schema.TaggedStruct('ClearCache', {
  scope: Schema.Literals(['unpinned', 'all']),
})

export const PopupRequest = Schema.Union([CacheStatsRequest, ClearCacheRequest])
export type PopupRequest = typeof PopupRequest.Type

/** What the cache holds (the fields of `CacheStats` in `BookCache`). */
export const Stats = Schema.TaggedStruct('Stats', {
  books: Count,
  entries: Count,
  bytes: Count,
  pinned: Count,
})

export type Stats = typeof Stats.Type

/** How many entries a clear deleted. */
export const Cleared = Schema.TaggedStruct('Cleared', { deleted: Count })

/** The cache could not be read or cleared (IndexedDB failed). */
export const Failed = Schema.TaggedStruct('Failed', { message: Schema.String })

export const PopupReply = Schema.Union([Stats, Cleared, Failed])
export type PopupReply = typeof PopupReply.Type
export type ClearScope = Extract<PopupRequest, { _tag: 'ClearCache' }>['scope']
