/**
 * The book cache (ARCHITECTURE.md §4, §8): ratings and metadata by ASIN, details by Goodreads book
 * id, and the pins of books seen in Library or Wish List, in IndexedDB through `idb` (DECISIONS.md
 * D13). The rules are the userscript's `cacheGet`, `pin` and `purge`; the time limits are in
 * `src/core/expiry.ts`.
 *
 * Time comes only from Effect's `Clock`, so `TestClock` drives every test. A rating can be stored
 * only as `Found` or `Miss`: a failed lookup has no representation, so it can't be cached.
 */

import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import {
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  wrap,
} from 'idb'
import {
  isExpired,
  isPinLapsed,
  isPurgeable,
  isPurgeDue,
  needsPinWrite,
  PURGE_INTERVAL,
  ratingTtl,
  TTL_DETAILS,
  TTL_META,
} from '../core/expiry'
import {
  DetailsRecord,
  HousekeepingRecord,
  MetaRecord,
  OverrideRecord,
  PinRecord,
  RatingRecord,
} from '../schema/cache'

import type { CachedBook } from '../schema/inspector'

type Rating = typeof RatingRecord.Type
type Meta = typeof MetaRecord.Type
type Details = typeof DetailsRecord.Type

/** A record as the caller hands it over: the cache stamps `savedAt` itself. */
type Unstamped<T> = T extends unknown ? Omit<T, 'savedAt'> : never

/** What `clear` deletes: `unpinned` keeps Library, Wish List and manually matched books, `all` leaves nothing. */
export type ClearScope = 'unpinned' | 'all'

export interface CacheStats {
  /** Rating entries stored (found or not found), including expired ones the purge hasn't removed yet. */
  readonly books: number
  /** Ratings, metadata, details and overrides stored; pins and housekeeping are not entries. */
  readonly entries: number
  /** Approximate size of everything stored, as the JSON of its records. */
  readonly bytes: number
  /** Books pinned from Library or Wish List. */
  readonly pinned: number
}

/** IndexedDB failed (quota, a blocked upgrade, a closed database); `operation` says what we tried. */
export class CacheError extends Data.TaggedError('CacheError')<{
  readonly operation: string
  readonly cause: unknown
}> {
  override get message() {
    return `Book cache ${this.operation} failed`
  }
}

export interface BookCacheService {
  readonly list: Effect.Effect<readonly CachedBook[], CacheError>
  readonly deleteBook: (asin: string) => Effect.Effect<void, CacheError>
  readonly getOverride: (
    asin: string
  ) => Effect.Effect<Option.Option<typeof OverrideRecord.Type>, CacheError>
  readonly correct: (
    rating: Extract<Unstamped<Rating>, { _tag: 'Found' }>,
    details: Unstamped<Details>
  ) => Effect.Effect<void, CacheError>

  /** The stored rating, or none when absent, expired (found: 30 days, not found: 7) or unreadable. */
  readonly getRating: (
    asin: string
  ) => Effect.Effect<Option.Option<Rating>, CacheError>
  readonly setRating: (
    rating: Unstamped<Rating>
  ) => Effect.Effect<void, CacheError>
  readonly getMeta: (
    asin: string
  ) => Effect.Effect<Option.Option<Meta>, CacheError>
  readonly setMeta: (meta: Unstamped<Meta>) => Effect.Effect<void, CacheError>
  readonly getDetails: (
    bookId: string
  ) => Effect.Effect<Option.Option<Details>, CacheError>
  readonly setDetails: (
    details: Unstamped<Details>
  ) => Effect.Effect<void, CacheError>
  /** Records that the book was seen in Library or Wish List; writes at most once a day per book. */
  readonly pin: (asin: string) => Effect.Effect<void, CacheError>
  /**
   * The daily clean-up: drops pins last seen over 180 days ago, then unpinned entries saved over 32
   * days ago. Returns how many entries it deleted.
   */
  readonly purge: Effect.Effect<number, CacheError>
  /** `purge`, but only when a day has passed since it last ran; none when it wasn't due. */
  readonly purgeIfDue: Effect.Effect<Option.Option<number>, CacheError>
  /** Deletes entries of any age and returns how many; pins that lapsed are dropped first. */
  readonly clear: (scope: ClearScope) => Effect.Effect<number, CacheError>
  readonly stats: Effect.Effect<CacheStats, CacheError>
}

