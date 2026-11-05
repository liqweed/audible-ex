import { beforeEach, describe, expect, test } from 'bun:test'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
  DEFAULT_DISPLAY,
  DEFAULT_FILTERS,
  DEFAULT_PREFS,
  decodePrefs,
  readPrefs,
  updateFilters,
  updatePrefs,
  watchPrefs,
} from './prefs'

beforeEach(() => {
  fakeBrowser.reset()
})

describe('decodePrefs', () => {
  test('a missing key takes its default', () => {
    expect(decodePrefs({})).toEqual(DEFAULT_PREFS)
  })

  test('keeps what is stored', () => {
    expect(decodePrefs({ enabled: false })).toEqual({
      display: DEFAULT_DISPLAY,
      enabled: false,
      filters: DEFAULT_FILTERS,
    })
  })

  test('the filters start at the documented defaults', () => {
    expect(DEFAULT_FILTERS).toEqual({
      enabled: true,
      minRating: 4,
      minRatings: 50,
      minYear: null,
      maxYear: null,
      maxPrice: {},
      hiddenLabels: [],
      highlightLabels: [],
      highlightRating: null,
      notFound: 'show',
      modes: {
        rating: 'hide',
        count: 'hide',
        labels: 'hide',
        year: 'hide',
        price: 'hide',
      },
    })
  })

  test('a filter missing from the stored filters takes its default', () => {
    const prefs = decodePrefs({
      filters: { minRating: 4.5, hiddenLabels: ['Romance'] },
    })
    expect(prefs.filters).toEqual({
      ...DEFAULT_FILTERS,
      minRating: 4.5,
      hiddenLabels: ['Romance'],
    })
  })

  test.each([
    ['a rating above 5', { minRating: 6 }],
    ['a negative count', { minRatings: -1 }],
    ['an unknown policy', { notFound: 'remove' }],
    ['a mode that is not a mode', { modes: { rating: 'show' } }],
    ['a fractional year', { minYear: 2000.5 }],
    ['an unknown year as a bound', { maxYear: 0 }],
    ['a year stored as a string', { minYear: '2000' }],
    ['a reversed range', { minYear: 2020, maxYear: 2000 }],
  ])('%s gives the defaults', (_, filters) => {
    expect(decodePrefs({ enabled: false, filters })).toEqual(DEFAULT_PREFS)
  })

  test.each([
    ['nothing stored', null],
    ['a string', 'off'],
    ['a wrong type', { enabled: 'no' }],
  ])('%s gives the defaults', (_, raw) => {
    expect(decodePrefs(raw)).toEqual(DEFAULT_PREFS)
  })

  test('ignores keys a newer version added', () => {
    expect(decodePrefs({ enabled: false, theme: 'dark' })).toEqual({
      display: DEFAULT_DISPLAY,
      enabled: false,
      filters: DEFAULT_FILTERS,
    })
  })

  test.each([
    { minYear: 2000, maxYear: null },
    { minYear: null, maxYear: 2000 },
    { minYear: -800, maxYear: -700 },
    { minYear: 2000, maxYear: 2000 },
  ])('keeps the year bounds %j', range => {
    expect(decodePrefs({ filters: range }).filters).toEqual({
      ...DEFAULT_FILTERS,
      ...range,
    })
  })
})

describe('the single mode of prefs up to v5', () => {
  test('becomes the mode of every filter', () => {
    expect(decodePrefs({ filters: { mode: 'dim' } }).filters.modes).toEqual({
      rating: 'dim',
      count: 'dim',
      labels: 'dim',
      year: 'dim',
      price: 'dim',
    })
  })

  test('yields to modes already stored', () => {
    const modes = { ...DEFAULT_FILTERS.modes, year: 'dim' } as const
    expect(
      decodePrefs({ filters: { mode: 'dim', modes } }).filters.modes
    ).toEqual(modes)
  })

  test('that is not a mode is dropped, keeping the other filters', () => {
    expect(
      decodePrefs({ filters: { mode: 'show', minRating: 3 } }).filters
    ).toEqual({ ...DEFAULT_FILTERS, minRating: 3 })
  })
})

