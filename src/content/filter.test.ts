/**
 * The filters on a saved Audible page (ARCHITECTURE.md §7): every book gets a rating, and the cards
 * that fail the user's filters are hidden, or dimmed where hiding would break the page. The checks
 * are stated from outside: a card is whatever element carries `data-agx-filter` above a badge, and
 * "in a carousel" is what the page's own markup says (`adbl-product-carousel`).
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import type { FilterSettings } from '@/core/filter'
import { DEFAULT_FILTERS } from '@/storage/prefs'
import {
  FakeFilters,
  loadBody,
  loadFixture,
  mainBadges,
  notFound,
  ready,
  startWorld,
  type World,
} from '../../test/content-harness'
import { NO_FILTERS } from './filter'
import { currentHandle } from './shared'

const FILTERS: FilterSettings = {
  enabled: true,
  minRating: 4,
  minRatings: 50,
  minYear: null,
  maxYear: null,
  maxPrice: {},
  hiddenLabels: [],
  highlightLabels: [],
  notFound: 'show',
  modes: DEFAULT_FILTERS.modes,
}

/** Rating and count of the n-th book looked up: every third book is a poor one. */
const ratingOf = (i: number) =>
  i % 3 === 0 ? { r: 3.1, n: 900 } : { r: 4.4, n: 900 }

/** The cards that carry the attribute above a main badge, by the badge's ASIN. */
function marked(attribute: 'hide' | 'dim') {
  return mainBadges()
    .map(badge => ({
      asin: (badge as HTMLElement).dataset.asin as string,
      card: badge.closest(`[data-agx-filter="${attribute}"]`),
    }))
    .filter(({ card }) => card !== null) as Array<{
    asin: string
    card: Element
  }>
}

const inCarousel = (el: Element) => el.closest('adbl-product-carousel') !== null
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('filters on the com search fixture (list rows and carousels)', () => {
  let world: World
  let filters: FakeFilters
  let asins: string[]
  let poor: Set<string>

  beforeEach(async () => {
    loadFixture('com', 'search')
    filters = new FakeFilters(FILTERS)
    world = startWorld({
      hostname: 'www.audible.com',
      pathname: '/search',
      filters,
    })
    world.io.intersect()
    asins = [...new Set(world.port.lookups().flat())]
    poor = new Set()
    asins.forEach((asin, i) => {
      const rating = ratingOf(i)
      if (rating.r < FILTERS.minRating) poor.add(asin)
      world.port.receive(ready(asin, rating))
    })
    await flush()
  })

  test('has both kinds of card to tell apart', () => {
    const cards = mainBadges().map(b => inCarousel(b))
    expect(cards).toContain(true)
    expect(cards).toContain(false)
    expect(poor.size).toBeGreaterThan(5)
  })

  test('hides a poorly rated book in the list and dims it in a carousel', () => {
    const hidden = marked('hide')
    const dimmed = marked('dim')
    expect(hidden.length).toBeGreaterThan(0)
    expect(dimmed.length).toBeGreaterThan(0)
    for (const { asin, card } of hidden) {
      expect(poor.has(asin), asin).toBe(true)
      expect(inCarousel(card), asin).toBe(false)
    }
    for (const { asin, card } of dimmed) {
      expect(poor.has(asin), asin).toBe(true)
      expect(inCarousel(card), asin).toBe(true)
    }
  })

  test('marks every card of a poor book and no card of a good one', () => {
    for (const badge of mainBadges()) {
      const asin = (badge as HTMLElement).dataset.asin as string
      let marks = 0
      for (let el: Element | null = badge; el; el = el.parentElement) {
        if (el.hasAttribute('data-agx-filter')) marks++
      }
      expect(marks, asin).toBe(poor.has(asin) ? 1 : 0)
    }
  })

  test('counts the hidden cards for the panel, not the dimmed ones', () => {
    const hidden = marked('hide').length
    expect(hidden).toBeGreaterThan(0)
    expect(handleOf(world).filter.get().hidden).toBe(hidden)
  })

  test('peeking dims the hidden cards, keeps the count, and ends', () => {
    const hidden = marked('hide').length
    handleOf(world).setPeek(true)
    expect(marked('hide')).toHaveLength(0)
    expect(marked('dim').length).toBeGreaterThanOrEqual(hidden)
    expect(handleOf(world).filter.get()).toMatchObject({ hidden, peek: true })
    handleOf(world).setPeek(false)
    expect(marked('hide')).toHaveLength(hidden)
  })

  test('follows a change of the filters, in every tab', async () => {
    filters.change({ ...FILTERS, minRating: 1 })
    expect(document.querySelectorAll('[data-agx-filter]')).toHaveLength(0)
    expect(handleOf(world).filter.get().hidden).toBe(0)

    filters.change({
      ...FILTERS,
      modes: { ...FILTERS.modes, rating: 'dim' },
    })
    expect(marked('hide')).toHaveLength(0)
    const dimmed = marked('dim').length
    expect(dimmed).toBeGreaterThan(0)
    // Dimmed by choice is not hidden.
    expect(handleOf(world).filter.get()).toMatchObject({ hidden: 0, dimmed })
  })

  test('counts the dimmed carousel slides apart from the hidden cards', () => {
    expect(handleOf(world).filter.get()).toMatchObject({
      hidden: marked('hide').length,
      dimmed: marked('dim').length,
    })
  })

  test("the filters' master switch takes everything back", () => {
    filters.change({ ...FILTERS, enabled: false })
    expect(document.querySelectorAll('[data-agx-filter]')).toHaveLength(0)
  })

  test('turning the extension off takes the marks off the page', () => {
    world.content?.remove()
    expect(document.querySelectorAll('[data-agx-filter]')).toHaveLength(0)
  })
})

