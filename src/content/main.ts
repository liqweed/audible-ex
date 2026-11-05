/**
 * The content script's behaviour, with everything it touches passed in so tests can run it on a
 * saved Audible page: the document, the location, the port, the observers and the timer. The
 * entrypoint (`src/entrypoints/content/index.ts`) supplies the real ones.
 *
 * The scanner finds cards; one that comes near the viewport gets its waiting badge and is looked up
 * over the port; a `BookUpdate` goes into the book store and from there onto every badge of that
 * ASIN, so a book shown on several cards updates them all, and a card scanned after the book is
 * known draws it at once, without a second lookup.
 *
 * Eager filtering: a lookup goes only as far as the filters leave worth it (`lookupDepth`). A book
 * the filters already hide on its price gets no Goodreads lookup (only what the cache has, asked
 * while the price is on its way), one they hide on its rating no book page; it is asked for the
 * rest as soon as it would be seen again (a filter off or dimming, peeking).
 * Lookups wait for the user's filters to be read, since those decide how far each one goes.
 */

import { asinFromHref } from '../core/asin'
import { DEFAULT_DISPLAY, type DisplaySettings } from '../core/display'
import {
  type Depth,
  type FilterSettings,
  hasLabel,
  labelKey,
  lookupDepth,
  wantsPrices,
} from '../core/filter'
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
import { createFilterApplier } from './filter'
import { createLabelPopover } from './labels'
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
import { type PanelHandle, publishHandle, withdrawHandle } from './shared'

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
  /** The user's filters; without it nothing is filtered. */
  filters?: {
    read(): Promise<FilterSettings>
    /** Calls `listener` on each change; returns the function that stops listening. */
    watch(listener: (settings: FilterSettings) => void): () => void
    /** Changes some of the settings, from the settings as stored when the write begins. */
    update(
      change: (current: FilterSettings) => Partial<FilterSettings>
    ): Promise<void>
  }
  display?: {
    read(): Promise<DisplaySettings>
    watch(listener: (display: DisplaySettings) => void): () => void
  }
  /** The badge stylesheet's text. */
  css: string
  /** The hover overview's stylesheet text; it goes inside the overview's shadow root. */
  overviewCss: string
  /** The extension's logo as an image URL, for the popovers' title rows. */
  logo?: string
  now?: () => number
}

/**
 * How long lookups wait for the filters to be read before they go ahead without them: storage that
 * does not answer must not leave the page without ratings.
 */
export const FILTERS_WAIT_MS = 1000

