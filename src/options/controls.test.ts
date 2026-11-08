import { describe, expect, test } from 'bun:test'
import { stepText } from './controls'

describe('stepText', () => {
  const rating = { step: 0.1, min: 1, max: 5, start: 4 }
  test.each([
    ['4', 1, '4.1'],
    ['4.1', 1, '4.2'],
    ['4.2', -1, '4.1'],
    // Float arithmetic must not leak into the text: 0.1 + 0.2 is 0.30000000000000004.
    ['0.2', 1, '1'],
    ['4.9', 1, '5'],
    ['5', 1, '5'],
    ['1', -1, '1'],
    ['', 1, '4'],
    ['', -1, '4'],
    ['abc', 1, '4'],
    ['4.', 1, '4.1'],
  ] as const)('%p, direction %p, gives %p', (text, direction, result) => {
    expect(stepText(text, direction, rating)).toBe(result)
  })
  test('whole steps stay whole and respect their own limits', () => {
    expect(stepText('50', 1, { step: 10, min: 0 })).toBe('60')
    expect(stepText('5', -1, { step: 10, min: 0 })).toBe('0')
    expect(stepText('1990', -1, { step: 1 })).toBe('1989')
  })
})
