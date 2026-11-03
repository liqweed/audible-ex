/**
 * Applies the user's filters to the cards on the page (ARCHITECTURE.md §7). The verdict for a card
 * is `src/core/filter.ts`'s; this module reads the book store and the settings, sets `data-agx-filter`
 * on each card (`hide` or `dim`, with CSS in badges.css) and counts the cards that are hidden, which
 * the panel's `12 hidden · Show` reports. It touches only that attribute.
 *
 * Everything that can change a verdict ends in `refresh`: a book arriving, a card appearing, the
 * settings changing, peeking. Cards on a page are in the hundreds, so a refresh looks at all of them.
 */
import { createStore, type Store } from '@tanstack/store'
import {
  type FilterSettings,
  isHiddenLabel,
  judge,
  place,
} from '../core/filter'
import type { RegionCode } from '../core/regions'
import { LABEL } from './badges'
import type { BookView } from './books'
import { isInCarousel } from './cards'

export const ATTRIBUTE = 'data-agx-filter'
/** On a label pill whose genre the user hides (struck through by badges.css). */
export const FILTERED = 'agx-filtered'

/** Filters off: what applies until the user's settings have been read. */
export const NO_FILTERS: FilterSettings = {
  enabled: false,
  minRating: 1,
  minRatings: 0,
  minYear: null,
  maxYear: null,
  maxPrice: {},
  hiddenLabels: [],
  notFound: 'show',
  mode: 'hide',
}

/** What the panel shows of the filters. */
export interface FilterState {
  /** Cards the filters hide on this page (carousel slides are dimmed, so not counted). */
  readonly hidden: number
  /** The hidden cards are shown, dimmed (`12 hidden · Show`). */
  readonly peek: boolean
}

export interface FilterApplier {
  readonly state: Store<FilterState>
  /** The settings in force now. */
  settings(): FilterSettings
  setSettings(settings: FilterSettings): void
  setPeek(peek: boolean): void
  /** Something changed that can change a verdict: a book, or a card that was just attached. */
  refresh(): void
  /** Takes the attribute off every card (the extension was turned off). */
  remove(): void
}

export function createFilterApplier(options: {
  doc: Document
  region?: RegionCode
  /** The cards on the page, by ASIN. */
  cards(): ReadonlyMap<string, ReadonlySet<Element>>
  viewOf(asin: string): BookView | undefined
}): FilterApplier {
  const state = createStore<FilterState>({ hidden: 0, peek: false })
  let settings = NO_FILTERS
  /** Where a card sits does not change while it is on the page, and `closest` is not free. */
  const carousels = new WeakMap<Element, boolean>()
  const inCarousel = (card: Element) => {
    let known = carousels.get(card)
    if (known === undefined) {
      known = isInCarousel(card)
      carousels.set(card, known)
    }
    return known
  }

  /** Some label pill carries the mark, so a pass that marks nothing still has to clear it. */
  let pillsMarked = false

  /** Marks the label pills in `card` whose genre is hidden, and clears the others. */
  function markLabels(card: Element) {
    const labels = settings.enabled ? settings.hiddenLabels : []
    if (labels.length === 0 && !pillsMarked) return
    for (const pill of card.querySelectorAll(`.${LABEL}`)) {
      const filtered = isHiddenLabel(labels, pill.textContent ?? '')
      pill.classList.toggle(FILTERED, filtered)
      if (filtered) {
        pill.setAttribute(
          'aria-label',
          `${pill.textContent}, hidden by your filters`
        )
        pillsMarked = true
      } else if (pill.hasAttribute('aria-label')) {
        pill.removeAttribute('aria-label')
      }
    }
  }

  function refresh() {
    const { peek } = state.get()
    let hidden = 0
    for (const [asin, cards] of options.cards()) {
      const judged = judge(options.viewOf(asin), settings, options.region)
      for (const card of cards) {
        if (!card.isConnected) continue
        markLabels(card)
        const slide = inCarousel(card)
        const verdict = place(judged, { inCarousel: slide, peek })
        if (verdict === 'show') card.removeAttribute(ATTRIBUTE)
        else if (card.getAttribute(ATTRIBUTE) !== verdict)
          card.setAttribute(ATTRIBUTE, verdict)
        if (judged === 'hide' && !slide) hidden++
      }
    }
    state.setState(prev =>
      prev.hidden === hidden ? prev : { ...prev, hidden }
    )
  }

  return {
    state,
    settings: () => settings,
    setSettings(next) {
      settings = next
      refresh()
    },
    setPeek(peek) {
      state.setState(prev => ({ ...prev, peek }))
      refresh()
    },
    refresh,
    remove() {
      for (const el of options.doc.querySelectorAll(`[${ATTRIBUTE}]`))
        el.removeAttribute(ATTRIBUTE)
      for (const pill of options.doc.querySelectorAll(`.${FILTERED}`)) {
        pill.classList.remove(FILTERED)
        pill.removeAttribute('aria-label')
      }
    },
  }
}