/** The `Lookup` item that asks for `depth` of a book. */
const itemOf = (
  asin: string,
  pinned: boolean,
  depth: Exclude<Depth, 'none'>
): LookupItem => ({
  asin,
  pinned,
  ...(depth === 'cached' && { cacheOnly: true }),
  ...(depth === 'rating' && { ratingOnly: true }),
})

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
  const regionCode = region.code

  injectStyles(doc, deps.css)

  let running = true
  let display: DisplaySettings = DEFAULT_DISPLAY
  const books = createBookStore()
  /** Every card showing an ASIN, to redraw them all when the book changes. */
  const cardsByAsin = new Map<string, Set<Element>>()
  /** Rows of Library and Wish List are pinned (the userscript's rule); nothing else is. */
  const pinRows = isLibraryPath(location.pathname)
  /** ASINs already sent as pinned, so a pinned row is not re-sent for nothing. */
  const pinnedSent = new Set<string>()
  /** ASINs seen on a pinned row; they go pinned whenever they are sent. */
  const pins = new Set<string>()
  /** How far each book's lookup has been asked of the background. */
  const asked = new Map<string, Exclude<Depth, 'none'>>()
  /** ASINs whose price the background has answered, with a price or without one. */
  const priced = new Set<string>()
  /** Books whose lookup is held back because the filters hide them (`ContentState.held`). */
  let held: ReadonlySet<string> = new Set()
  /** Lookups wait until the filters are known (or `FILTERS_WAIT_MS`): they decide how far each goes. */
  let filtersRead = deps.filters === undefined

  const page = pageKind(location.pathname)
  const client = createPortClient({
    connect: deps.connect,
    region: region.code,
    page,
    unresolved: () =>
      [...asked]
        .filter(([asin]) => isUnresolved(books.get(asin)))
        .map(([asin, depth]) => itemOf(asin, pinnedSent.has(asin), depth)),
    onMessage(message) {
      if (message._tag === 'BookUpdate') {
        const price = books.get(message.asin)?.price
        books.set(message.asin, { ...viewOf(message), ...(price && { price }) })
        lookUp([message.asin])
      } else if (message._tag === 'PriceUpdate') {
        priced.add(message.asin)
        const known = books.get(message.asin)
        if (known && message.price)
          books.set(message.asin, { ...known, price: message.price })
        lookUp([message.asin])
      } else {
        const { _tag, ...progress } = message
        books.setProgress(progress)
      }
    },
    schedule: deps.schedule,
    now: deps.now,
  })

  const filter = createFilterApplier({
    doc,
    region: region.code,
    page,
    cards: () => cardsByAsin,
    viewOf: asin => books.get(asin),
  })
  const pricesAsked = new Set<string>()
  const requestPrices = () => {
    if (!wantsPrices(filter.settings(), region.code)) return
    const fresh = [...cardsByAsin.keys()].filter(asin => !pricesAsked.has(asin))
    for (const asin of fresh) pricesAsked.add(asin)
    client.prices(fresh)
  }

  /**
   * Asks the background for as much of each book's lookup as the filters leave worth having
   * (`lookupDepth`): a first lookup, possibly `ratingOnly`, or the details (`DetailsLookup`) of one
   * that stopped at the rating. Called for whatever can change the answer: cards coming into view, a
   * book's data or price arriving, the settings, peeking. A lookup that was sent is never taken back.
   */
  function lookUp(asins: Iterable<string>) {
    if (!filtersRead || !running) return
    const settings = filter.settings()
    const lookups: LookupItem[] = []
    const details: string[] = []
    let nextHeld: Set<string> | undefined
    for (const asin of asins) {
      const view = books.get(asin)
      const cards = cardsByAsin.get(asin)
      if (!view || !cards) continue
      const depth = lookupDepth(
        view,
        settings,
        { ...filter.placement(cards), priced: priced.has(asin) },
        regionCode
      )
      let had = asked.get(asin)
      if (had === 'cached' && view.status !== 'queued') {
        // The cache answered: as far as the background goes, that was a rating-only lookup.
        had = 'rating'
        asked.set(asin, had)
      }
      const pin = pins.has(asin) && !pinnedSent.has(asin)
      let send: Exclude<Depth, 'none'> | undefined
      if (had === undefined) {
        if (depth !== 'none') send = depth
      } else if (
        had === 'cached' &&
        (depth === 'rating' || depth === 'details')
      ) {
        // The price let the book through and the cache had nothing (or has not said yet).
        send = depth
      } else if (
        had === 'rating' &&
        depth === 'details' &&
        view.status === 'ready'
      ) {
        if (pin) send = 'details'
        else {
          asked.set(asin, 'details')
          details.push(asin)
        }
      } else if (pin) {
        // A book already asked for, seen on a pinned row: sent again to record the pin.
        send = had
      }
      if (send) {
        asked.set(asin, send)
        if (pins.has(asin)) pinnedSent.add(asin)
        lookups.push(itemOf(asin, pins.has(asin), send))
      }
      const isHeld =
        depth === 'none' &&
        !view.details &&
        view.status !== 'notFound' &&
        view.status !== 'failed'
      if (isHeld !== held.has(asin)) {
        nextHeld ??= new Set(held)
        if (isHeld) nextHeld.add(asin)
        else nextHeld.delete(asin)
      }
    }
    // One message for all the books that changed together.
    client.lookup(lookups)
    client.details(details)
    if (nextHeld) {
      held = nextHeld
      books.setHeld(held)
    }
  }

  /** The filters are known, or no longer waited for: every book's lookup is looked at again. */
  let cancelFiltersWait = filtersRead
    ? undefined
    : deps.schedule(() => filtersKnown(), FILTERS_WAIT_MS)
  function filtersKnown() {
    filtersRead = true
    cancelFiltersWait?.()
    cancelFiltersWait = undefined
    lookUp(cardsByAsin.keys())
  }

  /** A change that arrived before the first read finished is newer than that read. */
  let settingsChanged = false
  const unwatchFilters = deps.filters?.watch(settings => {
    settingsChanged = true
    filter.setSettings(settings)
    requestPrices()
    filtersKnown()
  })
  deps.filters?.read().then(
    settings => {
      if (!settingsChanged) {
        filter.setSettings(settings)
        requestPrices()
      }
      filtersKnown()
    },
    // Unreadable settings leave the page unfiltered, which is the safe side of the rule that a
    // book is never hidden for a reason the user did not choose.
    error => {
      console.error('audible-ex: could not read the filters', error)
      filtersKnown()
    }
  )

  function retry(card: Element, asin: string) {
    removeBadges(card)
    // Every badge of this book shows the wait again; this card gets a new one.
    books.set(asin, {
      status: 'queued',
      ...(books.get(asin)?.price && { price: books.get(asin)?.price }),
    })
    attach(card, asin)
    asked.set(asin, 'details')
    client.retry([asin])
  }

  /** The panel's "Retry failed": every book whose lookup failed goes back to waiting and is asked for again. */
  function retryFailed() {
    const asins = [...books.entries()]
      .filter(([, view]) => view.status === 'failed')
      .map(([asin]) => asin)
    if (asins.length === 0) return
    for (const asin of asins) {
      books.set(asin, {
        status: 'queued',
        ...(books.get(asin)?.price && { price: books.get(asin)?.price }),
      })
      asked.set(asin, 'details')
    }
    client.retry(asins)
  }

  function attach(card: Element, asin: string) {
    attachBadges(card, asin, titleOf(card, asin))
    const cards = cardsByAsin.get(asin) ?? new Set<Element>()
    cardsByAsin.set(asin, cards)
    cards.add(card)
    const view = books.get(asin)
    if (view)
      renderCard(card, view, { onRetry: () => retry(card, asin), display })
  }

  books.subscribe((asin, view) => {
    const cards = cardsByAsin.get(asin)
    if (!cards) return
    for (const card of cards) {
      if (!card.isConnected) cards.delete(card)
      else renderCard(card, view, { onRetry: () => retry(card, asin), display })
    }
    filter.refresh()
  })

  function onVisible(visible: ReadonlyArray<VisibleCard>) {
    const asins = new Set<string>()
    for (const { card, asin } of visible) {
      if (!card.isConnected || hasBadge(card)) continue
      if (pinRows && isKnownRow(card)) pins.add(asin)
      const known = books.get(asin) !== undefined
      attach(card, asin)
      // Shows the wait on every badge of this book.
      if (!known) books.set(asin, { status: 'queued' })
      asins.add(asin)
    }
    requestPrices()
    // One message for all the cards that came into view together. A new card can show a book the
    // filters hid (a carousel slide), so books already known are asked again too.
    lookUp(asins)
    // A card for a book already known is judged at once.
    filter.refresh()
  }

  const scanner = createScanner({
    doc,
    createIntersectionObserver: deps.createIntersectionObserver,
    createMutationObserver: deps.createMutationObserver,
    schedule: deps.schedule,
    pageAsin: asinFromHref(location.pathname),
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
    logo: deps.logo,
    enabled: () => display.overview,
    showYear: () => display.year,
    viewOf: badge => books.get((badge as HTMLElement).dataset.asin ?? ''),
  })

  let displayChanged = false
  const applyDisplay = (next: DisplaySettings) => {
    if (
      !running ||
      (display.labels === next.labels &&
        display.year === next.year &&
        display.overview === next.overview)
    )
      return
    display = next
    overview.hide()
    for (const [asin, cards] of cardsByAsin) {
      const view = books.get(asin)
      if (!view) continue
      for (const card of cards) {
        if (card.isConnected)
          renderCard(card, view, { onRetry: () => retry(card, asin), display })
      }
    }
    filter.refresh()
  }
  const unwatchDisplay = deps.display?.watch(next => {
    displayChanged = true
    applyDisplay(next)
  })
  deps.display?.read().then(
    next => {
      if (!displayChanged) applyDisplay(next)
    },
    error =>
      console.error('audible-ex: could not read the display settings', error)
  )

  const filters = deps.filters
  const saveFilters: NonNullable<typeof filters>['update'] = change =>
    filters
      ? filters.update(change)
      : Promise.reject(new Error('The filters cannot be saved here'))
  const without = (labels: readonly string[], label: string) =>
    labels.filter(l => labelKey(l) !== labelKey(label))
  const labels = createLabelPopover({
    doc,
    css: deps.overviewCss,
    logo: deps.logo,
    schedule: deps.schedule,
    hiddenLabels: () => filter.settings().hiddenLabels,
    highlightLabels: () => filter.settings().highlightLabels,
    filtersEnabled: () => filter.settings().enabled,
    booksWith(label) {
      let n = 0
      for (const [, view] of books.entries()) {
        if (view.details?.genres.some(g => labelKey(g) === labelKey(label))) n++
      }
      return n
    },
    // Without a way to save, a label offers nothing: the popover reports that it could not.
    hide: label =>
      saveFilters(current => ({
        enabled: true,
        hiddenLabels: hasLabel(current.hiddenLabels, label)
          ? current.hiddenLabels
          : [...current.hiddenLabels, label],
        highlightLabels: without(current.highlightLabels, label),
      })),
    highlight: label =>
      saveFilters(current => ({
        hiddenLabels: without(current.hiddenLabels, label),
        highlightLabels: hasLabel(current.highlightLabels, label)
          ? current.highlightLabels
          : [...current.highlightLabels, label],
      })),
    release: label =>
      saveFilters(current => ({
        hiddenLabels: without(current.hiddenLabels, label),
        highlightLabels: without(current.highlightLabels, label),
      })),
  })

  const handle: PanelHandle = {
    state: books.state,
    filter: filter.state,
    retryFailed,
    setPeek(peek) {
      filter.setPeek(peek)
      // Peeking shows the hidden books, so their lookups go on.
      lookUp(cardsByAsin.keys())
    },
  }
  publishHandle(doc, handle)

  function stop() {
    running = false
    cancelFiltersWait?.()
    withdrawHandle(doc, handle)
    unwatchFilters?.()
    unwatchDisplay?.()
    labels.stop()
    overview.stop()
    scanner.stop()
    client.close()
  }

  return {
    books,
    stop,
    remove() {
      stop()
      filter.remove()
      removeAllBadges(doc)
    },
  }
}
