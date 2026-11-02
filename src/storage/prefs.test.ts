import { beforeEach, describe, expect, test } from 'bun:test'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
  DEFAULT_PREFS,
  decodePrefs,
  readPrefs,
  updatePrefs,
  watchPrefs,
} from './prefs'

beforeEach(() => {
  fakeBrowser.reset()
})

describe('decodePrefs', () => {
  test('a missing key takes its default', () => {
    expect(decodePrefs({})).toEqual({ enabled: true })
  })

  test('keeps what is stored', () => {
    expect(decodePrefs({ enabled: false })).toEqual({ enabled: false })
  })

  test.each([
    ['nothing stored', null],
    ['a string', 'off'],
    ['a wrong type', { enabled: 'no' }],
  ])('%s gives the defaults', (_, raw) => {
    expect(decodePrefs(raw)).toEqual(DEFAULT_PREFS)
  })

  test('ignores keys a newer version added', () => {
    expect(decodePrefs({ enabled: false, minRating: 4 })).toEqual({
      enabled: false,
    })
  })
})

describe('the sync:prefs item', () => {
  test('is enabled until the user turns it off', async () => {
    expect(await readPrefs()).toEqual({ enabled: true })
    await updatePrefs({ enabled: false })
    expect(await readPrefs()).toEqual({ enabled: false })
  })

  test('lives in storage.sync, not storage.local', async () => {
    await updatePrefs({ enabled: false })
    const sync = await fakeBrowser.storage.sync.get(null)
    expect(sync.prefs).toEqual({ enabled: false })
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
