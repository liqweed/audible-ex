/**
 * Finding cards and their title, ported from the userscript (`asinsIn`, `cardFor`, `findTitleEl`,
 * `placeAfterTitle`, v2.4.0). A card is the largest ancestor whose links all point to one ASIN, plus
 * the known list rows of the library. Plain DOM functions: they take the elements to look at and
 * touch nothing else, so tests run them on saved Audible pages.
 *
 * One difference from the userscript: it chose the title element by the catalogue title, which the
 * port does not carry. `titleOf` reads a title from the card itself instead and `findTitleEl` looks
 * for the element that shows it.
 */
import { asinFromHref } from '../core/asin'
import { norm, shortTitle } from '../core/text'

/** The rows of the library and of list pages; their ASINs are the user's own books (pinned). */
export const KNOWN_ROW = 'li.productListItem, [id^="adbl-library-content-row-"]'
/** Navigation, header and footer links are not books on a page. */
export const NAVIGATION = 'header, nav, footer, [role="navigation"]'
/** The hover popover Audible renders inside each card; it gets its own badge. */
export const POPOVER = '.bc-popover'
/** The element that holds the hover overview's shadow root (overview.ts). */
export const OVERVIEW_HOST = 'agx-overview-host'
/** The element that holds the label popover's shadow root (labels.ts). */
export const LABEL_HOST = 'agx-label-host'
/** The element that holds the floating panel's shadow root (the panel content script). */
export const PANEL_HOST = 'agx-panel'
/** What the extension adds to the page, so its own changes are never scanned. */
export const OUR_NODES = `.agx-wrap, .agx-li, .${OVERVIEW_HOST}, ${LABEL_HOST}, ${PANEL_HOST}`

/**
 * Audible's carousels: the components that lay books out in a sliding row. Taken from the saved
 * pages: the home, category and search pages wrap their recommendation rows in `adbl-product-carousel`
 * (the US home page's featured row in `adbl-product-featured-carousel`), and a carousel that has not
 * loaded yet is a `div.adbl-carousel`. Search results, deals and the library's own rows are in none.
 */
export const CAROUSEL =
  'adbl-product-carousel, adbl-product-featured-carousel, .adbl-carousel, [aria-roledescription="carousel" i]'

/** Is this card a slide of a carousel? Removing one would break the carousel's layout. */
export const isInCarousel = (card: Element): boolean =>
  card.closest(CAROUSEL) !== null

const PRODUCT_LINKS = 'a[href*="/pd/"]'
const HEADINGS = 'h1,h2,h3,h4'
/** How far up from a link the card search climbs before giving up (the userscript's limit). */
const MAX_LEVELS = 12

export const asinOf = (link: Element): string | undefined =>
  asinFromHref(link.getAttribute('href'))

/** ASINs linked inside an element, memoised for the length of one scan when a memo is given. */
export type AsinMemo = Map<Element, Set<string>>

export function asinsIn(el: Element, memo?: AsinMemo): Set<string> {
  const hit = memo?.get(el)
  if (hit) return hit
  const asins = new Set<string>()
  for (const link of el.querySelectorAll(PRODUCT_LINKS)) {
    const asin = asinOf(link)
    if (asin) asins.add(asin)
  }
  memo?.set(el, asins)
  return asins
}

export const isKnownRow = (card: Element): boolean => card.matches(KNOWN_ROW)

/** The card of a link: its known row, else the largest ancestor that links only to `asin`. */
export function cardFor(
  link: Element,
  asin: string,
  memo?: AsinMemo
): Element | null {
  const known = link.closest(KNOWN_ROW)
  if (known) return known
  const body = link.ownerDocument.body
  let el: Element = link
  let best: Element | null = link.parentElement
  for (
    let i = 0;
    i < MAX_LEVELS && el.parentElement && el.parentElement !== body;
    i++
  ) {
    el = el.parentElement
    const asins = asinsIn(el, memo)
    if (asins.size > 1 || (asins.size === 1 && !asins.has(asin))) break
    best = el
  }
  return best
}

const squash = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()

