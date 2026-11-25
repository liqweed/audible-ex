import { describe, expect, test } from 'bun:test'
import { dropIndex, moveItem, type VerticalRect } from './reorder'

describe('moveItem', () => {
  test('moves an item forward or backward without mutating the input', () => {
    const items = ['a', 'b', 'c', 'd'] as const
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(items, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(items).toEqual(['a', 'b', 'c', 'd'])
  })

  test('returns a copy unchanged for no-op or out-of-range moves', () => {
    const items = ['a', 'b', 'c'] as const
    expect(moveItem(items, 1, 1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(items, -1, 1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(items, 1, 5)).toEqual(['a', 'b', 'c'])
  })
})

describe('dropIndex', () => {
  const equal: VerticalRect[] = [
    { top: 0, height: 40 }, // mid 20
    { top: 40, height: 40 }, // mid 60
    { top: 80, height: 40 }, // mid 100
  ]

  test('computes the target slot when dragging down past midpoints', () => {
    expect(dropIndex(0, 10, equal)).toBe(0)
    expect(dropIndex(0, 50, equal)).toBe(0)
    expect(dropIndex(0, 70, equal)).toBe(1)
    expect(dropIndex(0, 110, equal)).toBe(2)
    expect(dropIndex(0, 500, equal)).toBe(2)
  })

  test('computes the target slot when dragging up past midpoints', () => {
    expect(dropIndex(2, 110, equal)).toBe(2)
    expect(dropIndex(2, 70, equal)).toBe(2)
    expect(dropIndex(2, 50, equal)).toBe(1)
    expect(dropIndex(2, 10, equal)).toBe(0)
    expect(dropIndex(2, -50, equal)).toBe(0)
  })

  test('handles rows of unequal height cleanly', () => {
    const varied: VerticalRect[] = [
      { top: 0, height: 30 }, // mid 15
      { top: 30, height: 100 }, // mid 80
      { top: 130, height: 30 }, // mid 145
    ]
    expect(dropIndex(0, 75, varied)).toBe(0)
    expect(dropIndex(0, 85, varied)).toBe(1)
    expect(dropIndex(0, 150, varied)).toBe(2)
    expect(dropIndex(2, 85, varied)).toBe(2)
    expect(dropIndex(2, 75, varied)).toBe(1)
    expect(dropIndex(2, 10, varied)).toBe(0)
  })
})
