/**
 * Applies the user's filters to the cards on the page (ARCHITECTURE.md §7). The verdict for a card
 * is `src/core/filter.ts`'s; this module reads the book store and the settings, sets `data-agx-filter`
 * on each card (`hide` or `dim`, with CSS in badges.css) and counts the cards that are hidden, which
 * the panel's `12 hidden · Show` reports. A card whose book carries a highlighted label gets
 * `data-agx-highlight`, and its cover `data-agx-shine`, whatever its verdict. It touches only those attributes and the label pills'
 * classes.
 *
 * Everything that can change a verdict ends in `refresh`: a book arriving, a card appearing, the
 * settings changing, peeking. Cards on a page are in the hundreds, so a refresh looks at all of them.
 */
import { createStore, type Store } from '@tanstack/store'
import {
  type FilterSettings,
  hasLabel,
  isHighlighted,
  judge,
  place,
} from '../core/filter'
import type { RegionCode } from '../core/regions'
import { LABEL } from './badges'
import type { BookView } from './books'
import { coverOf, isInCarousel } from './cards'

export const ATTRIBUTE = 'data-agx-filter'
/** On a card whose book carries a label the user highlights. */
export const HIGHLIGHT = 'data-agx-highlight'
/** On that card's cover image, which badges.css makes glow. */
export const SHINE = 'data-agx-shine'
/** On a label pill whose genre the user hides (struck through by badges.css). */
export const FILTERED = 'agx-filtered'
/** On a label pill whose genre the user highlights. */
export const HIGHLIGHTED = 'agx-highlighted'

/** Filters off: what applies until the user's settings have been read. */
export const NO_FILTERS: FilterSettings = {
  enabled: false,
  minRating: 1,
  minRatings: 0,
  minYear: null,
  maxYear: null,
  maxPrice: {},
  hiddenLabels: [],
  highlightLabels: [],
  notFound: 'show',
  modes: {
    rating: 'hide',
    count: 'hide',
    labels: 'hide',
    year: 'hide',
    price: 'hide',
  },
}

/** What the panel shows of the filters. */
export interface FilterState {
  /** Cards the filters hide on this page (carousel slides are dimmed, so not counted). */
  readonly hidden: number
  /** Cards the filters dim: those failing only dimming filters, and failing carousel slides. */
  readonly dimmed: number
  /** Cards whose book carries a highlighted label. */
  readonly highlighted: number
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
  const state = createStore<FilterState>({
    hidden: 0,
    dimmed: 0,
    highlighted: 0,
    peek: false,
  })
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

  /** Some label pill carries a mark, so a pass that marks nothing still has to clear them. */
  let pillsMarked = false

  /** Marks the label pills in `card` whose genre is hidden or highlighted, and clears the others. */
  function markLabels(card: Element) {
    const hiddenLabels = settings.enabled ? settings.hiddenLabels : []
    const { highlightLabels } = settings
    if (
      hiddenLabels.length === 0 &&
      highlightLabels.length === 0 &&
      !pillsMarked
    )
      return
    for (const pill of card.querySelectorAll(`.${LABEL}`)) {
      const genre = pill.textContent ?? ''
      const filtered = hasLabel(hiddenLabels, genre)
      const highlighted = !filtered && hasLabel(highlightLabels, genre)
      pill.classList.toggle(FILTERED, filtered)
      pill.classList.toggle(HIGHLIGHTED, highlighted)
      if (filtered || highlighted) {
        pill.setAttribute(
          'aria-label',
          `${genre}, ${filtered ? 'hidden by your filters' : 'highlighted'}`
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
    let dimmed = 0
    let highlighted = 0
    for (const [asin, cards] of options.cards()) {
      const view = options.viewOf(asin)
      const judged = judge(view, settings, options.region)
      const marked = isHighlighted(view, settings)
      for (const card of cards) {
        if (!card.isConnected) continue
        markLabels(card)
        const slide = inCarousel(card)
        const verdict = place(judged, { inCarousel: slide, peek })
        if (verdict === 'show') card.removeAttribute(ATTRIBUTE)
        else if (card.getAttribute(ATTRIBUTE) !== verdict)
          card.setAttribute(ATTRIBUTE, verdict)
        if (marked) {
          if (!card.hasAttribute(HIGHLIGHT)) card.setAttribute(HIGHLIGHT, '')
          // Checked on every pass: Audible may swap the image of a card it lazy-loads.
          const cover = coverOf(card)
          if (cover && !cover.hasAttribute(SHINE)) cover.setAttribute(SHINE, '')
          highlighted++
        } else if (card.hasAttribute(HIGHLIGHT)) {
          card.removeAttribute(HIGHLIGHT)
          for (const img of card.querySelectorAll(`[${SHINE}]`))
            img.removeAttribute(SHINE)
        }
        if (judged === 'hide' && !slide) hidden++
        else if (judged !== 'show') dimmed++
      }
    }
    state.setState(prev =>
      prev.hidden === hidden &&
      prev.dimmed === dimmed &&
      prev.highlighted === highlighted
        ? prev
        : { ...prev, hidden, dimmed, highlighted }
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
      for (const el of options.doc.querySelectorAll(
        `[${ATTRIBUTE}], [${HIGHLIGHT}], [${SHINE}]`
      )) {
        el.removeAttribute(ATTRIBUTE)
        el.removeAttribute(HIGHLIGHT)
        el.removeAttribute(SHINE)
      }
      for (const pill of options.doc.querySelectorAll(
        `.${FILTERED}, .${HIGHLIGHTED}`
      )) {
        pill.classList.remove(FILTERED, HIGHLIGHTED)
        pill.removeAttribute('aria-label')
      }
    },
  }
}
