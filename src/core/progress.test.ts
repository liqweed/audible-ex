import { describe, expect, test } from 'bun:test'
import { counters, NO_PROGRESS, type Outcome, sameCounters } from './progress'

const outcomes = (entries: Record<string, Outcome>) =>
  new Map(Object.entries(entries))

describe('counters', () => {
  test('is all zeros for a tab that asked for nothing', () => {
    expect(counters(new Set(), new Set(), new Map(), undefined)).toEqual(
      NO_PROGRESS
    )
  })

  test('splits the pending ASINs into active (a request is out) and queued', () => {
    const c = counters(
      new Set(['A', 'B', 'C']),
      new Set(['B', 'Z']),
      new Map(),
      undefined
    )
    expect(c).toMatchObject({ queued: 2, active: 1, done: 0 })
  })

  test('counts every settled ASIN as done, with cached, notFound and failed inside it', () => {
    const c = counters(
      new Set(['E']),
      new Set(),
      outcomes({
        A: { result: 'found', cached: true },
        B: { result: 'found', cached: false },
        C: { result: 'notFound', cached: false },
        D: { result: 'failed', cached: false },
      }),
      undefined
    )
    expect(c).toEqual({
      queued: 1,
      active: 0,
      done: 4,
      cached: 1,
      notFound: 1,
      failed: 1,
    })
  })

  test('counts a miss answered from the cache as both cached and not found', () => {
    const c = counters(
      new Set(),
      new Set(),
      outcomes({ A: { result: 'notFound', cached: true } }),
      undefined
    )
    expect(c).toMatchObject({ done: 1, cached: 1, notFound: 1 })
  })

  test('reports the pause only while lookups are pending', () => {
    const pending = counters(new Set(['A']), new Set(), new Map(), 5_000)
    expect(pending.pausedUntil).toBe(5_000)
    const idle = counters(new Set(), new Set(), new Map(), 5_000)
    expect('pausedUntil' in idle).toBe(false)
  })
})

describe('sameCounters', () => {
  test('compares every field, the pause included', () => {
    expect(sameCounters(NO_PROGRESS, { ...NO_PROGRESS })).toBe(true)
    expect(sameCounters(NO_PROGRESS, { ...NO_PROGRESS, done: 1 })).toBe(false)
    expect(sameCounters(NO_PROGRESS, { ...NO_PROGRESS, pausedUntil: 1 })).toBe(
      false
    )
  })
})
