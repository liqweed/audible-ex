/**
 * The userscript's card and badge placement (`cardFor`, `findTitleEl`, `placeAfterTitle`, v2.4.0,
 * reference/audible-goodreads-ratings.user.js), copied as faithfully as TypeScript allows, to check
 * that the extension puts each badge where the userscript did. Differences from the original: the
 * catalogue title is a parameter (the port does not carry it), nothing is awaited, and the nodes
 * it adds keep the userscript's own `agr-` names so they are never mistaken for the extension's.
 */
import { asinFromHref } from '@/core/asin'

const norm = (s: string | null | undefined) =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const shortTitle = (t: string) =>
  norm(
    t
      .split(/[:–—]| - /)[0]
      ?.replace(/\b(unabridged|abridged|dramati[sz]ed)\b/gi, '')
  )

const asinOf = (a: Element) => asinFromHref(a.getAttribute('href'))

const asinsIn = (el: Element) => {
  const s = new Set<string>()
  for (const a of el.querySelectorAll('a[href*="/pd/"]')) {
    const x = asinOf(a)
    if (x) s.add(x)
  }
  return s
}

export function cardFor(link: Element, asin: string): Element | null {
  const known = link.closest(
    'li.productListItem, [id^="adbl-library-content-row-"]'
  )
  if (known) return known
  let el: Element = link
  let best: Element | null = link.parentElement
  for (
    let i = 0;
    i < 12 && el.parentElement && el.parentElement !== document.body;
    i++
  ) {
    el = el.parentElement
    const s = asinsIn(el)
    if (s.size > 1 || (s.size === 1 && !s.has(asin))) break
    best = el
  }
  return best
}

const looksLikeTitle = (el: Element, title: string) => {
  const t = norm(el.textContent)
  if (!t || t.length > 300) return false
  const st = shortTitle(title)
  return (
    t === norm(title) ||
    shortTitle(el.textContent ?? '') === st ||
    (st.length >= 4 && t.startsWith(st))
  )
}

function findTitleEl(
  scope: Element,
  asin: string,
  title: string,
  inPopover: boolean
) {
  const ok = (e: Element) => inPopover || !e.closest('.bc-popover')
  const links = [...scope.querySelectorAll(`a[href*="${asin}"]`)].filter(
    a => ok(a) && (a.textContent ?? '').trim()
  )
  let el: Element | undefined =
    links.find(a => looksLikeTitle(a, title)) ||
    links.find(a => a.closest('h1,h2,h3,h4'))
  if (!el && title) {
    el = [...scope.querySelectorAll('h1,h2,h3,h4,span,p')].find(
      e => ok(e) && e.children.length <= 2 && looksLikeTitle(e, title)
    )
  }
  return el || null
}

function placeAfterTitle(
  scope: Element,
  wrap: Element,
  asin: string,
  title: string,
  inPopover: boolean
) {
  const el = findTitleEl(scope, asin, title, inPopover)
  if (!el) return false
  const li = el.closest('li')
  if (li && scope.contains(li) && li !== scope) {
    const newLi = document.createElement('li')
    newLi.className = `${li.className.replace(/\bagr-\S+/g, '')} agr-li`
    newLi.appendChild(wrap)
    li.insertAdjacentElement('afterend', newLi)
  } else {
    ;(el.closest('h1,h2,h3,h4') || el).insertAdjacentElement('afterend', wrap)
  }
  return true
}

/** Where the userscript put one wrap: the node it inserted, and what stood before it. */
export interface Placement {
  parent: Element | null
  previous: Element | null
  /** `title` when a title element was found, else the userscript's card-end fallback. */
  how: 'after-title' | 'before-popover' | 'card-end'
}

export interface OracleCard {
  card: Element
  asin: string
  /** The main badge of the visible card. */
  main: Placement
  /** One entry per popover of the card that got a badge. */
  popovers: Array<{ popover: Element; placement: Placement }>
}

const makeWrap = () => {
  const wrap = document.createElement('span')
  wrap.className = 'agr-wrap'
  const badge = document.createElement('a')
  badge.className = 'agr-badge'
  wrap.appendChild(badge)
  return wrap
}

const outerOf = (wrap: Element) => wrap.closest('.agr-li') ?? wrap
const where = (wrap: Element, how: Placement['how']): Placement => {
  const outer = outerOf(wrap)
  return {
    parent: outer.parentElement,
    previous: outer.previousElementSibling,
    how,
  }
}

/**
 * Runs the userscript's `scan` and `process` over the document: every card, in page order, gets its
 * badges placed by `titleOf(card, asin)` standing in for the catalogue title. The placements are
 * recorded and every node the oracle added is taken out again, so the page is as it was and the
 * extension can run on it next.
 */
export function runOracle(
  titleOf: (card: Element, asin: string) => string
): OracleCard[] {
  const cards = new Map<Element, string>()
  for (const a of document.querySelectorAll('a[href*="/pd/"]')) {
    const asin = asinOf(a)
    if (!asin) continue
    const card = cardFor(a, asin)
    if (!card || cards.has(card) || card.querySelector('.agr-badge')) continue
    if (a.closest('header, nav, footer, [role="navigation"]')) continue
    cards.set(card, asin)
  }
  const added: Element[] = []
  const out: OracleCard[] = []
  for (const [card, asin] of cards) {
    if (card.querySelector('.agr-badge')) continue // process(): a badge appeared meanwhile
    const title = titleOf(card, asin)
    const mainWrap = makeWrap()
    let main: Placement
    if (placeAfterTitle(card, mainWrap, asin, title, false)) {
      main = where(mainWrap, 'after-title')
    } else {
      const pop = card.querySelector('.bc-popover')
      if (pop) {
        pop.insertAdjacentElement('beforebegin', mainWrap)
        main = where(mainWrap, 'before-popover')
      } else {
        card.appendChild(mainWrap)
        main = where(mainWrap, 'card-end')
      }
    }
    added.push(outerOf(mainWrap))
    const popovers: OracleCard['popovers'] = []
    for (const popover of card.querySelectorAll('.bc-popover')) {
      const wrap = makeWrap()
      if (placeAfterTitle(popover, wrap, asin, title, true)) {
        popovers.push({ popover, placement: where(wrap, 'after-title') })
        added.push(outerOf(wrap))
      }
    }
    out.push({ card, asin, main, popovers })
  }
  // Recorded positions name the sibling before each insertion, which stays valid once the
  // oracle's own nodes are gone, unless that sibling was one of them.
  for (const o of out) {
    for (const p of [o.main, ...o.popovers.map(x => x.placement)]) {
      while (p.previous && added.includes(p.previous))
        p.previous = p.previous.previousElementSibling
    }
  }
  for (const node of added) node.remove()
  return out
}
