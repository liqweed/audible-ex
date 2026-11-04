import { describe, expect, test } from 'bun:test'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { TestClock } from 'effect/testing'
import { IDBFactory } from 'fake-indexeddb'
import { type IDBPDatabase, wrap } from 'idb'
import {
  BookCache,
  type BookCacheService,
  CacheError,
  DB_NAME,
  DB_VERSION,
  PURGE_START_DELAY,
} from './BookCache'

const DAY = 864e5
const HOUR = 36e5
const START = 1_761_700_000_000

const found = {
  _tag: 'Found',
  asin: 'B08G9PRS1K',
  bookId: '54493401',
  r: 4.52,
  n: 1_200_000,
  url: 'https://www.goodreads.com/book/show/54493401-project-hail-mary',
  loose: false,
} as const
const miss = { _tag: 'Miss', asin: 'B0000MISS1' } as const
const meta = {
  asin: 'B08G9PRS1K',
  title: 'Project Hail Mary',
  author: 'Andy Weir',
} as const
const details = {
  bookId: '54493401',
  genres: ['Science Fiction'],
  year: 2021,
  desc: 'A lone astronaut.',
} as const

interface Book {
  readonly rating: Parameters<BookCacheService['setRating']>[0]
  readonly meta: Parameters<BookCacheService['setMeta']>[0]
  readonly details: Parameters<BookCacheService['setDetails']>[0]
}

/** Project Hail Mary: the book the tests pin. */
const pinnedBook: Book = { rating: found, meta, details }

/** A second book, the one nobody pins. */
const otherBook: Book = {
  rating: {
    ...found,
    asin: 'B002V0QK4C',
    bookId: '7',
    url: 'https://www.goodreads.com/book/show/7-other',
  },
  meta: { ...meta, asin: 'B002V0QK4C', title: 'Other' },
  details: { ...details, bookId: '7' },
}

/** Runs `body` on a `TestClock` set to `START`, with a fresh fake IndexedDB. */
const scenario = (
  name: string,
  body: (factory: IDBFactory) => Effect.Effect<void, unknown>
) =>
  test(name, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(START)
        yield* body(new IDBFactory())
      }).pipe(Effect.provide(TestClock.layer()))
    )
  )

/** One worker lifetime: the cache over `factory`, closed when `use` is done. */
const worker = <A, E>(
  factory: IDBFactory,
  use: (cache: BookCacheService) => Effect.Effect<A, E>
) => BookCache.use(use).pipe(Effect.provide(BookCache.layer(factory)))

const advance = (ms: number) => TestClock.adjust(ms)

/** Writes the three entries of a book and, when `pin`, pins it. */
const store = (cache: BookCacheService, book: Book, pin = false) =>
  Effect.gen(function* () {
    yield* cache.setRating(book.rating)
    yield* cache.setMeta(book.meta)
    yield* cache.setDetails(book.details)
    if (pin) yield* cache.pin(book.rating.asin)
  })

/** Runs `use` on a short-lived raw connection, closed afterwards so it never blocks the cache. */
const withRawDb = <A>(
  factory: IDBFactory,
  use: (db: IDBPDatabase) => Promise<A>
) =>
  Effect.promise(async () => {
    const db = (await wrap(factory.open(DB_NAME))) as IDBPDatabase
    try {
      return await use(db)
    } finally {
      db.close()
    }
  })

/** A record straight from IndexedDB, behind the cache's back. */
const peek = (factory: IDBFactory, storeName: string, key: string) =>
  withRawDb(factory, db => db.get(storeName, key))

/** Writes a record straight into IndexedDB, behind the cache's back. */
const put = (factory: IDBFactory, storeName: string, value: unknown) =>
  withRawDb(factory, async db => {
    await db.put(storeName, value)
  })

/** Which of a book's three entries the cache will hand out. */
const readable = (cache: BookCacheService, book: Book) =>
  Effect.gen(function* () {
    return {
      rating: Option.isSome(yield* cache.getRating(book.rating.asin)),
      meta: Option.isSome(yield* cache.getMeta(book.meta.asin)),
      details: Option.isSome(yield* cache.getDetails(book.details.bookId)),
    }
  })

