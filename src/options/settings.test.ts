import { beforeEach, describe, expect, test } from 'bun:test'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
  DEFAULT_PREFS,
  readPrefs,
  updateFilters,
  updatePrefs,
} from '@/storage/prefs'
import {
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
        hiddenLabels: ['History, Politics', 'Fantasy'],
      },
    }
    expect(prefsFromDraft(draftFromPrefs(prefs))).toEqual(prefs)
  })
  test.each([
    ['minRating', ''],
    ['minRating', '6'],
    ['minRatings', '-1'],
    ['minRatings', '1.5'],
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
})