export class BookCache extends Context.Service<BookCache, BookCacheService>()(
  'audible-ex/BookCache'
) {
  /**
   * The cache over an IndexedDB factory: `self.indexedDB` in the worker, a `fake-indexeddb` one in
   * tests. Closes the database with the layer and starts the daily purge (see `sweeper`).
   */
  static layer = (factory: IDBFactory): Layer.Layer<BookCache, CacheError> =>
    Layer.effect(BookCache, make(factory))
}

export const DB_NAME = 'audible-ex-cache'
export const DB_VERSION = 2

interface CacheDb extends DBSchema {
  ratings: { key: string; value: Rating; indexes: { savedAt: number } }
  meta: { key: string; value: Meta; indexes: { savedAt: number } }
  details: { key: string; value: Details; indexes: { savedAt: number } }
  pins: {
    key: string
    value: typeof PinRecord.Type
    indexes: { lastSeen: number }
  }
  overrides: { key: string; value: typeof OverrideRecord.Type }
  housekeeping: { key: string; value: typeof HousekeepingRecord.Type }
}

type Db = IDBPDatabase<CacheDb>
type AllStores = [
  'ratings',
  'meta',
  'details',
  'pins',
  'housekeeping',
  'overrides',
]
type WriteTx = IDBPTransaction<CacheDb, AllStores, 'readwrite'>

/**
 * Opens the database on `factory`; `idb`'s `openDB` would use the global `indexedDB`. Closes the
 * connection when another one asks for a version change, and rejects when this open is blocked.
 */
const open = (factory: IDBFactory) => {
  const request = factory.open(DB_NAME, DB_VERSION)
  request.addEventListener('upgradeneeded', event => {
    const db = request.result
    // One block per version, so a later version only adds what it changes.
    if (event.oldVersion < 1) {
      const keyed = [
        ['ratings', 'asin', 'savedAt'],
        ['meta', 'asin', 'savedAt'],
        ['details', 'bookId', 'savedAt'],
        ['pins', 'asin', 'lastSeen'],
      ] as const
      for (const [name, keyPath, timestamp] of keyed) {
        db.createObjectStore(name, { keyPath }).createIndex(
          timestamp,
          timestamp
        )
      }
      db.createObjectStore('housekeeping', { keyPath: 'name' })
    }
    if (event.oldVersion < 2)
      db.createObjectStore('overrides', { keyPath: 'asin' })
  })
  return new Promise<Db>((resolve, reject) => {
    let settled = false
    // Another connection holds an older version open and won't let go: fail instead of waiting.
    request.addEventListener('blocked', () => {
      settled = true
      reject(new Error('the cache database is blocked by another connection'))
    })
    ;(wrap(request) as Promise<Db>).then(db => {
      // Let a newer version (a later release of the extension) upgrade the database.
      db.addEventListener('versionchange', () => db.close())
      if (settled) db.close()
      else resolve(db)
    }, reject)
  })
}

const decodeOverride = Schema.decodeUnknownOption(OverrideRecord)
const decodeRating = Schema.decodeUnknownOption(RatingRecord)
const decodeMeta = Schema.decodeUnknownOption(MetaRecord)
const decodeDetails = Schema.decodeUnknownOption(DetailsRecord)
const decodePin = Schema.decodeUnknownOption(PinRecord)
const decodeHousekeeping = Schema.decodeUnknownOption(HousekeepingRecord)

/**
 * The record under `key`, decoded. A record that doesn't decode (written by a bug or an older
 * version) is deleted and read as absent rather than crashing the lookup. Reading is a plain read;
 * only an undecodable record costs a write transaction.
 */
const readRecord = async <T>(
  db: Db,
  name: 'ratings' | 'meta' | 'details' | 'overrides',
  key: string,
  decode: (raw: unknown) => Option.Option<T>
): Promise<Option.Option<T>> => {
  const raw: unknown = await db.get(name, key)
  if (raw === undefined) return Option.none()
  const record = decode(raw)
  if (Option.isNone(record)) {
    // Look again inside the transaction that deletes, so a good record stored since the read stays.
    const tx = db.transaction(name, 'readwrite')
    if (Option.isNone(decode(await tx.store.get(key)))) {
      await tx.store.delete(key)
    }
    await tx.done
  }
  return record
}

/** A cursor over a store or index, loosely typed so one loop serves all three entry stores. */
interface SweepCursor {
  readonly primaryKey: IDBValidKey
  readonly value: { readonly savedAt?: unknown }
  delete(): Promise<void>
  continue(): Promise<SweepCursor | null>
}
interface Walkable {
  openCursor(): Promise<SweepCursor | null>
}