describe('highlighted labels on the com search fixture', () => {
  test('outline the cards and mark the pills, with or without filtering', async () => {
    loadFixture('com', 'search')
    const filters = new FakeFilters({
      ...FILTERS,
      minRating: 1,
      highlightLabels: ['science fiction'],
    })
    const world = startWorld({
      hostname: 'www.audible.com',
      pathname: '/search',
      filters,
    })
    world.io.intersect()
    const asins = [...new Set(world.port.lookups().flat())]
    const interesting = new Set<string>()
    asins.forEach((asin, i) => {
      const genres = i % 2 === 0 ? ['Science Fiction', 'Fantasy'] : ['Fantasy']
      if (i % 2 === 0) interesting.add(asin)
      world.port.receive(
        ready(asin, { r: 4.5, n: 900 }, { genres, year: 2000 })
      )
    })
    await flush()
    const outlined = () =>
      mainBadges().filter(badge => badge.closest('[data-agx-highlight]'))
    expect(outlined().length).toBeGreaterThan(0)
    for (const badge of outlined())
      expect(
        interesting.has((badge as HTMLElement).dataset.asin as string)
      ).toBe(true)
    expect(handleOf(world).filter.get().highlighted).toBe(outlined().length)
    const pills = document.querySelectorAll('.agx-label.agx-highlighted')
    expect(pills.length).toBeGreaterThan(0)
    for (const pill of pills) {
      expect(pill.textContent).toBe('Science Fiction')
      expect(pill.getAttribute('aria-label')).toBe(
        'Science Fiction, highlighted'
      )
    }
    // Nothing is filtered: highlighting never hides.
    expect(document.querySelectorAll('[data-agx-filter]')).toHaveLength(0)

    filters.change({
      ...FILTERS,
      enabled: false,
      highlightLabels: ['science fiction'],
    })
    expect(outlined().length).toBeGreaterThan(0)

    filters.change({ ...FILTERS, highlightLabels: [] })
    expect(document.querySelectorAll('[data-agx-highlight]')).toHaveLength(0)
    expect(document.querySelectorAll('.agx-highlighted')).toHaveLength(0)
    expect(handleOf(world).filter.get().highlighted).toBe(0)
  })

  test('turning the extension off takes the outlines off the page', async () => {
    loadFixture('com', 'search')
    const world = startWorld({
      hostname: 'www.audible.com',
      pathname: '/search',
      filters: new FakeFilters({ ...FILTERS, highlightLabels: ['Fantasy'] }),
    })
    world.io.intersect()
    for (const asin of new Set(world.port.lookups().flat()))
      world.port.receive(
        ready(asin, { r: 4.5, n: 900 }, { genres: ['Fantasy'], year: 2000 })
      )
    await flush()
    expect(
      document.querySelectorAll('[data-agx-highlight]').length
    ).toBeGreaterThan(0)
    world.content?.remove()
    expect(document.querySelectorAll('[data-agx-highlight]')).toHaveLength(0)
    expect(document.querySelectorAll('.agx-highlighted')).toHaveLength(0)
  })
})

describe('year filtering on the com search fixture', () => {
  test('waits for known years, hides list cards, dims carousel slides and follows edits', async () => {
    loadFixture('com', 'search')
    const filters = new FakeFilters({
      ...FILTERS,
      minYear: 2000,
      maxYear: 2020,
    })
    const world = startWorld({
      hostname: 'www.audible.com',
      pathname: '/search',
      filters,
    })
    world.io.intersect()
    const asins = [...new Set(world.port.lookups().flat())]
    for (const asin of asins)
      world.port.receive(ready(asin, { r: 4.5, n: 900 }))
    await flush()
    expect(document.querySelectorAll('[data-agx-filter]')).toHaveLength(0)

    const outside = new Set<string>()
    const years = [undefined, 0, 1999, 2000, 2020, 2021]
    asins.forEach((asin, i) => {
      const year = years[i % years.length]
      if (year === undefined) return
      if (year !== 0 && (year < 2000 || year > 2020)) outside.add(asin)
      world.port.receive(ready(asin, { r: 4.5, n: 900 }, { genres: [], year }))
    })
    await flush()
    const hidden = marked('hide').length
    expect(hidden).toBeGreaterThan(0)
    expect(marked('dim').length).toBeGreaterThan(0)
    expect(handleOf(world).filter.get().hidden).toBe(hidden)
    for (const badge of mainBadges()) {
      const asin = (badge as HTMLElement).dataset.asin as string
      const card = badge.closest('[data-agx-filter]')
      expect(!!card, asin).toBe(outside.has(asin))
      if (card)
        expect(card.getAttribute('data-agx-filter')).toBe(
          inCarousel(card) ? 'dim' : 'hide'
        )
    }
    handleOf(world).setPeek(true)
    expect(marked('hide')).toHaveLength(0)
    expect(handleOf(world).filter.get().hidden).toBe(hidden)
    filters.change({ ...FILTERS, minYear: null, maxYear: null })
    expect(document.querySelectorAll('[data-agx-filter]')).toHaveLength(0)
    expect(handleOf(world).filter.get().hidden).toBe(0)
  })
})