const everything = { rating: true, meta: true, details: true }
const nothing = { rating: false, meta: false, details: false }

describe('time limits', () => {
  scenario('a found rating is read for 30 days, then absent', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.setRating(found)
        expect(yield* cache.getRating(found.asin)).toEqual(
          Option.some({ ...found, savedAt: START })
        )
        yield* advance(30 * DAY - HOUR)
        expect(Option.isSome(yield* cache.getRating(found.asin))).toBe(true)
        yield* advance(HOUR)
        expect(Option.isSome(yield* cache.getRating(found.asin))).toBe(true)
        yield* advance(1)
        expect(Option.isNone(yield* cache.getRating(found.asin))).toBe(true)
      })
    )
  )

  scenario('a miss is read for 7 days, then absent', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.setRating(miss)
        yield* advance(7 * DAY - HOUR)
        expect(yield* cache.getRating(miss.asin)).toEqual(
          Option.some({ ...miss, savedAt: START })
        )
        yield* advance(HOUR)
        expect(Option.isSome(yield* cache.getRating(miss.asin))).toBe(true)
        yield* advance(1)
        expect(Option.isNone(yield* cache.getRating(miss.asin))).toBe(true)
      })
    )
  )

  scenario('metadata and details are read for 30 days', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.setMeta(meta)
        yield* cache.setDetails(details)
        yield* advance(30 * DAY)
        expect(yield* cache.getMeta(meta.asin)).toEqual(
          Option.some({ ...meta, savedAt: START })
        )
        expect(yield* cache.getDetails(details.bookId)).toEqual(
          Option.some({ ...details, savedAt: START })
        )
        yield* advance(1)
        expect(Option.isNone(yield* cache.getMeta(meta.asin))).toBe(true)
        expect(Option.isNone(yield* cache.getDetails(details.bookId))).toBe(
          true
        )
      })
    )
  )

  scenario('storing again restarts the clock', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.setRating(miss)
        yield* advance(6 * DAY)
        yield* cache.setRating(miss)
        yield* advance(6 * DAY)
        expect(Option.isSome(yield* cache.getRating(miss.asin))).toBe(true)
      })
    )
  )

  scenario('a found rating replaces a miss for the same book', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.setRating({ _tag: 'Miss', asin: found.asin })
        yield* cache.setRating(found)
        const rating = Option.getOrThrow(yield* cache.getRating(found.asin))
        expect(rating._tag).toBe('Found')
      })
    )
  )

  scenario('an unknown book is absent', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        expect(yield* readable(cache, otherBook)).toEqual(nothing)
      })
    )
  )
})

describe('failures are not cached', () => {
  scenario('only a Found or a Miss can be stored as a rating', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        // A lookup that failed has no value of either kind, so there is nothing to pass.
        const failed = () =>
          // @ts-expect-error `Failed` is not a rating a lookup can store
          cache.setRating({ _tag: 'Failed', asin: found.asin })
        const unkinded = () =>
          // @ts-expect-error a rating needs its kind
          cache.setRating({ asin: found.asin })
        expect(failed).toBeFunction()
        expect(unkinded).toBeFunction()
        expect((yield* cache.stats).entries).toBe(0)
      })
    )
  )
})

