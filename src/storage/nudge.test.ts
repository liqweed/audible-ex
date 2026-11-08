import { beforeEach, describe, expect, test } from 'bun:test'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
  decodeEngagementValue,
  decodeNudgeValue,
  markNudgeShown,
  readEngagement,
  readNudge,
  recordRatings,
  watchEngagement,
  watchNudge,
} from './nudge'

beforeEach(() => fakeBrowser.reset())

describe('the usage counters', () => {
  test('start at zero', async () => {
    expect(await readEngagement()).toEqual({ days: [], ratings: 0 })
  })

  test('add up across calls and days', async () => {
    await recordRatings(10, '2026-11-01')
    await recordRatings(5, '2026-11-01')
    await recordRatings(1, '2026-11-02')
    expect(await readEngagement()).toEqual({
      days: ['2026-11-01', '2026-11-02'],
      ratings: 16,
    })
  })

  test('do not lose a count when updates start together', async () => {
    await Promise.all([
      recordRatings(1, '2026-11-01'),
      recordRatings(2, '2026-11-01'),
      recordRatings(3, '2026-11-01'),
    ])
    expect((await readEngagement()).ratings).toBe(6)
  })

  test('live in storage.local, not in the synced storage', async () => {
    await recordRatings(1, '2026-11-01')
    expect(Object.keys(await fakeBrowser.storage.local.get())).toContain(
      'engagement'
    )
    expect(Object.keys(await fakeBrowser.storage.sync.get())).not.toContain(
      'engagement'
    )
  })

  test('tell a watcher about each change', async () => {
    const seen: number[] = []
    const stop = watchEngagement(e => seen.push(e.ratings))
    await recordRatings(2, '2026-11-01')
    await recordRatings(3, '2026-11-01')
    stop()
    expect(seen).toEqual([2, 5])
  })

  test('start again from a damaged value', () => {
    expect(decodeEngagementValue('nonsense')).toEqual({ days: [], ratings: 0 })
    expect(decodeEngagementValue({ days: [1], ratings: -3 })).toEqual({
      days: [],
      ratings: 0,
    })
  })

  test('fill in a missing key', () => {
    expect(decodeEngagementValue({ ratings: 4 })).toEqual({
      days: [],
      ratings: 4,
    })
  })
})

describe('the rating request', () => {
  test('has not been shown at first', async () => {
    expect(await readNudge()).toEqual({ shown: false })
  })

  test('is shown for good once marked, and follows the profile', async () => {
    const seen: boolean[] = []
    const stop = watchNudge(n => seen.push(n.shown))
    await markNudgeShown()
    stop()
    expect(await readNudge()).toEqual({ shown: true })
    expect(seen).toEqual([true])
    expect(Object.keys(await fakeBrowser.storage.sync.get())).toContain('nudge')
  })

  test('reads a damaged value as not shown', () => {
    expect(decodeNudgeValue(7)).toEqual({ shown: false })
  })
})
