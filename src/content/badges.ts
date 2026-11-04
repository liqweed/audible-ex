/**
 * Badges: plain DOM, no React (ARCHITECTURE.md §6). Building them on a card, drawing the `BookView`
 * on them (`★ 4.21 (12k)`, `GR: not found`, `GR: retry`), and the year and labels after the rating.
 * Ported from the userscript's `newBadge`, `makeWrap`, `render`, `decorate` and `visibleGenres`.
 * The hover overview (`showTip`) is in overview.ts; a badge only carries its ASIN for it.
 */
import { DEFAULT_DISPLAY, type DisplaySettings } from '../core/display'
import { type BookView, hasOverview } from './books'
import { POPOVER, placeAfterTitle } from './cards'

/** Genre labels shown after the badge, and the Goodreads shelves that say nothing about a book. */
export const MAX_LABELS: number = DEFAULT_DISPLAY.labels
export const SKIP_GENRES: ReadonlySet<string> = new Set([
  'audiobook',
  'audiobooks',
  'adult',
  'books about books',
  'unfinished',
  'kindle unlimited',
])

export const BADGE = 'agx-badge'
/** A genre label after the badge; hovering it offers to filter on it (labels.ts). */
export const LABEL = 'agx-label'
const STYLE_ID = 'agx-style'

/** The labels to show: the first genres that are not in `SKIP_GENRES`. */
export const visibleGenres = (
  genres: readonly string[] | undefined,
  limit = MAX_LABELS
) =>
  (genres ?? []).filter(g => !SKIP_GENRES.has(g.toLowerCase())).slice(0, limit)

/** `950`, `12k`, `1.3M`: rating counts the way the badge writes them. */
export function fmtN(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) {
    const k = Math.round(n / 1e3)
    // 999 500 rounds to 1000k; that is 1.0M.
    return k >= 1000 ? `${(n / 1e6).toFixed(1)}M` : `${k}k`
  }
  return String(n)
}

/** Adds the stylesheet to the page once; a second call, or a second script, finds it and stops. */
export function injectStyles(doc: Document, css: string): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  ;(doc.head ?? doc.documentElement).appendChild(style)
}

function newBadge(
  doc: Document,
  asin: string,
  title: string
): HTMLAnchorElement {
  const badge = doc.createElement('a')
  badge.target = '_blank'
  badge.rel = 'noopener'
  badge.className = `${BADGE} agx-wait`
  badge.textContent = 'GR …'
  // The title is what a "not found" badge searches Goodreads for.
  badge.dataset.q = title
  // The overview reads the book from the store by this ASIN when the pointer arrives.
  badge.dataset.asin = asin
  // Cards are often links or open a popover themselves; the badge is its own target.
  badge.addEventListener('click', ev => ev.stopPropagation())
  return badge
}

function makeWrap(doc: Document, badge: Element): HTMLSpanElement {
  const wrap = doc.createElement('span')
  wrap.className = 'agx-wrap'
  wrap.appendChild(badge)
  return wrap
}

/** What a badge needs from its card to react to a click on `GR: retry`. */
export interface BadgeContext {
  onRetry(): void
  display?: DisplaySettings
}