describe('pins', () => {
  scenario('a pin is written at most once a day', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.pin(found.asin)
        yield* advance(23 * HOUR)
        yield* cache.pin(found.asin)
        expect(yield* peek(factory, 'pins', found.asin)).toEqual({
          asin: found.asin,
          lastSeen: START,
        })
        yield* advance(HOUR)
        yield* cache.pin(found.asin)
        expect(yield* peek(factory, 'pins', found.asin)).toEqual({
          asin: found.asin,
          lastSeen: START + DAY,
        })
        expect((yield* cache.stats).pinned).toBe(1)
      })
    )
  )

  scenario(
    'many tabs pinning one book within a day leave its pin alone',
    factory =>
      worker(factory, cache =>
        Effect.gen(function* () {
          yield* cache.pin(found.asin)
          yield* advance(HOUR)
          yield* Effect.all(
            Array.from({ length: 20 }, () => cache.pin(found.asin)),
            { concurrency: 'unbounded' }
          )
          expect(yield* peek(factory, 'pins', found.asin)).toEqual({
            asin: found.asin,
            lastSeen: START,
          })
        })
      )
  )

  scenario('many tabs pinning a book a day later refresh it once', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.pin(found.asin)
        yield* advance(DAY)
        yield* Effect.all(
          Array.from({ length: 20 }, () => cache.pin(found.asin)),
          { concurrency: 'unbounded' }
        )
        yield* cache.pin(otherBook.rating.asin)
        expect(yield* peek(factory, 'pins', found.asin)).toEqual({
          asin: found.asin,
          lastSeen: START + DAY,
        })
        expect((yield* cache.stats).pinned).toBe(2)
      })
    )
  )

  scenario('a pin lapses 180 days after it was last seen', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.pin(found.asin)
        yield* advance(180 * DAY)
        yield* cache.purge
        expect((yield* cache.stats).pinned).toBe(1)
        yield* advance(1)
        yield* cache.purge
        expect((yield* cache.stats).pinned).toBe(0)
      })
    )
  )

  scenario('seeing the book again keeps the pin alive', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.pin(found.asin)
        yield* advance(100 * DAY)
        yield* cache.pin(found.asin)
        yield* advance(100 * DAY)
        yield* cache.purge
        expect((yield* cache.stats).pinned).toBe(1)
      })
    )
  )
})

describe('purge', () => {
  scenario(
    'deletes unpinned entries over 32 days old, keeps the rest',
    factory =>
      worker(factory, cache =>
        Effect.gen(function* () {
          yield* store(cache, pinnedBook)
          yield* advance(DAY)
          yield* store(cache, otherBook)
          yield* advance(31 * DAY)
          // The first book is exactly 32 days old: not yet over the limit.
          expect(yield* cache.purge).toBe(0)
          expect((yield* cache.stats).entries).toBe(6)
          yield* advance(1)
          expect(yield* cache.purge).toBe(3)
          expect(yield* cache.stats).toMatchObject({ books: 1, entries: 3 })
          expect(yield* peek(factory, 'ratings', found.asin)).toBeUndefined()
          expect(
            yield* peek(factory, 'ratings', otherBook.rating.asin)
          ).toBeDefined()
        })
      )
  )

  scenario('keeps pinned books and their details whatever their age', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* store(cache, pinnedBook, true)
        yield* store(cache, otherBook)
        yield* advance(100 * DAY)
        expect(yield* cache.purge).toBe(3)
        expect(yield* peek(factory, 'ratings', found.asin)).toBeDefined()
        expect(yield* peek(factory, 'meta', found.asin)).toBeDefined()
        expect(yield* peek(factory, 'details', details.bookId)).toBeDefined()
        expect(
          yield* peek(factory, 'ratings', otherBook.rating.asin)
        ).toBeUndefined()
        expect(
          yield* peek(factory, 'meta', otherBook.meta.asin)
        ).toBeUndefined()
        expect(
          yield* peek(factory, 'details', otherBook.details.bookId)
        ).toBeUndefined()
      })
    )
  )

  scenario('an old book is an ordinary one once its pin lapses', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* store(cache, pinnedBook, true)
        yield* advance(180 * DAY)
        yield* cache.purge
        expect((yield* cache.stats).entries).toBe(3)
        yield* advance(1)
        expect(yield* cache.purge).toBe(3)
        expect(yield* cache.stats).toMatchObject({ entries: 0, pinned: 0 })
      })
    )
  )

  scenario('keeps details only for the book id of a found rating', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        // The pinned book was not found, so no details are tied to it.
        yield* cache.setRating(miss)
        yield* cache.pin(miss.asin)
        yield* cache.setDetails(details)
        yield* advance(40 * DAY)
        expect(yield* cache.purge).toBe(1)
        expect(yield* peek(factory, 'ratings', miss.asin)).toBeDefined()
        expect(yield* peek(factory, 'details', details.bookId)).toBeUndefined()
      })
    )
  )

  scenario('drops a pin record that does not decode', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* put(factory, 'pins', { asin: 'B002V0QK4C', lastSeen: 'soon' })
        yield* cache.pin(miss.asin)
        yield* cache.setRating(miss)
        yield* advance(40 * DAY)
        yield* cache.purge
        expect(yield* peek(factory, 'pins', 'B002V0QK4C')).toBeUndefined()
        expect(yield* peek(factory, 'pins', miss.asin)).toBeDefined()
        expect(yield* peek(factory, 'ratings', miss.asin)).toBeDefined()
      })
    )
  )
})

