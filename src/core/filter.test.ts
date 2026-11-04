import { describe, expect, test } from 'bun:test'
import {
  DIMENSIONS,
  type Dimension,
  type FilterBook,
  type FilterSettings,
  failures,
  hasLabel,
  isHighlighted,
  judge,
  labelKey,
  lookupDepth,
  place,
  verdict,
} from './filter'

const settings: FilterSettings = {
  enabled: true,
  minRating: 4,
  minRatings: 50,
  minYear: null,
  maxYear: null,
  maxPrice: {},
  hiddenLabels: [],
  highlightLabels: [],
  notFound: 'show',
  modes: {
    rating: 'hide',
    count: 'hide',
    labels: 'hide',
    year: 'hide',
    price: 'hide',
  },
}
const with_ = (over: Partial<FilterSettings>): FilterSettings => ({
  ...settings,
  ...over,
})
/** `settings` with the filters in `dim` dimmed and the others hiding. */
const dimming = (...dim: Dimension[]): FilterSettings['modes'] =>
  Object.fromEntries(
    DIMENSIONS.map(d => [d, dim.includes(d) ? 'dim' : 'hide'])
  ) as FilterSettings['modes']
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

  test('a failing book gets the mode of the filter it fails', () => {
    expect(judge(ready(3, 900), with_({ modes: dimming('rating') }))).toBe(
      'dim'
    )
    expect(judge(ready(3, 900), with_({ modes: dimming('count') }))).toBe(
      'hide'
    )
  })

  test('one hiding filter is enough to hide; dimming filters alone dim', () => {
    const book = ready(3, 10)
    expect(judge(book, with_({ modes: dimming('rating') }))).toBe('hide')
    expect(judge(book, with_({ modes: dimming('rating', 'count') }))).toBe(
      'dim'
    )
  })

  test.each(['queued', 'loading', 'failed'] as const)(
    'never hides a book that is %s',
    status => {
      const s = with_({ notFound: 'hide' })
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

describe('first-published year', () => {
  const book = (year?: number): FilterBook => ({
    ...ready(4.5, 900),
    ...(year !== undefined && { details: { genres: [], year } }),
  })
  const range = with_({ minYear: 2000, maxYear: 2020 })

  test.each([
    [1999, 'hide'],
    [2000, 'show'],
    [2010, 'show'],
    [2020, 'show'],
    [2021, 'hide'],
  ] as const)(
    'year %s has the %s verdict (inclusive bounds)',
    (year, expected) => {
      expect(judge(book(year), range)).toBe(expected)
    }
  )

  test('either end can be open and both are off by default', () => {
    expect(judge(book(-700), settings)).toBe('show')
    expect(judge(book(-700), with_({ maxYear: 2000 }))).toBe('show')
    expect(judge(book(2050), with_({ minYear: 2000 }))).toBe('show')
    expect(judge(book(2050), with_({ maxYear: 2000 }))).toBe('hide')
  })

  test('supports BCE years and a single year', () => {
    const ancient = with_({ minYear: -800, maxYear: -700 })
    expect(judge(book(-801), ancient)).toBe('hide')
    expect(judge(book(-800), ancient)).toBe('show')
    expect(judge(book(-700), ancient)).toBe('show')
    expect(judge(book(1), ancient)).toBe('hide')
    expect(judge(book(2000), with_({ minYear: 2000, maxYear: 2000 }))).toBe(
      'show'
    )
  })

  test('missing details and unknown years stay visible; other filters still apply', () => {
    expect(judge(book(), range)).toBe('show')
    expect(judge(book(0), range)).toBe('show')
    expect(judge({ ...book(0), rating: { r: 2, n: 900 } }, range)).toBe('hide')
  })

  test('respects dim mode, the master switch, carousels and peek', () => {
    expect(judge(book(1999), { ...range, modes: dimming('year') })).toBe('dim')
    expect(judge(book(1999), { ...range, enabled: false })).toBe('show')
    expect(verdict(book(1999), range, { inCarousel: true, peek: false })).toBe(
      'dim'
    )
    expect(verdict(book(1999), range, { inCarousel: false, peek: true })).toBe(
      'dim'
    )
  })

  test.each(['queued', 'loading', 'failed'] as const)(
    'a %s book is never hidden by year',
    status => {
      expect(judge({ ...book(1999), status }, range)).toBe('show')
    }
  )
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
    expect(hasLabel([' romance'], 'Romance ')).toBe(true)
    expect(hasLabel(['Romance'], 'Historical Romance')).toBe(false)
    expect(hasLabel([], 'Romance')).toBe(false)
  })
})