/** Draws one badge for a book's current state, replacing whatever it showed. */
export function renderBadge(
  badge: HTMLAnchorElement,
  view: BookView,
  { onRetry, display = DEFAULT_DISPLAY }: BadgeContext
): void {
  badge.className = BADGE
  badge.onclick = null
  const { rating } = view
  if (view.status === 'notFound') {
    badge.classList.add('agx-none')
    badge.textContent = 'GR: not found'
    badge.href = `https://www.goodreads.com/search?q=${encodeURIComponent((badge.dataset.q ?? '').trim())}`
    badge.title = 'No confident Goodreads match — click to search'
  } else if (view.status === 'failed') {
    badge.classList.add('agx-none')
    badge.textContent = 'GR: retry'
    badge.title = `Lookup failed (${view.error?.message ?? 'unknown error'}). Click to retry.`
    badge.href = '#'
    badge.onclick = ev => {
      ev.preventDefault()
      onRetry()
    }
  } else if (view.status === 'ready' && rating) {
    if (rating.r >= 4.2) badge.classList.add('agx-hi')
    else if (rating.r && rating.r < 3.7) badge.classList.add('agx-lo')
    badge.href = rating.url
    badge.title = `Goodreads: ${rating.r.toFixed(2)} from ${rating.n.toLocaleString()} ratings${rating.loose ? ' (approximate title match)' : ''}`
    const count = badge.ownerDocument.createElement('span')
    count.className = 'agx-n'
    count.textContent = `(${fmtN(rating.n)})`
    badge.replaceChildren(
      `★ ${rating.r.toFixed(2)}${rating.loose ? '?' : ''} `,
      count
    )
  } else {
    // queued, loading
    badge.classList.add('agx-wait')
    badge.textContent = 'GR …'
    badge.removeAttribute('href')
    badge.removeAttribute('title')
  }
  // The overview replaces the plain tooltip, so the two do not show together.
  if (display.overview && hasOverview(view)) badge.removeAttribute('title')
  decorate(badge, view.details, display)
}

/**
 * Year and labels after the badge. They are rebuilt every time, so a book that reports its details
 * twice, or loses them on a retry, never shows a year or a label twice.
 */
export function decorate(
  badge: Element,
  details: BookView['details'] | undefined,
  display: DisplaySettings = DEFAULT_DISPLAY
): void {
  const wrap = badge.parentElement
  if (!wrap) return
  for (const old of wrap.querySelectorAll(`.${LABEL}, .agx-year`)) old.remove()
  // 0 is "Goodreads has no date"; a negative year is a real one (The Iliad).
  if (display.year && details?.year) {
    const year = badge.ownerDocument.createElement('span')
    year.className = 'agx-year'
    year.textContent = String(details.year)
    year.title = 'First published (Goodreads)'
    badge.insertAdjacentElement('afterend', year)
  }
  for (const genre of visibleGenres(details?.genres, display.labels)) {
    const label = badge.ownerDocument.createElement('span')
    label.className = LABEL
    label.textContent = genre
    // Focusable, so the label's popover can be opened from the keyboard too.
    label.tabIndex = 0
    label.setAttribute('aria-haspopup', 'dialog')
    wrap.appendChild(label)
  }
}

/**
 * Adds the waiting badge to a card: the main one after the title in the visible card, never inside
 * the hidden hover popover, and an extra one after the title in each popover that belongs to the
 * card. A card with no title element takes the main badge before its popover, else at its end.
 */
export function attachBadges(card: Element, asin: string, title: string): void {
  const doc = card.ownerDocument
  const mainWrap = makeWrap(doc, newBadge(doc, asin, title))
  if (!placeAfterTitle(card, mainWrap, asin, title, false)) {
    const popover = card.querySelector(POPOVER)
    if (popover) popover.insertAdjacentElement('beforebegin', mainWrap)
    else card.appendChild(mainWrap)
  }
  for (const popover of card.querySelectorAll(POPOVER)) {
    placeAfterTitle(
      popover,
      makeWrap(doc, newBadge(doc, asin, title)),
      asin,
      title,
      true
    )
  }
}

export const hasBadge = (card: Element): boolean =>
  card.querySelector(`.${BADGE}`) !== null

/** Takes this card's badges, with the list items made for them, off the page. */
export function removeBadges(card: Element): void {
  for (const wrap of card.querySelectorAll('.agx-wrap'))
    (wrap.closest('.agx-li') ?? wrap).remove()
}

/**
 * Takes everything the badges added off the page: every badge, the list items made for them, and
 * the stylesheet (so starting again injects it again). What the user turned off leaves no trace.
 */
export function removeAllBadges(doc: Document): void {
  for (const wrap of doc.querySelectorAll('.agx-wrap'))
    (wrap.closest('.agx-li') ?? wrap).remove()
  doc.getElementById(STYLE_ID)?.remove()
}

/** Draws the book on every badge of the card. */
export function renderCard(
  card: Element,
  view: BookView,
  context: BadgeContext
): void {
  for (const badge of card.querySelectorAll<HTMLAnchorElement>(`.${BADGE}`))
    renderBadge(badge, view, context)
}
