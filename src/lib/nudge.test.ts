import { describe, expect, test } from 'bun:test'
import { DEFAULT_PREFS } from '@/storage/prefs'
import { isCustomized } from './nudge'

describe('isCustomized', () => {
  test('is false for the defaults', () => {
    expect(isCustomized(DEFAULT_PREFS)).toBe(false)
  })

  test('ignores the master switch', () => {
    expect(isCustomized({ ...DEFAULT_PREFS, enabled: false })).toBe(false)
  })

  test('sees a changed filter', () => {
    expect(
      isCustomized({
        ...DEFAULT_PREFS,
        filters: { ...DEFAULT_PREFS.filters, minRating: 3.5 },
      })
    ).toBe(true)
  })

  test('sees a highlighted label', () => {
    expect(
      isCustomized({
        ...DEFAULT_PREFS,
        filters: { ...DEFAULT_PREFS.filters, highlightLabels: ['Fantasy'] },
      })
    ).toBe(true)
  })

  test('sees a changed display', () => {
    expect(
      isCustomized({
        ...DEFAULT_PREFS,
        display: { ...DEFAULT_PREFS.display, year: false },
      })
    ).toBe(true)
  })
})
