import { describe, expect, test } from 'bun:test'
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  backoffMs,
  clampRetryAfter,
  pauseMs,
  RETRY_AFTER_MAX_MS,
} from './backoff'

describe('backoffMs', () => {
  test('starts at 5 s and doubles', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000,
    ])
  })

  test('is capped at 2 min, however many rate-limits in a row', () => {
    expect(backoffMs(6)).toBe(BACKOFF_MAX_MS)
    expect(backoffMs(50)).toBe(BACKOFF_MAX_MS)
    expect(backoffMs(100_000)).toBe(BACKOFF_MAX_MS)
  })

  test('treats a step below 1 as the first', () => {
    expect(backoffMs(0)).toBe(BACKOFF_BASE_MS)
    expect(backoffMs(-3)).toBe(BACKOFF_BASE_MS)
  })
})

describe('pauseMs', () => {
  test('is the backoff when there is no Retry-After', () => {
    expect(pauseMs(2)).toBe(10_000)
  })

  test('is raised to a longer Retry-After and never shortened by a shorter one', () => {
    expect(pauseMs(1, 30_000)).toBe(30_000)
    expect(pauseMs(3, 1_000)).toBe(20_000)
  })

  test('honours a Retry-After above the backoff cap, up to its own cap', () => {
    expect(pauseMs(1, 200_000)).toBe(200_000)
    expect(pauseMs(1, 3_600_000)).toBe(RETRY_AFTER_MAX_MS)
  })
})

describe('clampRetryAfter', () => {
  test('is 0 for an absent or negative value', () => {
    expect(clampRetryAfter(undefined)).toBe(0)
    expect(clampRetryAfter(-5)).toBe(0)
  })
})
