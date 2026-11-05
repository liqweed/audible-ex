/** Options drafts and prefs-only backups. Invalid input throws before a storage write. */
import * as Schema from 'effect/Schema'
import { DIMENSIONS } from '@/core/filter'
import { REGIONS, type RegionCode } from '@/core/regions'
import {
  type Prefs,
  Prefs as PrefsSchema,
  updatePrefs,
  upgradeModes,
} from '@/storage/prefs'

export interface SettingsDraft {
  enabled: boolean
  filtering: boolean
  minRating: string
  minRatings: string
  highlightRating: string
  priceOnDeals: boolean
  minYear: string
  maxYear: string
  hiddenLabels: string
  highlightLabels: string
  notFound: Prefs['filters']['notFound']
  modes: Prefs['filters']['modes']
  prices: Record<RegionCode, string>
  highlightPrices: Record<RegionCode, string>
  labels: string
  year: boolean
  overview: boolean
}

export const draftFromPrefs = (prefs: Prefs): SettingsDraft => ({
  enabled: prefs.enabled,
  filtering: prefs.filters.enabled,
  minRating: String(prefs.filters.minRating),
  minRatings: String(prefs.filters.minRatings),
  highlightRating: prefs.filters.highlightRating?.toString() ?? '',
  priceOnDeals: prefs.filters.priceOnDeals,
  minYear: prefs.filters.minYear?.toString() ?? '',
  maxYear: prefs.filters.maxYear?.toString() ?? '',
  hiddenLabels: prefs.filters.hiddenLabels.join('\n'),
  highlightLabels: prefs.filters.highlightLabels.join('\n'),
  notFound: prefs.filters.notFound,
  modes: prefs.filters.modes,
  prices: Object.fromEntries(
    REGIONS.map(r => [r.code, prefs.filters.maxPrice[r.code]?.toString() ?? ''])
  ) as Record<RegionCode, string>,
  highlightPrices: Object.fromEntries(
    REGIONS.map(r => [
      r.code,
      prefs.filters.highlightPrice[r.code]?.toString() ?? '',
    ])
  ) as Record<RegionCode, string>,
  labels: String(prefs.display.labels),
  year: prefs.display.year,
  overview: prefs.display.overview,
})

/** One label per line, trimmed, without blanks or repeats. */
const lines = (text: string): string[] => [
  ...new Set(
    text
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
  ),
]

function number(text: string): number {
  if (!text.trim()) throw new Error('A required number is blank.')
  const n = Number(text)
  if (!Number.isFinite(n)) throw new Error('Use finite numbers.')
  return n
}

export function prefsFromDraft(draft: SettingsDraft): Prefs {
  return Schema.decodeSync(PrefsSchema)({
    enabled: draft.enabled,
    display: {
      labels: number(draft.labels),
      year: draft.year,
      overview: draft.overview,
    },
    filters: {
      enabled: draft.filtering,
      minRating: number(draft.minRating),
      minRatings: number(draft.minRatings),
      highlightRating:
        draft.highlightRating.trim() === ''
          ? null
          : number(draft.highlightRating),
      minYear: draft.minYear.trim() === '' ? null : number(draft.minYear),
      maxYear: draft.maxYear.trim() === '' ? null : number(draft.maxYear),
      hiddenLabels: lines(draft.hiddenLabels),
      highlightLabels: lines(draft.highlightLabels),
      notFound: draft.notFound,
      priceOnDeals: draft.priceOnDeals,
      modes: draft.modes,
      maxPrice: Object.fromEntries(
        REGIONS.filter(r => draft.prices[r.code].trim() !== '').map(r => [
          r.code,
          number(draft.prices[r.code]),
        ])
      ),
      highlightPrice: Object.fromEntries(
        REGIONS.filter(r => draft.highlightPrices[r.code].trim() !== '').map(
          r => [r.code, number(draft.highlightPrices[r.code])]
        )
      ),
    },
  })
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Merge only edited values, preserving unrelated changes made in other tabs since the draft began. */
export function mergeSettings(base: Prefs, next: Prefs, current: Prefs): Prefs {
  const filters = { ...current.filters }
  for (const key of [
    'enabled',
    'minRating',
    'minRatings',
    'highlightRating',
    'hiddenLabels',
    'highlightLabels',
    'priceOnDeals',
    'notFound',
  ] as const) {
    if (!same(base.filters[key], next.filters[key]))
      Object.assign(filters, { [key]: next.filters[key] })
  }
  const modes = { ...current.filters.modes }
  for (const dimension of DIMENSIONS) {
    if (base.filters.modes[dimension] !== next.filters.modes[dimension])
      modes[dimension] = next.filters.modes[dimension]
  }
  // Bounds are one logical edit, so an external edit cannot turn a valid draft into a reversed pair.
  if (
    base.filters.minYear !== next.filters.minYear ||
    base.filters.maxYear !== next.filters.maxYear
  ) {
    filters.minYear = next.filters.minYear
    filters.maxYear = next.filters.maxYear
  }
  const maxPrice = { ...current.filters.maxPrice }
  for (const r of REGIONS) {
    if (base.filters.maxPrice[r.code] === next.filters.maxPrice[r.code])
      continue
    const price = next.filters.maxPrice[r.code]
    if (price === undefined) delete maxPrice[r.code]
    else maxPrice[r.code] = price
  }
  const highlightPrice = { ...current.filters.highlightPrice }
  for (const r of REGIONS) {
    if (
      base.filters.highlightPrice[r.code] ===
      next.filters.highlightPrice[r.code]
    )
      continue
    const price = next.filters.highlightPrice[r.code]
    if (price === undefined) delete highlightPrice[r.code]
    else highlightPrice[r.code] = price
  }
  const display = { ...current.display }
  for (const key of ['labels', 'year', 'overview'] as const) {
    if (base.display[key] !== next.display[key])
      Object.assign(display, { [key]: next.display[key] })
  }
  return Schema.decodeSync(PrefsSchema)({
    enabled: base.enabled === next.enabled ? current.enabled : next.enabled,
    filters: { ...filters, maxPrice, highlightPrice, modes },
    display,
  })
}

export const saveSettings = (
  base: Prefs,
  draft: SettingsDraft
): Promise<void> => {
  const next = prefsFromDraft(draft)
  return updatePrefs(current => mergeSettings(base, next, current))
}

const Backup = Schema.Struct({
  format: Schema.Literal('audible-ex-prefs'),
  version: Schema.Literal(1),
  prefs: PrefsSchema,
})

/** Encoding strips everything except the known prefs; no book/cache or panel state leaves the browser. */
export const exportPrefs = (prefs: Prefs): string =>
  `${JSON.stringify(
    Schema.encodeSync(Backup)({
      format: 'audible-ex-prefs',
      version: 1,
      prefs,
    }),
    null,
    2
  )}\n`

/** A backup from before prefs v6 has one `mode` for all filters; it becomes each filter's. */
const upgradeBackup = (raw: unknown): unknown =>
  typeof raw === 'object' && raw !== null && 'prefs' in raw
    ? { ...raw, prefs: upgradeModes(raw.prefs) }
    : raw

export const importPrefs = (text: string): Prefs =>
  Schema.decodeUnknownSync(Backup)(upgradeBackup(JSON.parse(text)), {
    onExcessProperty: 'error',
  }).prefs