/** Text links to this ASIN in `scope`; popover content counts only when `inPopover`. */
function textLinks(scope: Element, asin: string, inPopover: boolean) {
  return [...scope.querySelectorAll(`a[href*="${asin}"]`)].filter(
    a => (inPopover || !a.closest(POPOVER)) && squash(a.textContent) !== ''
  )
}

/**
 * The title as the card shows it: the text of a link to the ASIN inside a heading, else the first
 * text link to it (popovers left out). Cards that link the book from its cover only have no such
 * link; their cover's `alt` text ("Title Audiobook By Author cover art") stands in. `''` when the
 * card says nothing about its title.
 */
export function titleOf(card: Element, asin: string): string {
  const links = textLinks(card, asin, false)
  const link = links.find(a => a.closest(HEADINGS)) ?? links[0]
  if (link) return squash(link.textContent)
  for (const img of card.querySelectorAll('img[alt]')) {
    if (img.closest(POPOVER)) continue
    const title = squash(img.getAttribute('alt'))
      .replace(/\s+cover art$/i, '')
      .replace(/\s+Audiobook By\s.*$/i, '')
    if (title) return title
  }
  return ''
}

/** Amazon's image host path; a card's cover is the first image served from it. */
const COVER_SRC = /\/images\/I\//

/**
 * The card's cover image: the first image outside a popover whose address is an Amazon catalogue
 * image (in the saved pages every card has exactly one), else its first image. Undefined for a card
 * without images.
 */
export function coverOf(card: Element): HTMLImageElement | undefined {
  let first: HTMLImageElement | undefined
  for (const img of card.querySelectorAll('img')) {
    if (img.closest(POPOVER)) continue
    first ??= img
    const src = img.getAttribute('src') ?? img.getAttribute('data-lazy') ?? ''
    if (COVER_SRC.test(src)) return img
  }
  return first
}

/** Does this element's text look like the title? (page text may add or drop a subtitle) */
function looksLikeTitle(el: Element, title: string): boolean {
  const text = norm(el.textContent)
  if (!text || text.length > 300) return false
  const short = shortTitle(title)
  return (
    text === norm(title) ||
    shortTitle(el.textContent ?? '') === short ||
    (short.length >= 4 && text.startsWith(short))
  )
}

/**
 * The element that holds the title inside `scope`. `inPopover` decides whether popover content is
 * allowed. First a text link to the book that reads like `title` (else one in a heading), then any
 * heading, span or paragraph showing `title` (the home page's daily deal).
 */
export function findTitleEl(
  scope: Element,
  asin: string,
  title: string,
  inPopover: boolean
): Element | null {
  const links = textLinks(scope, asin, inPopover)
  // As the userscript: a link that reads like the title, else one in a heading. Any other text
  // link to the ASIN is not the title (the Download menu's "Full" links to `?asin=…`).
  const link =
    links.find(a => looksLikeTitle(a, title)) ??
    links.find(a => a.closest(HEADINGS))
  if (link) return link
  if (!title) return null
  return (
    [...scope.querySelectorAll('h1,h2,h3,h4,span,p')].find(
      e =>
        (inPopover || !e.closest(POPOVER)) &&
        e.children.length <= 2 &&
        looksLikeTitle(e, title)
    ) ?? null
  )
}

/**
 * Puts `wrap` on the line after the title; false when the card has no title element. In a list the
 * wrap gets a list item of its own after the title's, so the badge lines up with the other rows;
 * elsewhere it goes right after the title's heading (or the title itself).
 */
export function placeAfterTitle(
  scope: Element,
  wrap: Element,
  asin: string,
  title: string,
  inPopover: boolean
): boolean {
  const el = findTitleEl(scope, asin, title, inPopover)
  if (!el) return false
  const li = el.closest('li')
  if (li && scope.contains(li) && li !== scope) {
    const newLi = scope.ownerDocument.createElement('li')
    newLi.className = `${li.className.replace(/\bagx-\S+/g, '')} agx-li`
    newLi.appendChild(wrap)
    li.insertAdjacentElement('afterend', newLi)
  } else {
    ;(el.closest(HEADINGS) ?? el).insertAdjacentElement('afterend', wrap)
  }
  return true
}
