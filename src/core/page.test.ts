import { describe, expect, test } from 'bun:test'
import * as Schema from 'effect/Schema'
import { isLibraryPath, pageKind } from '@/core/page'
import { Hello } from '@/schema/messages'

describe('pageKind', () => {
  test.each([
    ['/', 'home'],
    ['', 'home'],
    ['/search', 'search'],
    ['/cat', 'category'],
    ['/cat/Science-Fiction-Fantasy-Audiobooks/19378', 'category'],
    ['/categories', 'category'],
    ['/ep/audiobook-deals', 'deals'],
    ['/ep/summer-deals-2026', 'deals'],
    ['/library', 'library'],
    ['/library/titles', 'library'],
    ['/library/collections/abc', 'library'],
    ['/library/wishlist', 'wishlist'],
    ['/wl', 'wishlist'],
    ['/pd/Project-Hail-Mary-Audiobook/B08G9PRS1K', 'other'],
    ['/catalog', 'other'],
    ['/author/Andy-Weir/B00G0WYW92', 'other'],
  ] as const)('%s is %s', (path, kind) => {
    expect(pageKind(path)).toBe(kind)
  })

  test('every kind is one the Hello message accepts', () => {
    const isHello = Schema.is(Hello)
    for (const path of [
      '/',
      '/search',
      '/cat',
      '/ep/x-deals',
      '/library',
      '/wl',
      '/x',
    ]) {
      expect(
        isHello({ _tag: 'Hello', region: 'UK', page: pageKind(path) })
      ).toBe(true)
    }
  })

  test('ignores case', () => {
    expect(pageKind('/Library/WishList')).toBe('wishlist')
    expect(pageKind('/Search')).toBe('search')
  })
})

describe('isLibraryPath', () => {
  test('is true under /library only', () => {
    expect(isLibraryPath('/library/titles')).toBe(true)
    expect(isLibraryPath('/library')).toBe(true)
    expect(isLibraryPath('/library/wishlist')).toBe(true)
    expect(isLibraryPath('/librarypass')).toBe(false)
    expect(isLibraryPath('/wl')).toBe(false)
    expect(isLibraryPath('/search')).toBe(false)
  })
})
