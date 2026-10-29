import { describe, expect, test } from 'bun:test'
import {
  isExpired,
  isPinLapsed,
  isPurgeable,
  isPurgeDue,
  needsPinWrite,
  PIN_KEEP,
  PURGE_AGE,
  ratingTtl,
  TTL_FOUND,
  TTL_MISS,
} from './expiry'

const DAY = 864e5
const HOUR = 36e5
const now = 1_761_700_000_000

describe('time limits', () => {
  test('found ratings last 30 days, misses 7', () => {
    expect(TTL_FOUND).toBe(30 * DAY)
    expect(TTL_MISS).toBe(7 * DAY)
    expect(ratingTtl('Found')).toBe(TTL_FOUND)
    expect(ratingTtl('Miss')).toBe(TTL_MISS)
  })

  test('a record exactly at its limit is still good, one millisecond past it is not', () => {
    expect(isExpired(now - TTL_FOUND, TTL_FOUND, now)).toBe(false)
    expect(isExpired(now - TTL_FOUND - 1, TTL_FOUND, now)).toBe(true)
  })

  test('a record saved in the future is not expired', () => {
    expect(isExpired(now + DAY, TTL_MISS, now)).toBe(false)
  })
})

describe('purge', () => {
  test('purges after 32 days', () => {
    expect(PURGE_AGE).toBe(32 * DAY)
    expect(isPurgeable(now - 32 * DAY, now)).toBe(false)
    expect(isPurgeable(now - 32 * DAY - 1, now)).toBe(true)
  })

  test('is due when it never ran or a full day has passed since it did', () => {
    expect(isPurgeDue(undefined, now)).toBe(true)
    expect(isPurgeDue(now - 23 * HOUR, now)).toBe(false)
    expect(isPurgeDue(now - DAY + 1, now)).toBe(false)
    expect(isPurgeDue(now - DAY, now)).toBe(true)
  })
})

describe('pins', () => {
  test('a pin is rewritten once it is a day old, not before', () => {
    expect(needsPinWrite(undefined, now)).toBe(true)
    expect(needsPinWrite(now - 23 * HOUR, now)).toBe(false)
    expect(needsPinWrite(now - DAY, now)).toBe(true)
  })

  test('a pin written in the future is not rewritten', () => {
    expect(needsPinWrite(now + HOUR, now)).toBe(false)
  })

  test('a pin lapses 180 days after it was last seen', () => {
    expect(PIN_KEEP).toBe(180 * DAY)
    expect(isPinLapsed(now - 180 * DAY, now)).toBe(false)
    expect(isPinLapsed(now - 180 * DAY - 1, now)).toBe(true)
  })
})
