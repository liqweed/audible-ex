import { expect, test } from 'bun:test'
import { cacheSplit } from './CacheBar'

test('the parts add up to the books and the unsorted pins are what is left of the pinned', () => {
  expect(
    cacheSplit({ books: 880, pinned: 312, library: 200, wishlist: 100 })
  ).toEqual({ library: 200, wishlist: 100, unsorted: 12, other: 568 })
  expect(
    cacheSplit({ books: 880, pinned: 312, library: 0, wishlist: 0 })
  ).toEqual({ library: 0, wishlist: 0, unsorted: 312, other: 568 })
})

test('the split never counts more pinned books than there are books', () => {
  expect(
    cacheSplit({ books: 10, pinned: 40, library: 30, wishlist: 20 })
  ).toEqual({ library: 10, wishlist: 0, unsorted: 0, other: 0 })
  expect(cacheSplit({ books: 0, pinned: 0, library: 0, wishlist: 0 })).toEqual({
    library: 0,
    wishlist: 0,
    unsorted: 0,
    other: 0,
  })
})
