import { describe, expect, test } from 'bun:test'
import { books, formatBytes } from './format'

describe('formatBytes', () => {
  test.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [35_000, '34 KB'],
    [1_363_149, '1.3 MB'],
  ])('%d is %s', (n, text) => {
    expect(formatBytes(n)).toBe(text)
  })
})

test('books is singular for one', () => {
  expect(books(1)).toBe('1 book')
  expect(books(0)).toBe('0 books')
  expect(books(12)).toBe('12 books')
})