describe('a book that has not arrived', () => {
  test('is never hidden, whatever the filters say', async () => {
    loadFixture('com', 'search')
    const filters = new FakeFilters({
      ...FILTERS,
      minRating: 5,
      notFound: 'hide',
    })
    const world = startWorld({
      hostname: 'www.audible.com',
      pathname: '/search',
      filters,
    })
    world.io.intersect()
    await flush()
    expect(document.querySelectorAll('[data-agx-filter]')).toHaveLength(0)
  })

  test('a book not on Goodreads follows the policy', async () => {
    loadFixture('com', 'search')
    const filters = new FakeFilters({ ...FILTERS, notFound: 'hide' })
    const world = startWorld({
      hostname: 'www.audible.com',
      pathname: '/search',
      filters,
    })
    world.io.intersect()
    const [first] = world.port.lookups().flat()
    world.port.receive(notFound(first as string))
    await flush()
    const marks = [...document.querySelectorAll('[data-agx-filter]')]
    expect(marks.length).toBeGreaterThan(0)
    for (const card of marks) {
      expect(card.getAttribute('data-agx-filter')).toBe(
        inCarousel(card) ? 'dim' : 'hide'
      )
      // Only that book's cards: each marked card holds a badge for the book that was not found.
      expect(
        (card.querySelector('.agx-badge') as HTMLElement | null)?.dataset.asin
      ).toBe(first)
    }
  })

  test('stays unfiltered while the settings are still being read', async () => {
    loadFixture('com', 'search')
    const filters = new FakeFilters(FILTERS)
    filters.read = () => new Promise(() => {})
    const world = startWorld({
      hostname: 'www.audible.com',
      pathname: '/search',
      filters,
    })
    world.io.intersect()
    for (const asin of world.port.lookups().flat())
      world.port.receive(ready(asin, { r: 1, n: 1 }))
    await flush()
    expect(document.querySelectorAll('[data-agx-filter]')).toHaveLength(0)
    expect(NO_FILTERS.enabled).toBe(false)
  })
})

/** The panel's handle, as the panel script finds it. */

function handleOf(_world: World) {
  const handle = currentHandle()
  if (!handle) throw new Error('the content script published no handle')
  return handle
}

describe('price filtering on cards', () => {
  test('requests fresh prices only once a limit is active, and keeps them across rating/details updates', async () => {
    loadBody(
      '<article><h3><a href="/pd/Book/B000000001">Book</a></h3></article>'
    )
    const filters = new FakeFilters(FILTERS)
    const world = startWorld({ hostname: 'www.audible.com', filters })
    world.io.intersect()
    world.port.receive(ready('B000000001', { r: 4.5, n: 100 }))
    await flush()
    expect(world.port.sent.some(m => m._tag === 'PriceLookup')).toBe(false)
    filters.change({ ...FILTERS, maxPrice: { US: 10 } })
    expect(world.port.sent.at(-1)).toEqual({
      _tag: 'PriceLookup',
      asins: ['B000000001'],
    })
    expect(marked('hide')).toHaveLength(0)
    world.port.receive({
      _tag: 'PriceUpdate',
      asin: 'B000000001',
      price: { amount: 15, currency: 'USD' },
    })
    expect(marked('hide')).toHaveLength(1)
    world.port.receive(
      ready(
        'B000000001',
        { r: 4.5, n: 100 },
        { genres: [], year: 2000, desc: '' }
      )
    )
    expect(marked('hide')).toHaveLength(1)
    filters.change({ ...FILTERS, maxPrice: { US: 15 } })
    expect(marked('hide')).toHaveLength(0)
    expect(world.port.sent.filter(m => m._tag === 'PriceLookup')).toHaveLength(
      1
    )
    world.content?.remove()
  })
  test('a price that arrives before the rating cannot hide a loading card', async () => {
    loadBody(
      '<article><h3><a href="/pd/Book/B000000001">Book</a></h3></article>'
    )
    const filters = new FakeFilters({ ...FILTERS, maxPrice: { US: 0 } })
    const world = startWorld({ hostname: 'www.audible.com', filters })
    await flush()
    world.io.intersect()
    world.port.receive({
      _tag: 'PriceUpdate',
      asin: 'B000000001',
      price: { amount: 1, currency: 'USD' },
    })
    expect(marked('hide')).toHaveLength(0)
    world.port.receive(ready('B000000001', { r: 4.5, n: 100 }))
    expect(marked('hide')).toHaveLength(1)
    world.content?.remove()
  })
})
