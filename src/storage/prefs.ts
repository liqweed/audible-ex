/**
 * The user's preferences: one item, `sync:prefs`, in `storage.sync`, so they follow the user across
 * devices and Audible marketplaces (ARCHITECTURE.md §8). Every reader (content scripts, popup,
 * options) watches it, so a change in one place applies everywhere at once.
 *
 * Each field has a default, so a record written by an older version still decodes. Change the
 * shape → bump `version` and add a migration. Version 2 added `filters`; the display options join
 * them with the options page (phase 4), and the maximum price per marketplace in phase 3b.
 */
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { storage } from 'wxt/utils/storage'
import { serial } from './serial'

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
})
export type Filters = typeof Filters.Type

export const DEFAULT_FILTERS: Filters = {
  enabled: true,
  minRating: 4,
  minRatings: 50,
  hiddenLabels: [],
  notFound: 'show',
  mode: 'hide',
}

/** Prefs v2. A key missing from the stored record takes its default. */
export const Prefs = Schema.Struct({
  /** The extension's master switch: off removes the badges and stops the lookups. */
  enabled: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true))
  ),
  filters: Filters.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_FILTERS))
  ),
})
export type Prefs = typeof Prefs.Type

export const DEFAULT_PREFS: Prefs = { enabled: true, filters: DEFAULT_FILTERS }

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
  version: 2,
  migrations: {
    // v1 held `enabled` alone. The migrated record is the whole of v2, defaults filled in.
    2: decodePrefs,
  },
})

export const readPrefs = async (): Promise<Prefs> =>
  decodePrefs(await item.getValue())

/** Updates run one after another, so quick changes (a slider, then a switch) do not erase each other. */
const queue = serial()

/** Changes some prefs and keeps the rest as they are. */
export const updatePrefs = (change: Partial<Prefs>): Promise<void> =>
  queue(async () => {
    await item.setValue({ ...(await readPrefs()), ...change })
  })

/** Changes some of the filters and keeps the rest of them, and the other prefs, as they are. */
export const updateFilters = (change: Partial<Filters>): Promise<void> =>
  queue(async () => {
    const prefs = await readPrefs()
    await item.setValue({ ...prefs, filters: { ...prefs.filters, ...change } })
  })

/** Calls `listener` with the new prefs after each change; returns the function that stops it. */
export const watchPrefs = (listener: (prefs: Prefs) => void): (() => void) =>
  item.watch(value => listener(decodePrefs(value)))
