import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadBody } from '../../test/content-harness'
import type { BookView } from './books'
import { OVERVIEW_HOST } from './cards'
import {
  createOverview,
  OVERVIEW_GENRES,
  type Overview,
  placeOverview,
  ratingLine,
} from './overview'

const VIEWPORT = { width: 1000, height: 700 }
const anchor = (top: number, left: number) => ({
  top,
  bottom: top + 20,
  left,
  width: 80,
  height: 20,
})

describe('placeOverview', () => {
  const box = { width: 300, height: 200 }

  test('goes below the badge, 6 px away, at its left edge', () => {
    expect(placeOverview(anchor(100, 50), box, VIEWPORT)).toEqual({
      top: 126,
      left: 50,
    })
  })

  test('goes above the badge when it would run off the bottom edge', () => {
    expect(placeOverview(anchor(600, 50), box, VIEWPORT)).toEqual({
      top: 394,
      left: 50,
    })
  })

  test('stays 8 px inside the top edge when neither side has room', () => {
    const tall = { width: 300, height: 690 }
    expect(placeOverview(anchor(300, 50), tall, VIEWPORT).top).toBe(8)
  })

  test('is pulled back inside the right and left edges', () => {
    expect(placeOverview(anchor(100, 900), box, VIEWPORT).left).toBe(692)
    expect(placeOverview(anchor(100, -40), box, VIEWPORT).left).toBe(8)
  })
})

const view = (
  details: Partial<NonNullable<BookView['details']>> = {},
  rating: Partial<NonNullable<BookView['rating']>> = {}
): BookView => ({
  status: 'ready',
  rating: {
    r: 4.213,
    n: 12_345,
    url: 'https://www.goodreads.com/book/show/1',
    loose: false,
    ...rating,
  },
  details: { genres: ['Fantasy'], year: 2019, desc: 'A story.', ...details },
})

describe('ratingLine', () => {
  test('gives rating, count and first-published year', () => {
    const v = view()
    expect(ratingLine(v as never)).toBe(
      `★ 4.21 · ${(12_345).toLocaleString()} ratings · first published 2019`
    )
  })

  test('leaves the year out when Goodreads has none, and keeps a negative one', () => {
    expect(ratingLine(view({ year: 0 }) as never)).not.toContain('published')
    expect(ratingLine(view({ year: -750 }) as never)).toContain(
      'first published -750'
    )
  })

  test('says so when the match is approximate', () => {
    expect(ratingLine(view({}, { loose: true }) as never)).toEndWith(
      ' (approximate match)'
    )
  })
})

