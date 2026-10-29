import { beforeEach, describe, expect, test } from 'bun:test'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { storage } from 'wxt/utils/storage'

// Proves the preload: WXT storage runs on the fake browser under `bun test`.
describe('wxt storage on the fake browser', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  const counter = storage.defineItem<number>('local:test-counter', {
    fallback: 0,
  })

  test('set then get', async () => {
    expect(await counter.getValue()).toBe(0)
    await counter.setValue(3)
    expect(await counter.getValue()).toBe(3)
  })

  test('watch sees changes', async () => {
    const seen: [number, number][] = []
    const unwatch = counter.watch((value, previous) => {
      seen.push([value, previous])
    })
    await counter.setValue(1)
    await counter.setValue(2)
    unwatch()
    await counter.setValue(5)
    expect(seen).toEqual([
      [1, 0],
      [2, 1],
    ])
  })
})