const ENTRY_STORES = ['ratings', 'meta', 'details'] as const

/** Deletes the lapsed pins and returns the ASINs still pinned. */
const livePins = async (tx: WriteTx, now: number): Promise<Set<string>> => {
  const pins = tx.objectStore('pins')
  // Ordered by `lastSeen`, so stop at the first pin that hasn't lapsed.
  let cursor = await pins.index('lastSeen').openCursor()
  while (cursor && isPinLapsed(cursor.value.lastSeen, now)) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  const live = new Set<string>()
  for (const raw of await pins.getAll()) {
    const pin = decodePin(raw)
    if (Option.isSome(pin)) live.add(pin.value.asin)
    else await pins.delete((raw as { asin: string }).asin)
  }
  return live
}

/**
 * The Goodreads ids whose details stay: those of the pinned ASINs' found ratings. A pinned book
 * with only a miss has no details to keep.
 */
const pinnedBookIds = async (tx: WriteTx, asins: Set<string>) => {
  const ids = new Set<string>()
  for (const asin of asins) {
    const rating = decodeRating(await tx.objectStore('ratings').get(asin))
    if (Option.isSome(rating) && rating.value._tag === 'Found') {
      ids.add(rating.value.bookId)
    }
  }
  return ids
}

/**
 * Deletes the unpinned entries of ratings, meta and details. `purge` takes those older than the
 * purge age, walking each store's timestamp index oldest first and stopping at the first entry that
 * is young enough; `unpinned` takes every entry, however young.
 */
const deleteUnpinned = async (
  tx: WriteTx,
  now: number,
  how: 'purge' | 'unpinned'
): Promise<number> => {
  const asins = await livePins(tx, now)
  const overrides = (await tx.objectStore('overrides').getAll()).flatMap(raw =>
    Option.toArray(decodeOverride(raw))
  )
  for (const record of overrides) asins.add(record.asin)
  const bookIds = await pinnedBookIds(tx, asins)
  for (const record of overrides) bookIds.add(record.bookId)
  let deleted = 0
  for (const name of ENTRY_STORES) {
    const store = tx.objectStore(name)
    const pinned = name === 'details' ? bookIds : asins
    const source: Walkable =
      how === 'purge' ? store.index('savedAt') : (store as Walkable)
    let cursor = await source.openCursor()
    while (cursor) {
      const { savedAt } = cursor.value
      if (
        how === 'purge' &&
        !(typeof savedAt === 'number' && isPurgeable(savedAt, now))
      ) {
        break
      }
      if (typeof cursor.primaryKey !== 'string') {
        throw new TypeError(`${name} holds a key that isn't a string`)
      }
      if (!pinned.has(cursor.primaryKey)) {
        await cursor.delete()
        deleted++
      }
      cursor = await cursor.continue()
    }
  }
  return deleted
}

const writeTx = (db: Db) =>
  db.transaction(
    ['ratings', 'meta', 'details', 'pins', 'housekeeping', 'overrides'],
    'readwrite'
  )

/** The purge, and the note of when it ran, in one transaction. */
const purgeNow = async (db: Db, now: number) => {
  const tx = writeTx(db)
  const deleted = await deleteUnpinned(tx, now, 'purge')
  await tx.objectStore('housekeeping').put({ name: 'lastPurge', at: now })
  await tx.done
  return deleted
}

/** The purge when the persisted time of the last one is a day old or more; the check and the purge share one transaction, so two callers can't both run it. */
const purgeIfDueNow = async (db: Db, now: number) => {
  const tx = writeTx(db)
  const last = decodeHousekeeping(
    await tx.objectStore('housekeeping').get('lastPurge')
  )
  const lastPurge = Option.isSome(last) ? last.value.at : undefined
  if (!isPurgeDue(lastPurge, now)) {
    await tx.done
    return Option.none<number>()
  }
  const deleted = await deleteUnpinned(tx, now, 'purge')
  await tx.objectStore('housekeeping').put({ name: 'lastPurge', at: now })
  await tx.done
  return Option.some(deleted)
}

const clearNow = async (db: Db, now: number, scope: ClearScope) => {
  const tx = writeTx(db)
  let deleted: number
  if (scope === 'unpinned') {
    deleted = await deleteUnpinned(tx, now, 'unpinned')
  } else {
    deleted = 0
    deleted += await tx.objectStore('overrides').count()
    for (const name of ENTRY_STORES)
      deleted += await tx.objectStore(name).count()
    for (const name of [...ENTRY_STORES, 'pins', 'overrides'] as const) {
      await tx.objectStore(name).clear()
    }
  }
  await tx.done
  return deleted
}