describe('the sync:prefs item', () => {
  test('is enabled until the user turns it off', async () => {
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
    await updatePrefs({ enabled: false })
    expect(await readPrefs()).toEqual({ ...DEFAULT_PREFS, enabled: false })
  })

  test('lives in storage.sync, not storage.local', async () => {
    await updatePrefs({ enabled: false })
    const sync = await fakeBrowser.storage.sync.get(null)
    expect(sync.prefs).toEqual({ ...DEFAULT_PREFS, enabled: false })
    const local = await fakeBrowser.storage.local.get(null)
    expect(Object.keys(local)).toEqual([])
  })

  test('tells watchers the new prefs, and stops when asked', async () => {
    const seen: boolean[] = []
    const stop = watchPrefs(prefs => seen.push(prefs.enabled))
    await updatePrefs({ enabled: false })
    await updatePrefs({ enabled: true })
    stop()
    await updatePrefs({ enabled: false })
    expect(seen).toEqual([false, true])
  })
})

describe('updateFilters', () => {
  test('changes some filters and keeps the others and the master switch', async () => {
    await updatePrefs({ enabled: false })
    await updateFilters({ minRating: 4.5 })
    await updateFilters({ hiddenLabels: ['Romance'] })
    expect(await readPrefs()).toEqual({
      display: DEFAULT_DISPLAY,
      enabled: false,
      filters: {
        ...DEFAULT_FILTERS,
        minRating: 4.5,
        hiddenLabels: ['Romance'],
      },
    })
  })

  test('tells watchers the new filters', async () => {
    const seen: number[] = []
    const stop = watchPrefs(prefs => seen.push(prefs.filters.minRating))
    await updateFilters({ minRating: 3.5 })
    stop()
    expect(seen).toEqual([3.5])
  })
})

describe('the version 1 record', () => {
  // What 0.1 stored: `enabled` alone, and version 1 in the item's metadata.
  const seedV1 = () =>
    fakeBrowser.storage.sync.set({
      prefs: { enabled: false },
      prefs$: { v: 1 },
    })

  test('is read with the filters at their defaults', async () => {
    await seedV1()
    expect(await readPrefs()).toEqual({
      display: DEFAULT_DISPLAY,
      enabled: false,
      filters: DEFAULT_FILTERS,
    })
  })

  test('is rewritten as version 5 when the extension starts', async () => {
    await seedV1()
    // WXT migrates when the item is defined, which is when the module loads: load a fresh copy.
    const fresh = (await import(
      `./prefs.ts?fresh=${Math.random()}`
    )) as typeof import('./prefs')
    expect(await fresh.readPrefs()).toEqual({
      display: DEFAULT_DISPLAY,
      enabled: false,
      filters: DEFAULT_FILTERS,
    })
    // The rewrite is asynchronous and nothing announces it: wait for it, up to a second.
    for (let i = 0; i < 100; i++) {
      const meta = (await fakeBrowser.storage.sync.get('prefs$')).prefs$ as
        | { v?: number }
        | undefined
      if (meta?.v === 7) break
      await Bun.sleep(10)
    }
    const stored = await fakeBrowser.storage.sync.get(['prefs', 'prefs$'])
    expect(stored.prefs).toEqual({
      ...DEFAULT_PREFS,
      enabled: false,
      filters: DEFAULT_FILTERS,
    })
    expect(stored.prefs$).toEqual({ v: 7 })
  })
})