describe('maximum price per marketplace', () => {
  const limits = with_({ maxPrice: { UK: 10, US: 20 } })
  const book = (amount: number, currency = 'GBP'): FilterBook => ({
    ...ready(4.5, 900),
    price: { amount, currency },
  })
  test('uses the current marketplace and includes the ceiling itself', () => {
    expect(judge(book(10), limits, 'UK')).toBe('show')
    expect(judge(book(10.01), limits, 'UK')).toBe('hide')
    expect(judge(book(15, 'USD'), limits, 'US')).toBe('show')
    expect(judge(book(15, 'EUR'), limits, 'DE')).toBe('show')
  })
  test('unknown prices, mismatched currencies and unset limits do not fail', () => {
    expect(judge(ready(4.5, 900), limits, 'UK')).toBe('show')
    expect(judge(book(100, 'USD'), limits, 'UK')).toBe('show')
    expect(judge(book(100), settings, 'UK')).toBe('show')
    expect(judge(book(100), limits)).toBe('show')
  })
  test('zero means free only and the usual guardrails still apply', () => {
    const free = with_({ maxPrice: { UK: 0 } })
    expect(judge(book(0), free, 'UK')).toBe('show')
    expect(judge(book(0.01), free, 'UK')).toBe('hide')
    expect(judge(book(20), { ...limits, modes: dimming('price') }, 'UK')).toBe(
      'dim'
    )
    expect(judge(book(20), { ...limits, enabled: false }, 'UK')).toBe('show')
    expect(
      verdict(book(20), limits, { inCarousel: true, peek: false }, 'UK')
    ).toBe('dim')
    expect(
      verdict(book(20), limits, { inCarousel: false, peek: true }, 'UK')
    ).toBe('dim')
  })
  test('acts as soon as the price is known, before the rating', () => {
    const priced = (status: FilterBook['status']): FilterBook => ({
      status,
      price: { amount: 20, currency: 'GBP' },
    })
    for (const status of ['queued', 'loading', 'failed'] as const) {
      expect(judge(priced(status), limits, 'UK')).toBe('hide')
    }
    expect(failures(priced('loading'), limits, 'UK')).toEqual(['price'])
  })
  test('a book not on Goodreads gets the stricter of its price and the not-found policy', () => {
    const missing: FilterBook = {
      status: 'notFound',
      price: { amount: 20, currency: 'GBP' },
    }
    expect(judge(missing, limits, 'UK')).toBe('hide')
    expect(judge(missing, { ...limits, modes: dimming('price') }, 'UK')).toBe(
      'dim'
    )
    expect(
      judge(
        missing,
        { ...limits, modes: dimming('price'), notFound: 'hide' },
        'UK'
      )
    ).toBe('hide')
    expect(judge({ status: 'notFound' }, limits, 'UK')).toBe('show')
  })
})

describe('failures', () => {
  test('lists every filter a book fails, in order', () => {
    const s = with_({
      hiddenLabels: ['Romance'],
      maxYear: 2000,
      maxPrice: { UK: 5 },
    })
    const book: FilterBook = {
      status: 'ready',
      rating: { r: 3, n: 10 },
      details: { genres: ['Romance'], year: 2010 },
      price: { amount: 9, currency: 'GBP' },
    }
    expect(failures(book, s, 'UK')).toEqual([
      'rating',
      'count',
      'labels',
      'year',
      'price',
    ])
    expect(failures(ready(4.5, 900), s, 'UK')).toEqual([])
  })

  test('a book without its rating fails nothing but its price', () => {
    expect(failures({ status: 'loading' }, settings)).toEqual([])
    expect(
      failures(
        {
          status: 'loading',
          rating: { r: 1, n: 1 },
          details: { genres: ['x'] },
        },
        with_({ hiddenLabels: ['x'] })
      )
    ).toEqual([])
  })
})