const statsNow = async (db: Db): Promise<CacheStats> => {
  const tx = db.transaction(
    ['ratings', 'meta', 'details', 'pins', 'overrides'],
    'readonly'
  )
  const [ratings, meta, details, pins, overrides] = await Promise.all([
    tx.objectStore('ratings').getAll(),
    tx.objectStore('meta').getAll(),
    tx.objectStore('details').getAll(),
    tx.objectStore('pins').getAll(),
    tx.objectStore('overrides').getAll(),
  ])
  const bytes = [ratings, meta, details, pins, overrides]
    .flat()
    .reduce((sum, record) => sum + JSON.stringify(record).length, 0)
  return {
    books: ratings.length,
    entries: ratings.length + meta.length + details.length + overrides.length,
    bytes,
    pinned: pins.length,
  }
}

/** One consistent snapshot, including expired ratings and metadata-only books. */
const listNow = async (db: Db, now: number): Promise<readonly CachedBook[]> => {
  const tx = db.transaction(
    ['ratings', 'meta', 'pins', 'overrides'],
    'readonly'
  )
  const [ratings, metadata, overrides, pins] = await Promise.all([
    tx.objectStore('ratings').getAll(),
    tx.objectStore('meta').getAll(),
    tx.objectStore('overrides').getAll(),
    tx.objectStore('pins').getAll(),
  ])
  await tx.done
  const valid = <T>(
    raw: unknown[],
    decode: (raw: unknown) => Option.Option<T>
  ) => raw.flatMap(r => Option.toArray(decode(r)))
  const byAsin = <T extends { readonly asin: string }>(records: T[]) =>
    new Map(records.map(r => [r.asin, r]))
  const rs = byAsin(valid(ratings, decodeRating))
  const ms = byAsin(valid(metadata, decodeMeta))
  const os = byAsin(valid(overrides, decodeOverride))
  const ps = byAsin(
    valid(pins, decodePin).filter(p => !isPinLapsed(p.lastSeen, now))
  )
  return [...new Set([...rs.keys(), ...ms.keys(), ...os.keys()])].map(asin => {
    const rating = rs.get(asin),
      meta = ms.get(asin),
      override = os.get(asin)
    const found =
      rating?._tag === 'Found' &&
      (!override || override.bookId === rating.bookId)
        ? rating
        : undefined
    return {
      asin,
      title: meta?.title ?? asin,
      author: meta?.author ?? '',
      savedAt: Math.max(
        rating?.savedAt ?? 0,
        meta?.savedAt ?? 0,
        override?.savedAt ?? 0
      ),
      ...(found && {
        rating: { r: found.r, n: found.n, url: found.url, loose: found.loose },
      }),
      ...((override?.bookId ?? found?.bookId) && {
        bookId: override?.bookId ?? found?.bookId,
      }),
      manual: !!override,
      pinned: ps.has(asin),
    }
  })
}

const deleteBookNow = async (db: Db, asin: string) => {
  const tx = writeTx(db)
  const rating = decodeRating(await tx.objectStore('ratings').get(asin))
  const override = decodeOverride(await tx.objectStore('overrides').get(asin))
  const ids = new Set<string>()
  if (Option.isSome(rating) && rating.value._tag === 'Found')
    ids.add(rating.value.bookId)
  if (Option.isSome(override)) ids.add(override.value.bookId)
  for (const name of ['ratings', 'meta', 'pins', 'overrides'] as const)
    await tx.objectStore(name).delete(asin)
  for (const raw of await tx.objectStore('ratings').getAll()) {
    const r = decodeRating(raw)
    if (Option.isSome(r) && r.value._tag === 'Found') ids.delete(r.value.bookId)
  }
  for (const raw of await tx.objectStore('overrides').getAll()) {
    const o = decodeOverride(raw)
    if (Option.isSome(o)) ids.delete(o.value.bookId)
  }
  for (const id of ids) await tx.objectStore('details').delete(id)
  await tx.done
}

const pinNow = async (db: Db, asin: string, now: number) => {
  const tx = db.transaction('pins', 'readwrite')
  const existing = decodePin(await tx.store.get(asin))
  if (needsPinWrite(Option.getOrUndefined(existing)?.lastSeen, now)) {
    await tx.store.put({ asin, lastSeen: now })
  }
  await tx.done
}

