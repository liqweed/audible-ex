import { describe, expect, test } from 'bun:test'
import {
  BUDGET_BYTES,
  checkSize,
  PANEL_BUDGET_BYTES,
} from './check-content-size'

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

  test('names the script and gives the panel its own advice', () => {
    expect(checkSize(1, BUDGET_BYTES).message).toContain('content script')
    const panel = checkSize(
      PANEL_BUDGET_BYTES + 1024,
      PANEL_BUDGET_BYTES,
      'panel script'
    )
    expect(panel.ok).toBe(false)
    expect(panel.message).toContain('panel script')
    expect(panel.message).toContain('PANEL_BUDGET_BYTES')
    expect(checkSize(PANEL_BUDGET_BYTES, PANEL_BUDGET_BYTES).ok).toBe(true)
  })

  test('the panel budget is larger than the content budget, which stays at 50 KB', () => {
    expect(BUDGET_BYTES).toBe(50 * 1024)
    expect(PANEL_BUDGET_BYTES).toBeGreaterThan(BUDGET_BYTES)
  })
})