describe('the version 2 record', () => {
  test('migrates without changing the existing choices, with year filtering off', async () => {
    const filters = {
      enabled: false,
      minRating: 3.5,
      minRatings: 100,
      hiddenLabels: ['Romance'],
      notFound: 'dim',
      mode: 'dim',
    } as const
    const { mode: _, ...kept } = filters
    await fakeBrowser.storage.sync.set({
      prefs: { enabled: false, filters },
      prefs$: { v: 2 },
    })
    const fresh = (await import(
      `./prefs.ts?fresh=${Math.random()}`
    )) as typeof import('./prefs')
    const expected = {
      display: DEFAULT_DISPLAY,
      enabled: false,
      filters: {
        ...kept,
        minYear: null,
        maxYear: null,
        maxPrice: {},
        highlightLabels: [],
        highlightRating: null,
        modes: {
          rating: 'dim',
          count: 'dim',
          labels: 'dim',
          year: 'dim',
          price: 'dim',
        } as const,
      },
    }
    expect(await fresh.readPrefs()).toEqual(expected)
    for (let i = 0; i < 100; i++) {
      const stored = await fakeBrowser.storage.sync.get(['prefs', 'prefs$'])
      if ((stored.prefs$ as { v?: number } | undefined)?.v === 7) break
      await Bun.sleep(10)
    }
    const stored = await fakeBrowser.storage.sync.get(['prefs', 'prefs$'])
    expect(stored).toEqual({
      prefs: expected,
      prefs$: { v: 7 },
    })
  })

  test('year edits keep the other filters and notify watchers', async () => {
    await updateFilters({ minRating: 4.5 })
    const seen: Array<[number | null, number | null]> = []
    const stop = watchPrefs(prefs =>
      seen.push([prefs.filters.minYear, prefs.filters.maxYear])
    )
    await updateFilters({ minYear: 2000, maxYear: 2020 })
    await updateFilters({ minYear: null })
    stop()
    expect(seen).toEqual([
      [2000, 2020],
      [null, 2020],
    ])
    expect((await readPrefs()).filters).toEqual({
      ...DEFAULT_FILTERS,
      minRating: 4.5,
      maxYear: 2020,
    })
  })
})

describe('quick updates', () => {
  test('started together, they all land', async () => {
    await Promise.all([
      updateFilters({ minRating: 4.5 }),
      updateFilters({ modes: { ...DEFAULT_FILTERS.modes, year: 'dim' } }),
      updatePrefs({ enabled: false }),
      updateFilters({ hiddenLabels: ['Romance'] }),
    ])
    expect(await readPrefs()).toEqual({
      display: DEFAULT_DISPLAY,
      enabled: false,
      filters: {
        ...DEFAULT_FILTERS,
        minRating: 4.5,
        modes: { ...DEFAULT_FILTERS.modes, year: 'dim' },
        hiddenLabels: ['Romance'],
      },
    })
  })
})

describe('updateFilters with a function', () => {
  test('sees the filters as stored, not as the caller last saw them', async () => {
    await updateFilters({ hiddenLabels: ['Romance'] })
    await updateFilters(current => ({
      hiddenLabels: [...current.hiddenLabels, 'Horror'],
    }))
    expect((await readPrefs()).filters.hiddenLabels).toEqual([
      'Romance',
      'Horror',
    ])
  })

  test('started together with others, all land', async () => {
    await Promise.all([
      updateFilters(c => ({ hiddenLabels: [...c.hiddenLabels, 'A'] })),
      updateFilters(c => ({ hiddenLabels: [...c.hiddenLabels, 'B'] })),
    ])
    expect((await readPrefs()).filters.hiddenLabels).toEqual(['A', 'B'])
  })
})

describe('marketplace price prefs', () => {
  test.each([-1, Infinity, NaN, '10'])(
    'invalid limit %s gives defaults',
    limit => {
      expect(decodePrefs({ filters: { maxPrice: { UK: limit } } })).toEqual(
        DEFAULT_PREFS
      )
    }
  )
  test('version 3 migrates with all existing choices and price filtering off', async () => {
    const { maxPrice: _, ...filters } = {
      ...DEFAULT_FILTERS,
      minYear: 1990,
      maxYear: 2020,
      minRating: 4.5,
    }
    await fakeBrowser.storage.sync.set({
      prefs: { enabled: false, filters },
      prefs$: { v: 3 },
    })
    const fresh = (await import(
      `./prefs.ts?fresh=${Math.random()}`
    )) as typeof import('./prefs')
    const expected = {
      display: DEFAULT_DISPLAY,
      enabled: false,
      filters: { ...filters, maxPrice: {} },
    }
    expect(await fresh.readPrefs()).toEqual(expected)
    for (let i = 0; i < 100; i++) {
      const meta = (await fakeBrowser.storage.sync.get('prefs$')).prefs$ as
        | { v?: number }
        | undefined
      if (meta?.v === 7) break
      await Bun.sleep(10)
    }
    const stored = await fakeBrowser.storage.sync.get(['prefs', 'prefs$'])
    expect(stored).toEqual({
      prefs: expected,
      prefs$: { v: 7 },
    })
  })
  test('simultaneous edits preserve limits in other marketplaces and notify tabs', async () => {
    const seen: unknown[] = []
    const stop = watchPrefs(prefs => seen.push(prefs.filters.maxPrice))
    await Promise.all([
      updateFilters(current => ({ maxPrice: { ...current.maxPrice, UK: 0 } })),
      updateFilters(current => ({ maxPrice: { ...current.maxPrice, US: 20 } })),
    ])
    stop()
    expect((await readPrefs()).filters.maxPrice).toEqual({ UK: 0, US: 20 })
    expect(seen.at(-1)).toEqual({ UK: 0, US: 20 })
  })
})

