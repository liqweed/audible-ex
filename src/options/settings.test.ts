import { beforeEach, describe, expect, test } from 'bun:test'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
  DEFAULT_PREFS,
  readPrefs,
  updateFilters,
  updatePrefs,
} from '@/storage/prefs'
import {
  describeYears,
  draftFromPrefs,
  exportPrefs,
  importPrefs,
  mergeSettings,
  prefsFromDraft,
  saveSettings,
} from './settings'

beforeEach(() => fakeBrowser.reset())

describe('settings drafts', () => {
  test('round-trips all prefs including BCE, zero prices and labels containing commas', () => {
    const prefs = {
      ...DEFAULT_PREFS,
      enabled: false,
      display: { labels: 10, year: false, overview: false },
      filters: {
        ...DEFAULT_PREFS.filters,
        minYear: -800,
        maxYear: -700,
        maxPrice: { UK: 0, US: 20.5 },
        highlightPrice: { UK: 3.99, US: 0 },
        hiddenLabels: ['History, Politics', 'Fantasy'],
        highlightLabels: ['Science Fiction', 'Space Opera'],
        highlightRating: 4.6,
        modes: { ...DEFAULT_PREFS.filters.modes, labels: 'dim', price: 'dim' },
      },
    } as const
    expect(prefsFromDraft(draftFromPrefs(prefs))).toEqual(prefs)
  })
  test.each([
    ['minRating', ''],
    ['minRating', '6'],
    ['minRatings', '-1'],
    ['minRatings', '1.5'],
    ['highlightRating', '0.5'],
    ['highlightRating', '5.5'],
    ['highlightRating', 'high'],
    ['minYear', '0'],
    ['minYear', '1990.5'],
    ['labels', '11'],
    ['labels', '-1'],
    ['labels', '1.5'],
  ] as const)('refuses %s = %s', (key, value) => {
    expect(() =>
      prefsFromDraft({ ...draftFromPrefs(DEFAULT_PREFS), [key]: value })
    ).toThrow()
  })
  test('trims labels and drops blanks and repeats without regard to case', () => {
    const draft = draftFromPrefs(DEFAULT_PREFS)
    expect(
      prefsFromDraft({
        ...draft,
        hiddenLabels: [' Fantasy', 'fantasy ', '', 'Romance'],
      }).filters.hiddenLabels
    ).toEqual(['Fantasy', 'Romance'])
  })
  test.each([
    ['', '', 'Any year'],
    ['1990', '', '1990 or later'],
    ['', '2020', '2020 or earlier'],
    ['1990', '2020', '1990 to 2020'],
    ['-800', '-700', '800 BCE to 700 BCE'],
    ['2000', '2000', '2000'],
    ['2020', '2000', undefined],
    ['abc', '', undefined],
    ['0', '', undefined],
  ])('describes the years %p to %p as %p', (from, to, text) => {
    expect(describeYears(from, to)).toBe(text)
  })
  test('refuses reversed years and invalid prices', () => {
    const draft = draftFromPrefs(DEFAULT_PREFS)
    expect(() =>
      prefsFromDraft({ ...draft, minYear: '2020', maxYear: '2000' })
    ).toThrow()
    expect(() =>
      prefsFromDraft({ ...draft, prices: { ...draft.prices, UK: '-1' } })
    ).toThrow()
  })
  test('saves only changed values, preserving another tab’s filter, master switch and marketplace', async () => {
    const base = await readPrefs()
    const draft = draftFromPrefs(base)
    draft.labels = '0'
    draft.prices.UK = '10'
    await updateFilters({ minRating: 4.5, maxPrice: { US: 20 } })
    await updatePrefs({ enabled: false })
    await saveSettings(base, draft)
    expect(await readPrefs()).toEqual({
      ...DEFAULT_PREFS,
      enabled: false,
      display: { ...DEFAULT_PREFS.display, labels: 0 },
      filters: {
        ...DEFAULT_PREFS.filters,
        minRating: 4.5,
        maxPrice: { UK: 10, US: 20 },
      },
    })
  })
  test('saves an edited highlight price without touching the limit set in another tab', async () => {
    const base = await readPrefs()
    const draft = draftFromPrefs(base)
    draft.highlightPrices.UK = '4.5'
    await updateFilters({ maxPrice: { UK: 12 }, highlightPrice: { US: 6 } })
    await saveSettings(base, draft)
    expect((await readPrefs()).filters).toMatchObject({
      maxPrice: { UK: 12 },
      highlightPrice: { UK: 4.5, US: 6 },
    })
    expect(() =>
      prefsFromDraft({
        ...draft,
        highlightPrices: { ...draft.highlightPrices, US: '-1' },
      })
    ).toThrow()
  })
  test('removes an edited price and treats year bounds as one edit', () => {
    const base = {
      ...DEFAULT_PREFS,
      filters: {
        ...DEFAULT_PREFS.filters,
        maxYear: 2020,
        maxPrice: { UK: 10 },
      },
    }
    const next = {
      ...base,
      filters: { ...base.filters, minYear: 2010, maxPrice: {} },
    }
    const current = {
      ...base,
      filters: { ...base.filters, maxYear: 2000, maxPrice: { UK: 20, US: 30 } },
    }
    const merged = mergeSettings(base, next, current)
    expect(merged.filters).toMatchObject({
      minYear: 2010,
      maxYear: 2020,
      maxPrice: { US: 30 },
    })
    expect(merged.filters.maxPrice.UK).toBeUndefined()
  })
  test("merges each filter's mode on its own, and the highlighted labels", () => {
    const base = DEFAULT_PREFS
    const next = {
      ...base,
      filters: {
        ...base.filters,
        highlightLabels: ['Fantasy'],
        modes: { ...base.filters.modes, year: 'dim' },
      },
    } as const
    const current = {
      ...base,
      filters: {
        ...base.filters,
        modes: { ...base.filters.modes, rating: 'dim' },
      },
    } as const
    expect(mergeSettings(base, next, current).filters).toMatchObject({
      highlightLabels: ['Fantasy'],
      modes: { ...base.filters.modes, rating: 'dim', year: 'dim' },
    })
  })
})