describe('purgeIfDue', () => {
  scenario('runs when it never ran', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* store(cache, otherBook)
        yield* advance(40 * DAY)
        expect(yield* cache.purgeIfDue).toEqual(Option.some(3))
      })
    )
  )

  scenario('does nothing within a day of the last purge', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        expect(yield* cache.purgeIfDue).toEqual(Option.some(0))
        yield* store(cache, otherBook)
        yield* advance(23 * HOUR)
        expect(yield* cache.purgeIfDue).toEqual(Option.none())
        yield* advance(HOUR - 1)
        expect(yield* cache.purgeIfDue).toEqual(Option.none())
        yield* advance(1)
        expect(yield* cache.purgeIfDue).toEqual(Option.some(0))
      })
    )
  )

  scenario('two callers at once purge once', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* store(cache, otherBook)
        yield* advance(40 * DAY)
        const results = yield* Effect.all(
          [cache.purgeIfDue, cache.purgeIfDue],
          { concurrency: 'unbounded' }
        )
        expect(results.filter(Option.isSome)).toHaveLength(1)
      })
    )
  )

  scenario('respects the last purge across a worker restart', factory =>
    Effect.gen(function* () {
      yield* worker(factory, cache => cache.purgeIfDue)
      yield* advance(12 * HOUR)
      expect(yield* worker(factory, cache => cache.purgeIfDue)).toEqual(
        Option.none()
      )
      yield* advance(12 * HOUR)
      expect(yield* worker(factory, cache => cache.purgeIfDue)).toEqual(
        Option.some(0)
      )
    })
  )

  scenario('an unreadable note of the last purge counts as never', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* put(factory, 'housekeeping', { name: 'lastPurge', at: 'x' })
        expect(Option.isSome(yield* cache.purgeIfDue)).toBe(true)
      })
    )
  )
})

describe('the daily purge fibre', () => {
  const delay = Duration.toMillis(PURGE_START_DELAY)

  /** Polls in real time: the fibre's IndexedDB work finishes outside the TestClock. */
  const waitFor = (cache: BookCacheService, entries: number) =>
    Effect.gen(function* () {
      for (let i = 0; i < 200; i++) {
        if ((yield* cache.stats).entries === entries) return
        yield* Effect.promise(() => new Promise(done => setTimeout(done, 5)))
      }
      throw new Error(`the cache never reached ${entries} entries`)
    })

  /** Three entries saved 40 days before the clock now reads. */
  const putStale = (factory: IDBFactory) =>
    Effect.gen(function* () {
      const savedAt = START - 40 * DAY
      yield* put(factory, 'ratings', { ...found, savedAt })
      yield* put(factory, 'meta', { ...meta, savedAt })
      yield* put(factory, 'details', { ...details, savedAt })
    })

  /**
   * Counts the readwrite transactions that touch `housekeeping` on connections opened from
   * `factory`: each purge check (due or not) makes one, so a count is proof the fibre ran its check.
   */
  const countGateChecks = (factory: IDBFactory) => {
    const counter = { checks: 0 }
    const open = factory.open.bind(factory)
    factory.open = (...args) => {
      const request = open(...args)
      request.addEventListener('success', () => {
        const db = request.result
        const transaction = db.transaction.bind(db)
        db.transaction = (stores, mode, options) => {
          const names = [stores].flat()
          if (mode === 'readwrite' && names.includes('housekeeping')) {
            counter.checks++
          }
          return transaction(stores, mode, options)
        }
      })
      return request
    }
    return counter
  }

  const pause = (ms: number) =>
    Effect.promise(() => new Promise(done => setTimeout(done, ms)))

  scenario('purges after the start-up delay, then every day', factory =>
    Effect.gen(function* () {
      // Create the database, then leave stale entries in it for the fibre to find.
      yield* worker(factory, () => Effect.void)
      yield* putStale(factory)
      yield* worker(factory, cache =>
        Effect.gen(function* () {
          yield* advance(delay - 1)
          yield* pause(30)
          expect((yield* cache.stats).entries).toBe(3)

          yield* advance(1)
          yield* waitFor(cache, 0)
          const lastPurge = START + delay
          expect(yield* peek(factory, 'housekeeping', 'lastPurge')).toEqual({
            name: 'lastPurge',
            at: lastPurge,
          })

          // The fibre schedules its next run on its own time, so step the clock until it has run
          // and check that it took a day, not less.
          yield* putStale(factory)
          let elapsed = 0
          while (true) {
            if (elapsed > 3 * DAY) throw new Error('the fibre never repeated')
            yield* advance(HOUR)
            elapsed += HOUR
            yield* pause(5)
            if ((yield* cache.stats).entries === 0) break
          }
          expect(elapsed).toBeGreaterThanOrEqual(DAY)
          expect(
            yield* peek(factory, 'housekeeping', 'lastPurge')
          ).toMatchObject({ at: lastPurge + elapsed })
        })
      )
    })
  )

  scenario(
    'a worker that restarts the same day does not purge again',
    factory =>
      Effect.gen(function* () {
        yield* worker(factory, cache => cache.purgeIfDue)
        yield* putStale(factory)
        const gate = countGateChecks(factory)
        yield* worker(factory, cache =>
          Effect.gen(function* () {
            yield* advance(delay + HOUR)
            while (gate.checks === 0) yield* pause(5)
            // This check queues behind the fibre's (same store, same mode), so when it answers the
            // fibre's has finished.
            expect(yield* cache.purgeIfDue).toEqual(Option.none())
            expect((yield* cache.stats).entries).toBe(3)
            expect(yield* peek(factory, 'housekeeping', 'lastPurge')).toEqual({
              name: 'lastPurge',
              at: START,
            })
          })
        )
      })
  )
})

