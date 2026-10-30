/**
 * Fakes for the `LookupQueue` and `PortServer` tests: an in-memory `BookCache` (no IndexedDB, so
 * every step is synchronous and a `TestClock` alone decides when things happen), scripted
 * `Goodreads` and `AudibleCatalog` services that log every call with the time it was made, and a
 * `Latch` to hold a call open. Test code only; the extension never imports this.
 */

import * as Clock from 'effect/Clock'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import type { Match } from '../core/matching'
import type { DetailsRecord, MetaRecord, RatingRecord } from '../schema/cache'
import type { Details } from '../schema/common'
import { AudibleCatalog, type AudibleCatalogError } from './AudibleCatalog'
import { BookCache, type BookCacheService, CacheError } from './BookCache'
import type { GoodreadsError } from './Goodreads'
import { Goodreads } from './Goodreads'

type Rating = typeof RatingRecord.Type
type Meta = typeof MetaRecord.Type
type StoredDetails = typeof DetailsRecord.Type

/** A valid ASIN for each number. */
export const asin = (n: number) => `B${String(n).padStart(9, '0')}`

/** A valid Goodreads book id for each number. */
export const bookId = (n: number) => String(1000 + n)

/** The number `asin(n)` was made from. */
export const numberOf = (a: string) => Number(a.slice(1))

/** What the fake search finds for book number `n`. */
export const matchFor = (n: number): Match => ({
  bookId: bookId(n),
  rating: 4.25,
  count: 1234,
  url: `https://www.goodreads.com/book/show/${bookId(n)}-book-${n}`,
  loose: false,
})

export const detailsFor = (n: number): typeof Details.Type => ({
  genres: ['Fiction', `Genre ${n}`],
  year: 2000 + n,
  desc: `About book ${n}`,
})

/** Lets every fibre that can run, run, without moving the clock. */
export const settle = Effect.forEach(
  Array.from({ length: 20 }),
  () => Effect.yieldNow,
  { discard: true }
)

/** A gate a test opens when it wants a held call to go on. */
export interface Latch {
  readonly wait: Effect.Effect<void>
  readonly open: Effect.Effect<void>
}

export const latch = (): Latch => {
  const deferred = Deferred.makeUnsafe<void>()
  return {
    wait: Deferred.await(deferred),
    open: Deferred.succeed(deferred, undefined).pipe(Effect.asVoid),
  }
}

export interface MemoryCache {
  readonly layer: Layer.Layer<BookCache>
  readonly ratings: Map<string, Rating>
  readonly meta: Map<string, Meta>
  readonly details: Map<string, StoredDetails>
  readonly pins: string[]
}

/**
 * A `BookCache` that keeps everything in maps and never expires. With `broken`, every operation
 * fails with a `CacheError`, as IndexedDB does when the quota is gone.
 */
export const memoryCache = (
  options: { broken?: boolean } = {}
): MemoryCache => {
  const ratings = new Map<string, Rating>()
  const meta = new Map<string, Meta>()
  const details = new Map<string, StoredDetails>()
  const pins: string[] = []
  const unused = Effect.die('not used by the lookup tests')
  const service: BookCacheService = {
    getRating: asin =>
      Effect.sync(() => Option.fromUndefinedOr(ratings.get(asin))),
    setRating: rating =>
      Effect.sync(() => {
        ratings.set(rating.asin, { ...rating, savedAt: 0 } as Rating)
      }),
    getMeta: asin => Effect.sync(() => Option.fromUndefinedOr(meta.get(asin))),
    setMeta: record =>
      Effect.sync(() => {
        meta.set(record.asin, { ...record, savedAt: 0 })
      }),
    getDetails: id =>
      Effect.sync(() => Option.fromUndefinedOr(details.get(id))),
    setDetails: record =>
      Effect.sync(() => {
        details.set(record.bookId, { ...record, savedAt: 0 })
      }),
    pin: asin =>
      Effect.sync(() => {
        pins.push(asin)
      }),
    purge: unused,
    purgeIfDue: unused,
    clear: () => unused,
    stats: unused,
  }
  const broken = (operation: string) =>
    Effect.fail(new CacheError({ operation, cause: 'broken on purpose' }))
  const failing: BookCacheService = {
    ...service,
    getRating: () => broken('getRating'),
    setRating: () => broken('setRating'),
    getMeta: () => broken('getMeta'),
    setMeta: () => broken('setMeta'),
    getDetails: () => broken('getDetails'),
    setDetails: () => broken('setDetails'),
    pin: () => broken('pin'),
  }
  return {
    layer: Layer.succeed(
      BookCache,
      BookCache.of(options.broken ? failing : service)
    ),
    ratings,
    meta,
    details,
    pins,
  }
}

/** One call to a fake service, with the clock reading when it was made. */
export interface Call {
  readonly kind: 'search' | 'details' | 'catalog'
  /** The title searched for, the book id read or the ASIN looked up. */
  readonly key: string
  readonly at: number
}

export interface Behaviour {
  /** Answers a search for book `n` (the number in the title `Title B0000000nn`); the default finds it. */
  readonly search?: (
    n: number,
    call: number
  ) => Effect.Effect<Option.Option<Match>, GoodreadsError>
  /** Answers a book page read; the default returns `detailsFor`. */
  readonly details?: (
    id: string,
    call: number
  ) => Effect.Effect<typeof Details.Type, GoodreadsError>
  /** Answers a catalogue lookup; the default titles the book after its ASIN. */
  readonly catalog?: (
    asin: string
  ) => Effect.Effect<{ title: string; author: string }, AudibleCatalogError>
}

export interface Fakes {
  /** Every call to a fake service so far, in order. */
  readonly calls: Call[]
  readonly layer: Layer.Layer<Goodreads | AudibleCatalog>
}

/** `Goodreads` and `AudibleCatalog` whose answers a test scripts and whose calls it can read. */
export const fakes = (behaviour: Behaviour = {}): Fakes => {
  const calls: Call[] = []
  const counts = new Map<string, number>()
  const record = (kind: Call['kind'], key: string) =>
    Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis
      calls.push({ kind, key, at })
      const id = `${kind}:${key}`
      const nth = (counts.get(id) ?? 0) + 1
      counts.set(id, nth)
      return nth
    })

  const goodreads = Goodreads.of({
    search: book =>
      Effect.gen(function* () {
        const nth = yield* record('search', book.title)
        const n = numberOf(/B\d{9}/.exec(book.title)?.[0] ?? asin(0))
        return yield* behaviour.search
          ? behaviour.search(n, nth)
          : Effect.succeedSome(matchFor(n))
      }),
    details: id =>
      Effect.gen(function* () {
        const nth = yield* record('details', id)
        return yield* behaviour.details
          ? behaviour.details(id, nth)
          : Effect.succeed(detailsFor(Number(id) - 1000))
      }),
  })
  const catalog = AudibleCatalog.of({
    lookup: (_region, a) =>
      Effect.gen(function* () {
        yield* record('catalog', a)
        return yield* behaviour.catalog
          ? behaviour.catalog(a)
          : Effect.succeed({ title: `Title ${a}`, author: 'An Author' })
      }),
  })
  return {
    calls,
    layer: Layer.merge(
      Layer.succeed(Goodreads, goodreads),
      Layer.succeed(AudibleCatalog, catalog)
    ),
  }
}
