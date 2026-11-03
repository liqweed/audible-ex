import { beforeEach, describe, expect, test } from 'bun:test'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
  DEFAULT_PANEL,
  decodePanel,
  readPanel,
  updatePanel,
  watchPanel,
} from './panel'

beforeEach(() => {
  fakeBrowser.reset()
})

describe('decodePanel', () => {
  test('a missing key takes its default', () => {
    expect(decodePanel({ corner: 'topLeft' })).toEqual({
      corner: 'topLeft',
      collapsed: false,
      hiddenHosts: [],
    })
  })

  test('keeps what is stored', () => {
    const stored = {
      corner: 'topRight' as const,
      collapsed: true,
      hiddenHosts: ['www.audible.com'],
    }
    expect(decodePanel(stored)).toEqual(stored)
  })

  test.each([
    ['nothing stored', null],
    ['a string', 'left'],
    ['an unknown corner', { corner: 'middle' }],
    ['a wrong type', { hiddenHosts: 'www.audible.com' }],
  ])('%s gives the defaults', (_, raw) => {
    expect(decodePanel(raw)).toEqual(DEFAULT_PANEL)
  })
})

describe('the local:panel item', () => {
  test('starts docked at the bottom right, open and shown everywhere', async () => {
    expect(await readPanel()).toEqual({
      corner: 'bottomRight',
      collapsed: false,
      hiddenHosts: [],
    })
  })

  test('lives in storage.local, not storage.sync', async () => {
    await updatePanel({ collapsed: true })
    const local = await fakeBrowser.storage.local.get(null)
    expect(local.panel).toMatchObject({ collapsed: true })
    const sync = await fakeBrowser.storage.sync.get(null)
    expect(Object.keys(sync)).toEqual([])
  })

  test('a change keeps the rest', async () => {
    await updatePanel({ corner: 'topLeft' })
    await updatePanel({ collapsed: true })
    expect(await readPanel()).toMatchObject({
      corner: 'topLeft',
      collapsed: true,
    })
  })

  test('a function sees the stored state, so a site hidden elsewhere is kept', async () => {
    await updatePanel({ hiddenHosts: ['a.example'] })
    await updatePanel(s => ({ hiddenHosts: [...s.hiddenHosts, 'b.example'] }))
    expect((await readPanel()).hiddenHosts).toEqual(['a.example', 'b.example'])
  })

  test('tells watchers the new state, and stops when asked', async () => {
    const seen: boolean[] = []
    const stop = watchPanel(state => seen.push(state.collapsed))
    await updatePanel({ collapsed: true })
    await updatePanel({ collapsed: false })
    stop()
    await updatePanel({ collapsed: true })
    expect(seen).toEqual([true, false])
  })
})

describe('quick updates', () => {
  test('started together, they all land', async () => {
    await Promise.all([
      updatePanel(s => ({ hiddenHosts: [...s.hiddenHosts, 'a.example'] })),
      updatePanel(s => ({ hiddenHosts: [...s.hiddenHosts, 'b.example'] })),
      updatePanel({ collapsed: true }),
    ])
    expect(await readPanel()).toMatchObject({
      hiddenHosts: ['a.example', 'b.example'],
      collapsed: true,
    })
  })
})