describe('clear', () => {
  /** A pinned book and an unpinned one, stored by an earlier worker. */
  const seeded = (factory: IDBFactory) =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* store(cache, pinnedBook, true)
        yield* store(cache, otherBook)
      })
    )

  scenario('unpinned keeps pinned books, their details and the pins', factory =>
    Effect.gen(function* () {
      yield* seeded(factory)
      yield* worker(factory, cache =>
        Effect.gen(function* () {
          expect(yield* cache.clear('unpinned')).toBe(3)
          expect(yield* readable(cache, pinnedBook)).toEqual(everything)
          expect(yield* readable(cache, otherBook)).toEqual(nothing)
          expect(yield* cache.stats).toMatchObject({
            books: 1,
            entries: 3,
            pinned: 1,
          })
        })
      )
    })
  )

  scenario('unpinned deletes young entries too', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* store(cache, otherBook)
        expect(yield* cache.clear('unpinned')).toBe(3)
        expect((yield* cache.stats).entries).toBe(0)
      })
    )
  )

  scenario('unpinned first drops pins that lapsed', factory =>
    Effect.gen(function* () {
      yield* seeded(factory)
      yield* advance(181 * DAY)
      yield* worker(factory, cache =>
        Effect.gen(function* () {
          yield* store(cache, pinnedBook)
          expect(yield* cache.clear('unpinned')).toBe(6)
          expect(yield* cache.stats).toMatchObject({ entries: 0, pinned: 0 })
        })
      )
    })
  )

  scenario('all deletes everything, pins included', factory =>
    Effect.gen(function* () {
      yield* seeded(factory)
      yield* worker(factory, cache =>
        Effect.gen(function* () {
          expect(yield* cache.clear('all')).toBe(6)
          expect(yield* cache.stats).toEqual({
            books: 0,
            entries: 0,
            bytes: 0,
            pinned: 0,
          })
        })
      )
    })
  )

  scenario('all keeps the note of the last purge', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.purgeIfDue
        yield* cache.clear('all')
        expect(yield* cache.purgeIfDue).toEqual(Option.none())
      })
    )
  )
})

