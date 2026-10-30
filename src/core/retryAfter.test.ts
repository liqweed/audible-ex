import { describe, expect, test } from 'bun:test'
import { parseRetryAfter } from '@/core/retryAfter'

const NOW = Date.parse('2026-10-29T12:00:00Z')

describe('parseRetryAfter', () => {
  test('reads a number of seconds', () => {
    expect(parseRetryAfter('120', NOW)).toBe(120_000)
    expect(parseRetryAfter(' 0 ', NOW)).toBe(0)
  })

  test('reads an HTTP date as the wait from now', () => {
    expect(parseRetryAfter('Thu, 29 Oct 2026 12:00:30 GMT', NOW)).toBe(30_000)
  })

  test('a date in the past is no wait', () => {
    expect(parseRetryAfter('Thu, 29 Oct 2026 11:00:00 GMT', NOW)).toBe(0)
  })

  test('is undefined when absent or unreadable', () => {
    expect(parseRetryAfter(undefined, NOW)).toBeUndefined()
    expect(parseRetryAfter(null, NOW)).toBeUndefined()
    expect(parseRetryAfter('', NOW)).toBeUndefined()
    expect(parseRetryAfter('soon', NOW)).toBeUndefined()
    expect(parseRetryAfter('-5', NOW)).toBeUndefined()
  })
})