describe('highlighted labels', () => {
  const s = with_({ highlightLabels: [' science fiction'] })

  test('mark a ready book carrying one, whatever its case', () => {
    expect(isHighlighted(ready(4.5, 900, ['Science Fiction']), s)).toBe(true)
    expect(isHighlighted(ready(4.5, 900, ['Fantasy']), s)).toBe(false)
    expect(isHighlighted(ready(4.5, 900), s)).toBe(false)
    expect(isHighlighted(undefined, s)).toBe(false)
  })

  test('hold with the filters off, and never change the verdict', () => {
    const book = ready(2, 900, ['Science Fiction'])
    expect(isHighlighted(book, { ...s, enabled: false })).toBe(true)
    expect(judge(book, s)).toBe('hide')
    expect(judge(ready(4.5, 900, ['Science Fiction']), s)).toBe('show')
  })
})

describe('lookupDepth (eager filtering)', () => {
  const limits = with_({ maxPrice: { UK: 10 } })
  const unpriced = { ...flat, priced: false }
  const priced = { ...flat, priced: true }
  const costing = (amount: number): FilterBook => ({
    status: 'queued',
    price: { amount, currency: 'GBP' },
  })

  test('asks only the cache while a hiding price limit waits for the price', () => {
    expect(lookupDepth({ status: 'queued' }, limits, unpriced, 'UK')).toBe(
      'cached'
    )
    // A rating from the cache can hide it before the price arrives.
    expect(lookupDepth(ready(3, 900), limits, unpriced, 'UK')).toBe('none')
    expect(lookupDepth(costing(20), limits, priced, 'UK')).toBe('none')
    expect(lookupDepth(costing(5), limits, priced, 'UK')).toBe('rating')
    // An unavailable price fails nothing.
    expect(lookupDepth({ status: 'queued' }, limits, priced, 'UK')).toBe(
      'rating'
    )
  })

  test('asks for the rating alone while a hiding rating filter could hide the book', () => {
    expect(lookupDepth({ status: 'queued' }, settings, unpriced, 'UK')).toBe(
      'rating'
    )
    expect(lookupDepth(ready(3, 900), settings, unpriced, 'UK')).toBe('none')
    expect(lookupDepth(ready(4.5, 10), settings, unpriced, 'UK')).toBe('none')
    expect(lookupDepth(ready(4.5, 900), settings, unpriced, 'UK')).toBe(
      'details'
    )
  })

  test('asks for everything where nothing can hide the book', () => {
    const queued: FilterBook = { status: 'queued' }
    const dimmingAll = with_({
      maxPrice: { UK: 10 },
      modes: dimming('rating', 'count', 'price'),
    })
    expect(lookupDepth(queued, dimmingAll, unpriced, 'UK')).toBe('details')
    expect(lookupDepth(ready(2, 1), dimmingAll, unpriced, 'UK')).toBe('details')
    // The count alone could hide it, as long as it has a minimum.
    expect(
      lookupDepth(queued, with_({ modes: dimming('rating') }), unpriced, 'UK')
    ).toBe('rating')
    expect(
      lookupDepth(
        queued,
        with_({ modes: dimming('rating'), minRatings: 0 }),
        unpriced,
        'UK'
      )
    ).toBe('details')
    expect(
      lookupDepth(costing(20), { ...limits, enabled: false }, priced, 'UK')
    ).toBe('details')
  })

  test('a book in a carousel or while peeking is seen, so it gets everything', () => {
    for (const where of [
      { inCarousel: true, peek: false, priced: true },
      { inCarousel: false, peek: true, priced: true },
    ]) {
      expect(lookupDepth(costing(20), limits, where, 'UK')).toBe('details')
      expect(lookupDepth(ready(2, 1), settings, where, 'UK')).toBe('details')
    }
  })
})
