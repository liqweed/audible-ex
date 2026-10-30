import { beforeEach, describe, expect, test } from 'bun:test'
import {
  decorate,
  fmtN,
  injectStyles,
  renderBadge,
  visibleGenres,
} from './badges'
import type { BookView } from './books'

const makeBadge = (q = 'Project Hail Mary') => {
  document.body.innerHTML =
    '<span class="agx-wrap"><a class="agx-badge agx-wait">GR …</a></span>'
  const badge = document.querySelector('a') as HTMLAnchorElement
  badge.dataset.q = q
  return badge
}
const never = { onRetry: () => {} }
const rating = (r: number, n: number, loose = false) => ({
  r,
  n,
  loose,
  url: 'https://www.goodreads.com/book/show/1',
})
const ready = (r: number, n: number, loose = false): BookView => ({
  status: 'ready',
  rating: rating(r, n, loose),
})

describe('fmtN', () => {
  test.each([
    [0, '0'],
    [999, '999'],
    [1000, '1k'],
    [12_345, '12k'],
    [999_499, '999k'],
    [999_500, '1.0M'],
    [1_250_000, '1.3M'],
  ])('%d is %s', (n, text) => {
    expect(fmtN(n)).toBe(text)
  })
})

describe('renderBadge', () => {
  test('shows the rating and the rounded count, linked to Goodreads', () => {
    const badge = makeBadge()
    renderBadge(badge, ready(4.213, 12_345), never)
    expect(badge.textContent).toBe('★ 4.21 (12k)')
    expect(badge.getAttribute('href')).toBe(
      'https://www.goodreads.com/book/show/1'
    )
    expect(badge.title).toBe('Goodreads: 4.21 from 12,345 ratings')
    expect(badge.querySelector('.agx-n')?.textContent).toBe('(12k)')
  })

  test.each([
    [4.2, 'agx-hi'],
    [4.7, 'agx-hi'],
    [3.7, undefined],
    [4.19, undefined],
    [3.69, 'agx-lo'],
    [1.5, 'agx-lo'],
  ])('rating %d is coloured %s', (r, cls) => {
    const badge = makeBadge()
    renderBadge(badge, ready(r, 100), never)
    expect(badge.classList.contains('agx-hi')).toBe(cls === 'agx-hi')
    expect(badge.classList.contains('agx-lo')).toBe(cls === 'agx-lo')
  })

  test('a zero rating is not coloured low', () => {
    const badge = makeBadge()
    renderBadge(badge, ready(0, 0), never)
    expect(badge.classList.contains('agx-lo')).toBe(false)
    expect(badge.textContent).toBe('★ 0.00 (0)')
  })

  test('an approximate match is marked with ?', () => {
    const badge = makeBadge()
    renderBadge(badge, ready(4.1, 900, true), never)
    expect(badge.textContent).toBe('★ 4.10? (900)')
    expect(badge.title).toContain('approximate')
  })

  test('not found links to a Goodreads search for the title', () => {
    const badge = makeBadge('  Dune: Book One & more ')
    renderBadge(badge, { status: 'notFound' }, never)
    expect(badge.textContent).toBe('GR: not found')
    expect(badge.classList.contains('agx-none')).toBe(true)
    expect(badge.getAttribute('href')).toBe(
      `https://www.goodreads.com/search?q=${encodeURIComponent('Dune: Book One & more')}`
    )
  })

  test('failed offers a retry and a click calls it without following the link', () => {
    const badge = makeBadge()
    let retries = 0
    renderBadge(
      badge,
      { status: 'failed', error: { reason: 'httpError', message: 'HTTP 503' } },
      { onRetry: () => retries++ }
    )
    expect(badge.textContent).toBe('GR: retry')
    expect(badge.title).toContain('HTTP 503')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    badge.dispatchEvent(click)
    expect(retries).toBe(1)
    expect(click.defaultPrevented).toBe(true)
  })

  test('drawing a new state removes the retry handler and the old link', () => {
    const badge = makeBadge()
    let retries = 0
    renderBadge(
      badge,
      { status: 'failed', error: { reason: 'httpError', message: 'x' } },
      { onRetry: () => retries++ }
    )
    renderBadge(badge, { status: 'queued' }, never)
    expect(badge.textContent).toBe('GR …')
    expect(badge.classList.contains('agx-wait')).toBe(true)
    expect(badge.hasAttribute('href')).toBe(false)
    badge.click()
    expect(retries).toBe(0)
  })

  test.each(['queued', 'loading'] as const)(
    '%s keeps the placeholder',
    status => {
      const badge = makeBadge()
      renderBadge(badge, { status }, never)
      expect(badge.textContent).toBe('GR …')
      expect(badge.className).toBe('agx-badge agx-wait')
    }
  )
})