describe('stats', () => {
  scenario('count books, entries and pins, and size the cache', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        expect(yield* cache.stats).toEqual({
          books: 0,
          entries: 0,
          bytes: 0,
          pinned: 0,
        })

        yield* store(cache, pinnedBook, true)
        const one = yield* cache.stats
        expect(one).toMatchObject({ books: 1, entries: 3, pinned: 1 })
        expect(one.bytes).toBeGreaterThan(0)

        yield* store(cache, otherBook)
        yield* cache.setRating(miss)
        const two = yield* cache.stats
        expect(two).toMatchObject({ books: 3, entries: 7, pinned: 1 })
        expect(two.bytes).toBeGreaterThan(one.bytes)
      })
    )
  )
})

describe('a record that does not decode', () => {
  scenario('is absent and gets deleted', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* put(factory, 'ratings', { ...found, savedAt: START, r: 9 })
        yield* put(factory, 'meta', { asin: meta.asin, savedAt: START })
        yield* put(factory, 'details', {
          ...details,
          savedAt: START,
          genres: 'Fantasy',
        })
        expect(yield* readable(cache, pinnedBook)).toEqual(nothing)
        expect(yield* peek(factory, 'ratings', found.asin)).toBeUndefined()
        expect(yield* peek(factory, 'meta', meta.asin)).toBeUndefined()
        expect(yield* peek(factory, 'details', details.bookId)).toBeUndefined()
      })
    )
  )

  scenario('does not stop the cache storing the book again', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* put(factory, 'ratings', { asin: found.asin, savedAt: START })
        yield* cache.setRating(found)
        expect(Option.isSome(yield* cache.getRating(found.asin))).toBe(true)
      })
    )
  )
})

describe('a worker restart', () => {
  scenario('keeps the cache', factory =>
    Effect.gen(function* () {
      yield* worker(factory, cache =>
        Effect.gen(function* () {
          yield* store(cache, pinnedBook, true)
          yield* cache.setRating(miss)
        })
      )
      yield* advance(2 * DAY)
      yield* worker(factory, cache =>
        Effect.gen(function* () {
          expect(yield* cache.getRating(found.asin)).toEqual(
            Option.some({ ...found, savedAt: START })
          )
          expect(yield* cache.getMeta(meta.asin)).toEqual(
            Option.some({ ...meta, savedAt: START })
          )
          expect(yield* cache.getDetails(details.bookId)).toEqual(
            Option.some({ ...details, savedAt: START })
          )
          expect(Option.isSome(yield* cache.getRating(miss.asin))).toBe(true)
          expect(yield* cache.stats).toMatchObject({ entries: 4, pinned: 1 })
        })
      )
    })
  )

  scenario('applies the time limits to what was stored before', factory =>
    Effect.gen(function* () {
      yield* worker(factory, cache =>
        Effect.gen(function* () {
          yield* cache.setRating(miss)
          yield* cache.setRating(found)
        })
      )
      yield* advance(8 * DAY)
      yield* worker(factory, cache =>
        Effect.gen(function* () {
          expect(Option.isNone(yield* cache.getRating(miss.asin))).toBe(true)
          expect(Option.isSome(yield* cache.getRating(found.asin))).toBe(true)
        })
      )
    })
  )
})

describe('IndexedDB failing', () => {
  scenario('is a CacheError, not a defect', factory =>
    Effect.gen(function* () {
      // A newer database makes opening the current version fail with a VersionError.
      yield* Effect.promise(
        () =>
          new Promise<void>((done, fail) => {
            const request = factory.open(DB_NAME, DB_VERSION + 1)
            request.onsuccess = () => {
              request.result.close()
              done()
            }
            request.onerror = () => fail(request.error)
          })
      )
      const error = yield* Effect.flip(worker(factory, cache => cache.stats))
      expect(error).toBeInstanceOf(CacheError)
      expect(error.operation).toBe('open')
    })
  )
})

describe('another connection', () => {
  scenario('asking for a newer database version is let through', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.setRating(miss)
        // Without the cache closing its connection, this open would wait for it forever.
        yield* Effect.promise(
          () =>
            new Promise<void>((done, fail) => {
              const request = factory.open(DB_NAME, DB_VERSION + 1)
              request.onsuccess = () => {
                request.result.close()
                done()
              }
              request.onerror = () => fail(request.error)
            })
        )
      })
    )
  )
})

