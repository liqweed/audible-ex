/**
 * When cache entries expire, which are purgeable and when a pin is refreshed or lapses: the
 * userscript's `cacheGet`, `pin` and `purge` rules (v2.4.0) as pure functions of timestamps.
 * `BookCache` supplies the time, so these never read a clock.
 */

const DAY_MS = 864e5

/** A found rating is kept 30 days, then looked up again. */
export const TTL_FOUND = 30 * DAY_MS

/** A rating that was not found on Goodreads is retried after 7 days. */
export const TTL_MISS = 7 * DAY_MS

/** Audible metadata and Goodreads details follow the found-rating limit. */
export const TTL_META = TTL_FOUND
export const TTL_DETAILS = TTL_FOUND

/** The daily purge deletes unpinned entries older than this (a little past the longest limit). */
export const PURGE_AGE = 32 * DAY_MS

/** A pin lapses this long after the book was last seen in Library or Wish List. */
export const PIN_KEEP = 180 * DAY_MS

/** A pin is written at most this often per book. */
export const PIN_REFRESH = DAY_MS

/** The automatic purge runs at most this often. */
export const PURGE_INTERVAL = DAY_MS

/** True once `savedAt` is more than `ttl` ago; a record exactly `ttl` old is still good. */
export const isExpired = (savedAt: number, ttl: number, now: number) =>
  now - savedAt > ttl

/** The time limit of a rating record: hits and misses differ. */
export const ratingTtl = (tag: 'Found' | 'Miss') =>
  tag === 'Found' ? TTL_FOUND : TTL_MISS

/** True when the daily purge may delete an unpinned entry saved at `savedAt`. */
export const isPurgeable = (savedAt: number, now: number) =>
  now - savedAt > PURGE_AGE

/** True when a pin last written at `lastSeen` (`undefined`: no pin) is due a new write. */
export const needsPinWrite = (lastSeen: number | undefined, now: number) =>
  lastSeen === undefined || now - lastSeen >= PIN_REFRESH

/** True when a pin last seen at `lastSeen` has lapsed. */
export const isPinLapsed = (lastSeen: number, now: number) =>
  now - lastSeen > PIN_KEEP

/** True once a full day has passed since the purge last ran (`undefined`: never). */
export const isPurgeDue = (lastPurge: number | undefined, now: number) =>
  lastPurge === undefined || now - lastPurge >= PURGE_INTERVAL