/** The wait after start-up before the first purge, as the userscript's `setTimeout(…, 5000)`. */
export const PURGE_START_DELAY = Duration.seconds(5)

const make = (factory: IDBFactory) =>
  Effect.gen(function* () {
    const db = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => open(factory),
        catch: cause => new CacheError({ operation: 'open', cause }),
      }),
      db => Effect.sync(() => db.close())
    )

    const run = <A>(operation: string, attempt: () => Promise<A>) =>
      Effect.tryPromise({
        try: attempt,
        catch: cause => new CacheError({ operation, cause }),
      })

    const get = <T extends { readonly savedAt: number }>(
      operation: string,
      name: 'ratings' | 'meta' | 'details' | 'overrides',
      decode: (raw: unknown) => Option.Option<T>,
      ttl: (record: T) => number
    ) =>
      Effect.fn(`BookCache.${operation}`)(function* (key: string) {
        const now = yield* Clock.currentTimeMillis
        const record = yield* run(operation, () =>
          readRecord(db, name, key, decode)
        )
        return Option.filter(record, r => !isExpired(r.savedAt, ttl(r), now))
      })

    const set =
      <T extends object>(
        operation: string,
        put: (record: T & { savedAt: number }) => Promise<unknown>
      ) =>
      (record: T) =>
        Effect.flatMap(Clock.currentTimeMillis, savedAt =>
          run(operation, () => put({ ...record, savedAt }))
        )

    const atNow = <A>(operation: string, f: (now: number) => Promise<A>) =>
      Effect.flatMap(Clock.currentTimeMillis, now =>
        run(operation, () => f(now))
      )

    const service: BookCacheService = {
      getRating: get('getRating', 'ratings', decodeRating, r =>
        ratingTtl(r._tag)
      ),
      setRating: set('setRating', async r => {
        const tx = db.transaction(['ratings', 'overrides'], 'readwrite')
        const override = decodeOverride(
          await tx.objectStore('overrides').get(r.asin)
        )
        if (
          Option.isNone(override) ||
          (r._tag === 'Found' && r.bookId === override.value.bookId)
        ) {
          await tx.objectStore('ratings').put(r)
        }
        await tx.done
      }),
      getOverride: asin =>
        run('getOverride', () =>
          readRecord(db, 'overrides', asin, decodeOverride)
        ),
      list: atNow('list', now => listNow(db, now)),
      deleteBook: asin => run('deleteBook', () => deleteBookNow(db, asin)),
      correct: (rating, details) =>
        atNow('correct', async savedAt => {
          const tx = writeTx(db)
          await tx
            .objectStore('overrides')
            .put({ asin: rating.asin, bookId: rating.bookId, savedAt })
          await tx.objectStore('ratings').put({ ...rating, savedAt })
          await tx.objectStore('details').put({ ...details, savedAt })
          await tx.done
        }),
      getMeta: get('getMeta', 'meta', decodeMeta, () => TTL_META),
      setMeta: set('setMeta', r => db.put('meta', r)),
      getDetails: get(
        'getDetails',
        'details',
        decodeDetails,
        () => TTL_DETAILS
      ),
      setDetails: set('setDetails', r => db.put('details', r)),
      pin: asin => atNow('pin', now => pinNow(db, asin, now)),
      purge: atNow('purge', now => purgeNow(db, now)),
      purgeIfDue: atNow('purgeIfDue', now => purgeIfDueNow(db, now)),
      clear: scope => atNow('clear', now => clearNow(db, now, scope)),
      stats: run('stats', () => statsNow(db)),
    }

    yield* Effect.forkScoped(sweeper(service))
    return service
  })

/**
 * Waits a few seconds, then runs `purgeIfDue` and repeats once a day while the worker lives. A
 * worker that restarts re-checks the persisted time of the last purge, so the purge still runs at
 * most once a day. A failed purge is logged and tried again the next day; it never ends the fibre.
 */
const sweeper = (cache: BookCacheService) =>
  Effect.sleep(PURGE_START_DELAY).pipe(
    Effect.andThen(
      cache.purgeIfDue.pipe(
        Effect.catchCause(cause =>
          Effect.logError('The daily cache purge failed', cause)
        ),
        Effect.repeat(Schedule.spaced(Duration.millis(PURGE_INTERVAL)))
      )
    )
  )
