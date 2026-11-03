import { describe, expect, test } from 'bun:test'
import {
  type FilterBook,
  type FilterSettings,
  isHiddenLabel,
  judge,
  labelKey,
  place,
  verdict,
} from './filter'

const settings: FilterSettings = {
  enabled: true,
  minRating: 4,
  minRatings: 50,
  hiddenLabels: [],
  notFound: 'show',
  mode: 'hide',
}
const with_ = (over: Partial<FilterSettings>): FilterSettings => ({
  ...settings,
  ...over,
})
const ready = (r: number, n: number, genres?: string[]): FilterBook => ({
  status: 'ready',
  rating: { r, n },
  ...(genres ? { details: { genres } } : {}),
})
const flat = { inCarousel: false, peek: false }

describe('judge', () => {
  test('shows a book that passes every filter', () => {
    expect(judge(ready(4.3, 900), settings)).toBe('show')
  })

  test('a rating below the minimum fails; the minimum itself passes', () => {
    expect(judge(ready(3.9, 900), settings)).toBe('hide')
    expect(judge(ready(4, 900), settings)).toBe('show')
  })

  test('too few ratings fail, and 0 turns that off', () => {
    expect(judge(ready(4.5, 49), settings)).toBe('hide')
    expect(judge(ready(4.5, 50), settings)).toBe('show')
    expect(judge(ready(4.5, 0), with_({ minRatings: 0 }))).toBe('show')
  })

  test('a hidden label fails, whatever its case or spacing', () => {
    const s = with_({ hiddenLabels: ['  romance '] })
    expect(judge(ready(4.5, 900, ['Fantasy', 'ROMANCE']), s)).toBe('hide')
    expect(judge(ready(4.5, 900, ['Fantasy']), s)).toBe('show')
  })

  test('a hidden label cannot act before the details arrive', () => {
    const s = with_({ hiddenLabels: ['Romance'] })
    expect(judge(ready(4.5, 900), s)).toBe('show')
  })

  test('the rating filter acts before the details arrive', () => {
    expect(judge(ready(2, 900), with_({ hiddenLabels: ['x'] }))).toBe('hide')
  })

  test('a failing book gets the mode', () => {
    expect(judge(ready(3, 900), with_({ mode: 'dim' }))).toBe('dim')
  })

  test.each(['queued', 'loading', 'failed'] as const)(
    'never hides a book that is %s',
    status => {
      const s = with_({ notFound: 'hide', mode: 'hide' })
      expect(judge({ status }, s)).toBe('show')
      expect(judge(undefined, s)).toBe('show')
    }
  )

  test.each(['show', 'dim', 'hide'] as const)(
    'a book not on Goodreads gets the %s policy',
    notFound => {
      expect(judge({ status: 'notFound' }, with_({ notFound }))).toBe(notFound)
    }
  )

  test('with the filters off everything shows', () => {
    const off = with_({ enabled: false, notFound: 'hide' })
    expect(judge(ready(1, 1), off)).toBe('show')
    expect(judge({ status: 'notFound' }, off)).toBe('show')
  })
})

describe('place', () => {
  test('a carousel dims what would be hidden', () => {
    expect(place('hide', { inCarousel: true, peek: false })).toBe('dim')
  })

  test('peeking dims what would be hidden', () => {
    expect(place('hide', { inCarousel: false, peek: true })).toBe('dim')
  })

  test.each(['show', 'dim'] as const)('leaves %s alone', v => {
    expect(place(v, { inCarousel: true, peek: true })).toBe(v)
  })

  test('hides on an ordinary page', () => {
    expect(place('hide', flat)).toBe('hide')
  })
})

describe('verdict', () => {
  test('combines the judgement and the place', () => {
    const book = ready(2, 900)
    expect(verdict(book, settings, flat)).toBe('hide')
    expect(verdict(book, settings, { inCarousel: true, peek: false })).toBe(
      'dim'
    )
    expect(verdict(book, settings, { inCarousel: false, peek: true })).toBe(
      'dim'
    )
  })
})

describe('labels', () => {
  test('compare without regard to case or space', () => {
    expect(labelKey('  Science Fiction ')).toBe('science fiction')
    expect(isHiddenLabel([' romance'], 'Romance ')).toBe(true)
    expect(isHiddenLabel(['Romance'], 'Historical Romance')).toBe(false)
    expect(isHiddenLabel([], 'Romance')).toBe(false)
  })
})