describe('display prefs', () => {
  test('migrates version 4 without changing filters or the extension switch', async () => {
    const filters = { ...DEFAULT_FILTERS, minRating: 4.5, maxPrice: { UK: 0 } }
    await fakeBrowser.storage.sync.set({
      prefs: { enabled: false, filters },
      prefs$: { v: 4 },
    })
    const fresh = (await import(
      `./prefs.ts?fresh=${Math.random()}`
    )) as typeof import('./prefs')
    expect(await fresh.readPrefs()).toEqual({
      enabled: false,
      filters,
      display: DEFAULT_DISPLAY,
    })
    for (let i = 0; i < 100; i++) {
      const meta = (await fakeBrowser.storage.sync.get('prefs$')).prefs$ as
        | { v?: number }
        | undefined
      if (meta?.v === 7) break
      await Bun.sleep(10)
    }
    const stored = await fakeBrowser.storage.sync.get(['prefs', 'prefs$'])
    expect(stored).toEqual({
      prefs: { enabled: false, filters, display: DEFAULT_DISPLAY },
      prefs$: { v: 7 },
    })
  })
  test.each([-1, 11, 1.5])('rejects label count %s', labels => {
    expect(decodePrefs({ display: { labels } })).toEqual(DEFAULT_PREFS)
  })
})

describe('the version 5 record', () => {
  test('gives every filter the old mode and highlights no label', async () => {
    const { modes: _, highlightLabels: __, ...v5 } = DEFAULT_FILTERS
    await fakeBrowser.storage.sync.set({
      prefs: {
        enabled: true,
        display: DEFAULT_DISPLAY,
        filters: { ...v5, minRating: 4.2, mode: 'dim' },
      },
      prefs$: { v: 5 },
    })
    const fresh = (await import(
      `./prefs.ts?fresh=${Math.random()}`
    )) as typeof import('./prefs')
    const expected = {
      enabled: true,
      display: DEFAULT_DISPLAY,
      filters: {
        ...DEFAULT_FILTERS,
        minRating: 4.2,
        modes: {
          rating: 'dim',
          count: 'dim',
          labels: 'dim',
          year: 'dim',
          price: 'dim',
        } as const,
      },
    }
    expect(await fresh.readPrefs()).toEqual(expected)
    for (let i = 0; i < 100; i++) {
      const meta = (await fakeBrowser.storage.sync.get('prefs$')).prefs$ as
        | { v?: number }
        | undefined
      if (meta?.v === 7) break
      await Bun.sleep(10)
    }
    const stored = await fakeBrowser.storage.sync.get(['prefs', 'prefs$'])
    expect(stored).toEqual({ prefs: expected, prefs$: { v: 7 } })
  })
})

describe('the highlight rating', () => {
  test('is off by default, also in a record that predates it', () => {
    const { highlightRating: _, ...v6 } = DEFAULT_FILTERS
    expect(DEFAULT_FILTERS.highlightRating).toBeNull()
    expect(decodePrefs({ filters: { ...v6, minRating: 4.2 } })).toEqual({
      ...DEFAULT_PREFS,
      filters: { ...DEFAULT_FILTERS, minRating: 4.2 },
    })
  })
  test('keeps a rating from 1 to 5 and rejects anything else', () => {
    const filters = (highlightRating: unknown) => ({
      filters: { ...DEFAULT_FILTERS, highlightRating },
    })
    expect(decodePrefs(filters(4.5)).filters.highlightRating).toBe(4.5)
    expect(decodePrefs(filters(5)).filters.highlightRating).toBe(5)
    for (const bad of [0.5, 5.1, '4.5', Number.NaN])
      expect(decodePrefs(filters(bad))).toEqual(DEFAULT_PREFS)
  })
})
