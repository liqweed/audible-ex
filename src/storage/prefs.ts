/**
 * The user's preferences: one item, `sync:prefs`, in `storage.sync`, so they follow the user across
 * devices and Audible marketplaces (ARCHITECTURE.md §8). Every reader (content scripts, popup,
 * options) watches it, so a change in one place applies everywhere at once.
 *
 * Each field has a default, so a record written by an older version still decodes. Change the
 * shape → bump `version` and add a migration. Version 2 added `filters`, version 3 the year bounds;
 * version 4 adds marketplace price limits, version 5 the display settings.
 */
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { storage } from 'wxt/utils/storage'
import { DEFAULT_DISPLAY } from '../core/display'
import { GENRES_MAX, Region } from '../schema/common'
import { serial } from './serial'

/** An open bound, or a whole first-published year (0 means unknown in book details). */
const YearBound = Schema.NullOr(
  Schema.Int.check(
    Schema.makeFilter(year =>
      year === 0 ? 'Year 0 is not a publication year' : undefined
    )
  )
).pipe(Schema.withDecodingDefaultKey(Effect.succeed<number | null>(null)))

/**
 * The filters (PRD R3, ARCHITECTURE.md §7; `src/core/filter.ts` reads them). The slider offers 3.0 to
 * 5.0, the schema accepts any rating, so a range change later needs no migration.
 */
export const Filters = Schema.Struct({
  /** The filters' own master switch. */
  enabled: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true))
  ),
  minRating: Schema.Finite.check(
    Schema.isBetween({ minimum: 1, maximum: 5 })
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(4))),
  /** 0 turns the minimum number of ratings off. */
  minRatings: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(50))
  ),
  minYear: YearBound,
  maxYear: YearBound,
  /** Inclusive cash-price ceiling in each marketplace's own currency; absent means off. */
  maxPrice: Schema.Record(
    Region,
    Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)))
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  /** Goodreads genre names. */
  hiddenLabels: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed<readonly string[]>([]))
  ),
  /** What happens to a book that is not on Goodreads. */
  notFound: Schema.Literals(['show', 'dim', 'hide']).pipe(
    Schema.withDecodingDefaultKey(
      Effect.succeed<'show' | 'dim' | 'hide'>('show')
    )
  ),
  /** What happens to a book that fails a filter (carousels always dim). */
  mode: Schema.Literals(['hide', 'dim']).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed<'hide' | 'dim'>('hide'))
  ),
}).check(
  Schema.makeFilter(filters =>
    filters.minYear !== null &&
    filters.maxYear !== null &&
    filters.minYear > filters.maxYear
      ? 'The first-published year range is reversed'
      : undefined
  )
)
export type Filters = typeof Filters.Type

export const DEFAULT_FILTERS: Filters = {
  enabled: true,
  minRating: 4,
  minRatings: 50,
  minYear: null,
  maxYear: null,
  maxPrice: {},
  hiddenLabels: [],
  notFound: 'show',
  mode: 'hide',
}

export { DEFAULT_DISPLAY } from '../core/display'

export const Display = Schema.Struct({
  labels: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: GENRES_MAX })
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(3))),
  year: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true))
  ),
  overview: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true))
  ),
})
export type Display = typeof Display.Type

/** Prefs v5. A key missing from the stored record takes its default. */
export const Prefs = Schema.Struct({
  /** The extension's master switch: off removes the badges and stops the lookups. */
  enabled: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true))
  ),
  display: Display.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_DISPLAY))
  ),
  filters: Filters.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_FILTERS))
  ),
})
export type Prefs = typeof Prefs.Type

export const DEFAULT_PREFS: Prefs = {
  enabled: true,
  filters: DEFAULT_FILTERS,
  display: DEFAULT_DISPLAY,
}

const decode = Schema.decodeUnknownOption(Prefs)

/**
 * The prefs a stored value stands for. A value that is not a record of prefs (damaged, or written
 * by a newer version) gives the defaults rather than an error: the UI must always have prefs.
 */
export function decodePrefs(raw: unknown): Prefs {
  return Option.getOrElse(decode(raw), () => DEFAULT_PREFS)
}

const item = storage.defineItem<unknown>('sync:prefs', {
  fallback: DEFAULT_PREFS,
  version: 5,
  migrations: {
    // v1 held `enabled` alone. Add the filters with defaults filled in.
    2: decodePrefs,
    // v2 had no year bounds: keep every choice and leave both ends open.
    3: decodePrefs,
    // v3 had no marketplace price limits: all remain off.
    4: decodePrefs,
    // v4 display was fixed: preserve that appearance.
    5: decodePrefs,
  },
})

export const readPrefs = async (): Promise<Prefs> =>
  decodePrefs(await item.getValue())

/** Updates run one after another, so quick changes (a slider, then a switch) do not erase each other. */
const queue = serial()

/** Changes some prefs and keeps the rest as they are. */
export const updatePrefs = (
  change: Partial<Prefs> | ((current: Prefs) => Partial<Prefs>)
): Promise<void> =>
  queue(async () => {
    const current = await readPrefs()
    const patch = typeof change === 'function' ? change(current) : change
    await item.setValue({ ...current, ...patch })
  })

/**
 * Changes some of the filters and keeps the rest of them, and the other prefs, as they are. A
 * function gets the filters as stored when the write begins: adding a label to the list needs them,
 * not the list its caller saw earlier.
 */
export const updateFilters = (
  change: Partial<Filters> | ((current: Filters) => Partial<Filters>)
): Promise<void> =>
  queue(async () => {
    const prefs = await readPrefs()
    const patch = typeof change === 'function' ? change(prefs.filters) : change
    await item.setValue({ ...prefs, filters: { ...prefs.filters, ...patch } })
  })

/** Calls `listener` with the new prefs after each change; returns the function that stops it. */
export const watchPrefs = (listener: (prefs: Prefs) => void): (() => void) =>
  item.watch(value => listener(decodePrefs(value)))