describe('the overview on the page', () => {
  let overview: Overview
  let books: Map<string, BookView>

  const badge = (asin = 'B000000001') =>
    document.querySelector(`[data-asin="${asin}"]`) as HTMLElement
  const tip = () => overview.root?.querySelector('.tip') ?? null
  const fire = (type: string, target: Element, relatedTarget?: Element) =>
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        relatedTarget: relatedTarget ?? null,
      })
    )

  beforeEach(() => {
    loadBody(`
      <span class="agx-wrap"><a class="agx-badge" data-asin="B000000001">★ <span class="agx-n">(12k)</span></a></span>
      <span class="agx-wrap"><a class="agx-badge" data-asin="B000000002">GR …</a></span>
      <p id="elsewhere">text</p>`)
    books = new Map([['B000000001', view()]])
    overview = createOverview({
      doc: document,
      css: '.tip{color:red}',
      viewOf: el => books.get((el as HTMLElement).dataset.asin ?? ''),
    })
  })
  afterEach(() => overview.stop())

  test('shows the rating line, the genres and the overview when the pointer arrives', () => {
    books.set(
      'B000000001',
      view({
        genres: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
        desc: 'Long text',
      })
    )
    fire('mouseover', badge())
    const box = tip()
    expect(box?.querySelector('b')?.textContent).toStartWith('★ 4.21 · ')
    expect(box?.querySelector('.meta')?.textContent).toBe(
      'A · B · C · D · E · F'
    )
    expect(OVERVIEW_GENRES).toBe(6)
    expect(box?.textContent).toContain('Long text')
    expect(box?.querySelector('.fade')).not.toBeNull()
  })

  test('draws inside a shadow root, with its stylesheet there and none on the page', () => {
    fire('mouseover', badge())
    const host = document.querySelector(`.${OVERVIEW_HOST}`)
    expect(host?.shadowRoot).toBe(overview.root as ShadowRoot)
    expect(overview.root?.querySelector('style')?.textContent).toBe(
      '.tip{color:red}'
    )
    // Nothing of the overview is in the page's own tree.
    expect(document.querySelector('.tip')).toBeNull()
    expect(document.querySelectorAll('style')).toHaveLength(0)
  })

  test('positions the box next to the badge', () => {
    const el = badge()
    el.getBoundingClientRect = () =>
      ({ top: 100, bottom: 120, left: 50, width: 80, height: 20 }) as DOMRect
    fire('mouseover', el)
    const style = (tip() as HTMLElement).style
    expect(style.top).toBe('126px')
    expect(style.left).toBe('50px')
  })

  test('shows the text as text, never as markup', () => {
    books.set('B000000001', view({ desc: '<img src=x onerror=alert(1)>' }))
    fire('mouseover', badge())
    expect(tip()?.querySelector('img')).toBeNull()
    expect(tip()?.textContent).toContain('<img src=x')
  })

  test('hides when the pointer leaves the badge', () => {
    fire('mouseover', badge())
    expect(tip()).not.toBeNull()
    fire('mouseout', badge(), document.getElementById('elsewhere') as Element)
    expect(tip()).toBeNull()
  })

  test('stays while the pointer moves between parts of one badge', () => {
    const el = badge()
    const count = el.querySelector('.agx-n') as Element
    fire('mouseover', el)
    const first = tip()
    fire('mouseout', el, count)
    fire('mouseover', count)
    expect(tip()).toBe(first)
  })

  test('hides on scroll, in the page or in a container', () => {
    fire('mouseover', badge())
    document.dispatchEvent(new Event('scroll'))
    expect(tip()).toBeNull()
    fire('mouseover', badge())
    // A scroll event in an inner container does not bubble; the capture listener still hears it.
    document
      .getElementById('elsewhere')
      ?.dispatchEvent(new Event('scroll', { bubbles: false }))
    expect(tip()).toBeNull()
  })

  test('shows nothing for a book that has no overview yet', () => {
    fire('mouseover', badge('B000000002'))
    expect(tip()).toBeNull()
    books.set('B000000002', view({ desc: '' }))
    fire('mouseover', badge('B000000002'))
    expect(tip()).toBeNull()
  })

  test('reads the book at hover time, so a year that came later shows', () => {
    books.set('B000000001', view({ year: 0 }))
    fire('mouseover', badge())
    expect(tip()?.querySelector('b')?.textContent).not.toContain('published')
    fire('mouseout', badge(), document.getElementById('elsewhere') as Element)
    books.set('B000000001', view({ year: 1999 }))
    fire('mouseover', badge())
    expect(tip()?.querySelector('b')?.textContent).toContain(
      'first published 1999'
    )
  })

  test('shows one box at a time', () => {
    books.set('B000000002', view({ desc: 'Second' }))
    fire('mouseover', badge())
    fire('mouseover', badge('B000000002'))
    expect(overview.root?.querySelectorAll('.tip')).toHaveLength(1)
    expect(tip()?.textContent).toContain('Second')
  })

  test('hides when its badge was removed from the page while hovered', () => {
    fire('mouseover', badge())
    badge().closest('.agx-wrap')?.remove()
    fire('mouseover', document.getElementById('elsewhere') as Element)
    expect(tip()).toBeNull()
  })

  test('ignores the pointer over anything that is not a badge', () => {
    fire('mouseover', document.getElementById('elsewhere') as Element)
    expect(overview.root).toBeUndefined()
  })

  test('stop removes the host and stops listening', () => {
    fire('mouseover', badge())
    overview.stop()
    expect(document.querySelector(`.${OVERVIEW_HOST}`)).toBeNull()
    fire('mouseover', badge())
    expect(document.querySelector(`.${OVERVIEW_HOST}`)).toBeNull()
  })
})