describe('the highlight rating draft', () => {
  test('blank is off', () => {
    const draft = draftFromPrefs(DEFAULT_PREFS)
    expect(draft.highlightRating).toBe('')
    expect(
      prefsFromDraft({ ...draft, highlightRating: '  ' }).filters
        .highlightRating
    ).toBeNull()
  })
  test('merges on its own', () => {
    const base = DEFAULT_PREFS
    const next = {
      ...base,
      filters: { ...base.filters, highlightRating: 4.5 },
    }
    const current = {
      ...base,
      filters: { ...base.filters, minRating: 3.5 },
    }
    expect(mergeSettings(base, next, current).filters).toMatchObject({
      highlightRating: 4.5,
      minRating: 3.5,
    })
  })
})

describe('prefs backups', () => {
  test('round-trips a versioned prefs-only backup and drops runtime book/panel data', () => {
    const prefs = {
      ...DEFAULT_PREFS,
      ratings: [{ title: 'Private book' }],
      panel: { corner: 'topLeft' },
    }
    const exported = exportPrefs(prefs)
    expect(importPrefs(exported)).toEqual(DEFAULT_PREFS)
    expect(exported).not.toContain('Private book')
    expect(exported).not.toContain('panel')
    expect(JSON.parse(exported)).toEqual({
      format: 'audible-ex-prefs',
      version: 1,
      prefs: DEFAULT_PREFS,
    })
  })
  test.each([
    'not json',
    '{}',
    JSON.stringify(DEFAULT_PREFS),
    JSON.stringify({
      format: 'audible-ex-prefs',
      version: 2,
      prefs: DEFAULT_PREFS,
    }),
    JSON.stringify({
      format: 'audible-ex-prefs',
      version: 1,
      prefs: { filters: { minRating: 9 } },
    }),
    JSON.stringify({
      format: 'audible-ex-prefs',
      version: 1,
      prefs: { display: { labels: 11 } },
    }),
    JSON.stringify({
      format: 'audible-ex-prefs',
      version: 1,
      prefs: DEFAULT_PREFS,
      ratings: [],
    }),
  ])('refuses unsupported or malformed backup %s', text => {
    expect(() => importPrefs(text)).toThrow()
  })
  test('older backups gain new fields through Schema defaults', () => {
    expect(
      importPrefs(
        JSON.stringify({
          format: 'audible-ex-prefs',
          version: 1,
          prefs: { enabled: false },
        })
      )
    ).toEqual({ ...DEFAULT_PREFS, enabled: false })
  })
  test("a backup's single mode from before prefs v6 becomes every filter's", () => {
    const { modes: _, ...filters } = DEFAULT_PREFS.filters
    const prefs = importPrefs(
      JSON.stringify({
        format: 'audible-ex-prefs',
        version: 1,
        prefs: { ...DEFAULT_PREFS, filters: { ...filters, mode: 'dim' } },
      })
    )
    expect(Object.values(prefs.filters.modes)).toEqual([
      'dim',
      'dim',
      'dim',
      'dim',
      'dim',
    ])
  })
})
