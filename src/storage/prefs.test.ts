import { beforeEach, describe, expect, test } from 'bun:test'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
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
    expect(decodePrefs({})).toEqual({ enabled: true, filters: DEFAULT_FILTERS })
  })

  test('keeps what is stored', () => {
    expect(decodePrefs({ enabled: false })).toEqual({
      enabled: false,
      filters: DEFAULT_FILTERS,
    })
  })

  test('the filters start at the documented defaults', () => {
    expect(DEFAULT_FILTERS).toEqual({
      enabled: true,
      minRating: 4,
      minRatings: 50,
      hiddenLabels: [],
      notFound: 'show',
      mode: 'hide',
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
    ['a mode that is not a mode', { mode: 'show' }],
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
      enabled: false,
      filters: DEFAULT_FILTERS,
    })
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
      enabled: false,
      filters: DEFAULT_FILTERS,
    })
  })

  test('is rewritten as version 2 when the extension starts', async () => {
    await seedV1()
    // WXT migrates when the item is defined, which is when the module loads: load a fresh copy.
    const fresh = (await import(
      `./prefs.ts?fresh=${Math.random()}`
    )) as typeof import('./prefs')
    expect(await fresh.readPrefs()).toEqual({
      enabled: false,
      filters: DEFAULT_FILTERS,
    })
    // The rewrite is asynchronous and nothing announces it: wait for it, up to a second.
    for (let i = 0; i < 100; i++) {
      const meta = (await fakeBrowser.storage.sync.get('prefs$')).prefs$ as
        | { v?: number }
        | undefined
      if (meta?.v === 2) break
      await Bun.sleep(10)
    }
    const stored = await fakeBrowser.storage.sync.get(['prefs', 'prefs$'])
    expect(stored.prefs).toEqual({ enabled: false, filters: DEFAULT_FILTERS })
    expect(stored.prefs$).toEqual({ v: 2 })
  })
})

describe('quick updates', () => {
  test('started together, they all land', async () => {
    await Promise.all([
      updateFilters({ minRating: 4.5 }),
      updateFilters({ mode: 'dim' }),
      updatePrefs({ enabled: false }),
      updateFilters({ hiddenLabels: ['Romance'] }),
    ])
    expect(await readPrefs()).toEqual({
      enabled: false,
      filters: {
        ...DEFAULT_FILTERS,
        minRating: 4.5,
        mode: 'dim',
        hiddenLabels: ['Romance'],
      },
    })
  })
})
