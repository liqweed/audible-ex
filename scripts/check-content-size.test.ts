import { describe, expect, test } from 'bun:test'
import { BUDGET_BYTES, checkSize } from './check-content-size'

describe('checkSize', () => {
  test('passes at and under the budget', () => {
    expect(checkSize(BUDGET_BYTES).ok).toBe(true)
    expect(checkSize(1).ok).toBe(true)
  })

  test('fails one byte over, and says by how much and what to do', () => {
    const result = checkSize(BUDGET_BYTES + 2048)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('2.0 KB over')
    expect(result.message).toContain('effect')
  })
})
