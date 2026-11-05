/**
 * Finds the cards on a page and tells the caller when one comes near the viewport. Ported from the
 * userscript's `scan`, `runScan`, IntersectionObserver and MutationObserver code (v2.4.0):
 *
 * - Cards are looked up only when they come within 400 px of the viewport.
 * - What the page adds later (infinite scroll, carousels) is picked up in batches: added roots are
 *   collected for 300 ms, roots inside other roots are dropped, and more than 300 roots rescan the
 *   body. A plain timer does the batching; TanStack Pacer would add its bundle to every Audible
 *   page for a delay that needs one `setTimeout`.
 * - A product page's own book is a card too: the page never links to it, so its `adbl-product-hero`
 *   is the card and the ASIN comes from the page's address (`pageAsin`).
 * - Our own nodes are ignored, and removed cards are let go: an IntersectionObserver keeps every
 *   observed element alive, even after the page removes it.
 *
 * The observers and the timer come in as parameters, so tests drive them by hand.
 */

import { hasBadge } from './badges'
import {
  type AsinMemo,
  asinOf,
  cardFor,
  NAVIGATION,
  OUR_NODES,
  PRODUCT_HERO,
} from './cards'
import type { Schedule } from './schedule'

/** Observe the card; report back when it is within `rootMargin` of the viewport. */
export const ROOT_MARGIN = '400px 0px'
/** How long added nodes are collected before they are scanned. */
export const BATCH_MS = 300
/** More added roots than this are not worth sorting out; scan the whole body. */
export const MAX_ROOTS = 300

export interface IntersectionEntryLike {
  readonly target: Element
  readonly isIntersecting: boolean
}

export interface ObserverLike {
  observe(target: Element): void
  unobserve(target: Element): void
  disconnect?(): void
}

export type CreateIntersectionObserver = (
  callback: (entries: ReadonlyArray<IntersectionEntryLike>) => void,
  rootMargin: string
) => ObserverLike

export interface MutationObserverLike {
  observe(target: Node, options: MutationObserverInit): void
  disconnect(): void
}

export interface VisibleCard {
  readonly card: Element
  readonly asin: string
}

export interface ScannerOptions {
  doc: Document
  createIntersectionObserver: CreateIntersectionObserver
  createMutationObserver?: (
    callback: (records: MutationRecord[]) => void
  ) => MutationObserverLike
  schedule: Schedule
  /** The ASIN of the book a product page is about, from its address; none on other pages. */
  pageAsin?: string | undefined
  /** Cards that came within the margin, once per observer callback. */
  onVisible(cards: ReadonlyArray<VisibleCard>): void
  /** After each scan, when removed cards have been let go. */
  onPrune?(): void
}

export interface Scanner {
  /** Scans the body, then watches it for what the page adds. */
  start(): void
  /** Scans these roots now (what a batch does). */
  scan(roots: ReadonlyArray<Element>): void
  stop(): void
}

export function createScanner(options: ScannerOptions): Scanner {
  const { doc, schedule } = options
  const createMutationObserver =
    options.createMutationObserver ??
    (callback => new MutationObserver(callback))

  /** Links already looked at, so each is judged once. */
  const seen = new WeakSet<Element>()
  /** Card to ASIN, for every card found; a card is never found twice. */
  const cards = new WeakMap<Element, string>()
  /** Cards waiting for the viewport, so removed ones can be let go. */
  const observed = new Set<Element>()

  const intersection = options.createIntersectionObserver(entries => {
    const visible: VisibleCard[] = []
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      intersection.unobserve(entry.target)
      observed.delete(entry.target)
      const asin = cards.get(entry.target)
      if (asin) visible.push({ card: entry.target, asin })
    }
    if (visible.length > 0) options.onVisible(visible)
  }, ROOT_MARGIN)

  function pruneObserved() {
    for (const card of observed) {
      if (card.isConnected) continue
      intersection.unobserve(card)
      observed.delete(card)
    }
  }

  function scanRoot(root: Element, memo: AsinMemo) {
    const { pageAsin } = options
    if (pageAsin) {
      for (const hero of root.matches(PRODUCT_HERO)
        ? [root]
        : root.querySelectorAll(PRODUCT_HERO)) {
        if (cards.has(hero) || hasBadge(hero)) continue
        cards.set(hero, pageAsin)
        observed.add(hero)
        intersection.observe(hero)
      }
    }
    const links = root.matches('a[href*="/pd/"]')
      ? [root]
      : [...root.querySelectorAll('a[href*="/pd/"]')]
    for (const link of links) {
      if (seen.has(link) || link.closest('.agx-wrap')) continue
      seen.add(link)
      const asin = asinOf(link)
      if (!asin) continue
      // Menu and header links to a book are not cards.
      if (link.closest(NAVIGATION)) continue
      const card = cardFor(link, asin, memo)
      if (!card || cards.has(card) || hasBadge(card)) continue
      // A link to the page's own book around its hero would badge the book twice.
      if (
        asin === pageAsin &&
        (card.closest(PRODUCT_HERO) || card.querySelector(PRODUCT_HERO))
      )
        continue
      cards.set(card, asin)
      observed.add(card)
      intersection.observe(card)
    }
  }

  function scan(roots: ReadonlyArray<Element>) {
    // The memo lives for one scan, so it never holds on to nodes.
    const memo: AsinMemo = new Map()
    for (const root of roots) if (root.isConnected) scanRoot(root, memo)
    pruneObserved()
    options.onPrune?.()
  }

  let addedRoots = new Set<Element>()
  let needPrune = false
  let cancelBatch: (() => void) | undefined

  function flush() {
    cancelBatch = undefined
    needPrune = false
    const added = addedRoots.size > MAX_ROOTS ? [doc.body] : [...addedRoots]
    addedRoots = new Set()
    // Drop roots that sit inside another root, so nothing is scanned twice.
    scan(added.filter(r => !added.some(o => o !== r && o.contains(r))))
  }

  const mutations = createMutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue
        const element = node as Element
        if (element.closest(OUR_NODES)) continue
        addedRoots.add(element)
      }
      if (record.removedNodes.length > 0 && observed.size > 0) needPrune = true
    }
    if ((addedRoots.size > 0 || needPrune) && !cancelBatch)
      cancelBatch = schedule(flush, BATCH_MS)
  })

  return {
    start() {
      scan([doc.body])
      mutations.observe(doc.body, { childList: true, subtree: true })
    },
    scan,
    stop() {
      mutations.disconnect()
      intersection.disconnect?.()
      cancelBatch?.()
      cancelBatch = undefined
    },
  }
}