describe('decorate', () => {
  const details = (year: number, genres: string[]) => ({
    year,
    genres,
    desc: '',
  })
  let badge: HTMLAnchorElement
  beforeEach(() => {
    badge = makeBadge()
  })
  const wrap = () => badge.parentElement as Element
  const labels = () =>
    [...wrap().querySelectorAll('.agx-label')].map(l => l.textContent)

  test('adds the year after the badge and up to 3 labels', () => {
    decorate(
      badge,
      details(2021, ['Science Fiction', 'Fiction', 'Space', 'Adventure'])
    )
    expect(badge.nextElementSibling?.className).toBe('agx-year')
    expect(badge.nextElementSibling?.textContent).toBe('2021')
    expect(labels()).toEqual(['Science Fiction', 'Fiction', 'Space'])
  })

  test('skips the genres that say nothing, before counting three', () => {
    decorate(
      badge,
      details(2000, [
        'Audiobook',
        'Adult',
        'Unfinished',
        'Kindle Unlimited',
        'Books About Books',
        'Fantasy',
        'Audiobooks',
        'Romance',
        'Humor',
        'Horror',
      ])
    )
    expect(labels()).toEqual(['Fantasy', 'Romance', 'Humor'])
  })

  test('year 0 means unknown and shows no year; a negative year is shown', () => {
    decorate(badge, details(0, ['Fantasy']))
    expect(wrap().querySelector('.agx-year')).toBeNull()
    decorate(badge, details(-750, ['Poetry']))
    expect(wrap().querySelector('.agx-year')?.textContent).toBe('-750')
  })

  test('a second call replaces the first, never adds to it', () => {
    decorate(badge, details(2021, ['Fantasy', 'Romance']))
    decorate(badge, details(2021, ['Fantasy', 'Romance']))
    expect(wrap().querySelectorAll('.agx-year')).toHaveLength(1)
    expect(labels()).toEqual(['Fantasy', 'Romance'])
  })

  test('no details removes year and labels', () => {
    decorate(badge, details(2021, ['Fantasy']))
    decorate(badge, undefined)
    expect(wrap().querySelector('.agx-year, .agx-label')).toBeNull()
  })

  test('does nothing for a badge outside a wrap', () => {
    const lone = document.createElement('a')
    expect(() => decorate(lone, details(2000, ['Fantasy']))).not.toThrow()
  })
})

test('visibleGenres is case-insensitive about the skipped ones', () => {
  expect(visibleGenres(['AUDIOBOOK', 'Fantasy'])).toEqual(['Fantasy'])
  expect(visibleGenres(undefined)).toEqual([])
})

describe('injectStyles', () => {
  test('adds one style element, however often it is called', () => {
    document.documentElement.innerHTML = '<head></head><body></body>'
    injectStyles(document, '.agx-badge{color:red}')
    injectStyles(document, '.agx-badge{color:red}')
    injectStyles(document, '.other{}')
    const styles = document.querySelectorAll('style#agx-style')
    expect(styles).toHaveLength(1)
    expect(styles[0]?.textContent).toBe('.agx-badge{color:red}')
    expect(document.querySelectorAll('style')).toHaveLength(1)
  })
})
