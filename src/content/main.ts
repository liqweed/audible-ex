/**
 * The content script's behaviour, with everything it touches passed in so tests can run it on a
 * saved Audible page: the document, the location, the port, the observers and the timer. The
 * entrypoint (`src/entrypoints/content/index.ts`) supplies the real ones.
 *
 * The scanner finds cards; one that comes near the viewport gets its waiting badge and is looked up
 * over the port; a `BookUpdate` goes into the book store and from there onto every badge of that
 * ASIN, so a book shown on several cards updates them all, and a card scanned after the book is
 * known draws it at once, without a second lookup.
 */
import { isLibraryPath, pageKind } from '../core/page'
import { regionFromHost } from '../core/regions'
import {
  attachBadges,
  hasBadge,
  injectStyles,
  removeAllBadges,
  removeBadges,
  renderCard,
} from './badges'
import { type BookStore, createBookStore, isUnresolved, viewOf } from './books'
import { isKnownRow, titleOf } from './cards'
import { createOverview } from './overview'
import {
  type ClientPort,
  createPortClient,
  type LookupItem,
} from './port-client'
import {
  type CreateIntersectionObserver,
  createScanner,
  type MutationObserverLike,
  type VisibleCard,
} from './scanner'
import type { Schedule } from './schedule'

export interface ContentDeps {
  doc: Document
  location: { hostname: string; pathname: string }
  /** Opens the `agx` port to the background. */
  connect(): ClientPort
  createIntersectionObserver: CreateIntersectionObserver
  createMutationObserver?: (
    callback: (records: MutationRecord[]) => void
  ) => MutationObserverLike
  schedule: Schedule
  /** The badge stylesheet's text. */
  css: string
  /** The hover overview's stylesheet text; it goes inside the overview's shadow root. */
  overviewCss: string
  now?: () => number
}

export interface Content {
  readonly books: BookStore
  /** Stops watching and lookups; what is on the page stays (the extension was reloaded). */
  stop(): void
  /** Stops, then takes every badge, the overview and the stylesheet off the page (turned off). */
  remove(): void
}

/** Starts the content script; does nothing, and returns undefined, on a site that is not Audible. */
export function startContent(deps: ContentDeps): Content | undefined {
  const { doc, location } = deps
  const region = regionFromHost(location.hostname)
  if (!region) return undefined

  injectStyles(doc, deps.css)

  const books = createBookStore()
  /** Every card showing an ASIN, to redraw them all when the book changes. */
  const cardsByAsin = new Map<string, Set<Element>>()
  /** Rows of Library and Wish List are pinned (the userscript's rule); nothing else is. */
  const pinRows = isLibraryPath(location.pathname)
  /** ASINs already sent as pinned, so a pinned row is not re-sent for nothing. */
  const pinnedSent = new Set<string>()

  const client = createPortClient({
    connect: deps.connect,
    region: region.code,
    page: pageKind(location.pathname),
    unresolved: () =>
      [...books.entries()]
        .filter(([, view]) => isUnresolved(view))
        .map(([asin]) => ({ asin, pinned: pinnedSent.has(asin) })),
    onMessage(message) {
      // `Progress` belongs to the panel (phase 2).
      if (message._tag === 'BookUpdate')
        books.set(message.asin, viewOf(message))
    },
    schedule: deps.schedule,
    now: deps.now,
  })

  function retry(card: Element, asin: string) {
    removeBadges(card)
    // Every badge of this book shows the wait again; this card gets a new one.
    books.set(asin, { status: 'queued' })
    attach(card, asin)
    client.retry([asin])
  }

  function attach(card: Element, asin: string) {
    attachBadges(card, asin, titleOf(card, asin))
    const cards = cardsByAsin.get(asin) ?? new Set<Element>()
    cardsByAsin.set(asin, cards)
    cards.add(card)
    const view = books.get(asin)
    if (view) renderCard(card, view, { onRetry: () => retry(card, asin) })
  }

  books.subscribe((asin, view) => {
    const cards = cardsByAsin.get(asin)
    if (!cards) return
    for (const card of cards) {
      if (!card.isConnected) cards.delete(card)
      else renderCard(card, view, { onRetry: () => retry(card, asin) })
    }
  })

  function onVisible(visible: ReadonlyArray<VisibleCard>) {
    const items = new Map<string, boolean>()
    for (const { card, asin } of visible) {
      if (!card.isConnected || hasBadge(card)) continue
      const pinned = pinRows && isKnownRow(card)
      const known = books.get(asin) !== undefined
      attach(card, asin)
      if (!known) {
        // Shows the wait on every badge of this book and marks the ask as made.
        books.set(asin, { status: 'queued' })
        items.set(asin, pinned)
      } else if (pinned && !pinnedSent.has(asin)) {
        items.set(asin, true)
      }
    }
    const lookups: LookupItem[] = [...items].map(([asin, pinned]) => ({
      asin,
      pinned,
    }))
    for (const { asin, pinned } of lookups) if (pinned) pinnedSent.add(asin)
    // One message for all the cards that came into view together.
    client.lookup(lookups)
  }

  const scanner = createScanner({
    doc,
    createIntersectionObserver: deps.createIntersectionObserver,
    createMutationObserver: deps.createMutationObserver,
    schedule: deps.schedule,
    onVisible,
    onPrune() {
      for (const [asin, cards] of cardsByAsin) {
        for (const card of cards) if (!card.isConnected) cards.delete(card)
        if (cards.size === 0) cardsByAsin.delete(asin)
      }
    },
  })
  scanner.start()

  const overview = createOverview({
    doc,
    css: deps.overviewCss,
    viewOf: badge => books.get((badge as HTMLElement).dataset.asin ?? ''),
  })

  function stop() {
    overview.stop()
    scanner.stop()
    client.close()
  }

  return {
    books,
    stop,
    remove() {
      stop()
      removeAllBadges(doc)
    },
  }
}