describe('cache inspector', () => {
  scenario(
    'lists expired books and metadata-only books with pins and manual matches',
    factory =>
      worker(factory, cache =>
        Effect.gen(function* () {
          yield* store(cache, pinnedBook, true)
          yield* cache.setMeta(otherBook.meta)
          yield* cache.correct(found, details)
          yield* advance(31 * DAY)
          const books = yield* cache.list
          expect(books).toHaveLength(2)
          expect(books.find(b => b.asin === found.asin)).toMatchObject({
            title: meta.title,
            manual: true,
            pinned: true,
            rating: { r: found.r },
          })
          expect(
            books.find(b => b.asin === otherBook.meta.asin)?.rating
          ).toBeUndefined()
        })
      )
  )
  scenario(
    'a correction survives restart, expiry, purge and clear-unpinned, but clear-all removes it',
    factory =>
      Effect.gen(function* () {
        yield* worker(factory, cache => cache.correct(found, details))
        yield* advance(200 * DAY)
        yield* worker(factory, cache =>
          Effect.gen(function* () {
            yield* cache.purge
            yield* cache.clear('unpinned')
            expect(Option.isNone(yield* cache.getRating(found.asin))).toBe(true)
            expect(
              Option.getOrUndefined(yield* cache.getOverride(found.asin))
                ?.bookId
            ).toBe(found.bookId)
            expect(
              yield* peek(factory, 'details', details.bookId)
            ).toBeDefined()
            yield* cache.clear('all')
            expect(Option.isNone(yield* cache.getOverride(found.asin))).toBe(
              true
            )
            expect(yield* cache.list).toEqual([])
          })
        )
      })
  )
  scenario('automatic writes cannot overwrite a manual match', factory =>
    worker(factory, cache =>
      Effect.gen(function* () {
        yield* cache.correct(found, details)
        yield* cache.setRating({ _tag: 'Miss', asin: found.asin })
        yield* cache.setRating({ ...otherBook.rating, asin: found.asin })
        expect(
          Option.getOrUndefined(yield* cache.getRating(found.asin))
        ).toMatchObject({ _tag: 'Found', bookId: found.bookId })
      })
    )
  )
  scenario(
    'deleting a book removes its override and pin, while keeping shared details until the last reference',
    factory =>
      worker(factory, cache =>
        Effect.gen(function* () {
          yield* store(cache, pinnedBook, true)
          yield* cache.correct(found, details)
          yield* cache.setRating({ ...found, asin: otherBook.rating.asin })
          yield* cache.deleteBook(found.asin)
          expect(yield* cache.list).toHaveLength(1)
          expect(Option.isNone(yield* cache.getOverride(found.asin))).toBe(true)
          expect(Option.isSome(yield* cache.getDetails(details.bookId))).toBe(
            true
          )
          expect((yield* cache.stats).pinned).toBe(0)
          yield* cache.deleteBook(otherBook.rating.asin)
          expect(Option.isNone(yield* cache.getDetails(details.bookId))).toBe(
            true
          )
        })
      )
  )
  scenario('upgrades version 1 without losing existing ratings', factory =>
    Effect.gen(function* () {
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            const request = factory.open(DB_NAME, 1)
            request.onupgradeneeded = () => {
              for (const [name, key, time] of [
                ['ratings', 'asin', 'savedAt'],
                ['meta', 'asin', 'savedAt'],
                ['details', 'bookId', 'savedAt'],
                ['pins', 'asin', 'lastSeen'],
              ] as const) {
                request.result
                  .createObjectStore(name, { keyPath: key })
                  .createIndex(time, time)
              }
              request.result.createObjectStore('housekeeping', {
                keyPath: 'name',
              })
            }
            request.onsuccess = () => {
              const db = request.result
              const tx = db.transaction('ratings', 'readwrite')
              tx.objectStore('ratings').put({ ...found, savedAt: START })
              tx.oncomplete = () => {
                db.close()
                resolve()
              }
            }
            request.onerror = () => reject(request.error)
          })
      )
      yield* worker(factory, cache =>
        Effect.gen(function* () {
          expect(Option.isSome(yield* cache.getRating(found.asin))).toBe(true)
          yield* cache.correct(found, details)
          expect(Option.isSome(yield* cache.getOverride(found.asin))).toBe(true)
        })
      )
    })
  )
})
