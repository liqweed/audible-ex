/**
 * What happens to one book's card under the user's filters (ARCHITECTURE.md §7, PRD R3). A pure
 * function of the book, the settings and where the card sits; the content script's applier turns the
 * verdict into an attribute and CSS. The inputs are structural, so this module needs nothing from
 * the content script or from storage.
 *
 * The rule that matters most: a filter acts only on data that has arrived, and is never undone by
 * later data, because hiding a book and then showing it makes the page jump. Each filter acts as
 * soon as the data it reads is known: the price (from Audible) can hide a book before its rating,
 * the rating before its genres and year. That is also what lets the content script stop a book's
 * lookup early (`lookupDepth`, eager filtering).
 *
 * Each filter has its own miss mode: a book that fails a `hide` filter is hidden, one that fails only
 * `dim` filters is dimmed. Highlighted labels are not a filter: they never change the verdict.
 */

import { type RegionCode, regionByCode } from './regions'

export type Verdict = 'show' | 'dim' | 'hide'

/** What to do with a book that is not on Goodreads. */
export type NotFoundPolicy = Verdict

/** What a book that fails a filter gets (carousels always dim). */
export type MissMode = 'hide' | 'dim'

/** The filters that can fail a book, each with its own miss mode. */
export const DIMENSIONS = [
  'rating',
  'count',
  'labels',
  'year',
  'price',
] as const
export type Dimension = (typeof DIMENSIONS)[number]

/** The part of the user's preferences the verdict reads (`Prefs['filters']`). */
export interface FilterSettings {
  /** The filters' master switch; the extension's own switch removes the whole content script. */
  readonly enabled: boolean
  readonly minRating: number
  /** 0 turns the minimum number of ratings off. */
  readonly minRatings: number
  /** Inclusive first-published year bounds; null leaves that end open. Negative years are BCE. */
  readonly minYear: number | null
  readonly maxYear: number | null
  readonly maxPrice: Readonly<Partial<Record<RegionCode, number>>>
  /** Goodreads genre names, compared without regard to case. */
  readonly hiddenLabels: readonly string[]
  /** Genres the user is interested in: their books are marked, never filtered. */
  readonly highlightLabels: readonly string[]
  readonly notFound: NotFoundPolicy
  /** What a book that fails each filter gets. */
  readonly modes: Readonly<Record<Dimension, MissMode>>
}

/** The part of a book view the verdict reads. */
export interface FilterBook {
  readonly status: 'queued' | 'loading' | 'ready' | 'notFound' | 'failed'
  readonly price?:
    | { readonly amount: number; readonly currency: string }
    | undefined
  readonly rating?: { readonly r: number; readonly n: number } | undefined
  readonly details?:
    | { readonly genres: readonly string[]; readonly year?: number }
    | undefined
}

export interface Placement {
  /** The card is a slide in a carousel: removing it breaks Audible's layout, so it is dimmed. */
  readonly inCarousel: boolean
  /** The user asked to see the hidden books (`12 hidden · Show`): they are drawn dimmed. */
  readonly peek: boolean
}

/** How labels are compared: without regard to case or surrounding space. */
export const labelKey = (s: string): string => s.trim().toLowerCase()

/** Is `genre` one of `labels` (the hidden or the highlighted ones), compared by `labelKey`? */
export const hasLabel = (labels: readonly string[], genre: string): boolean =>
  labels.some(label => labelKey(label) === labelKey(genre))

/**
 * The filters `book` fails, in the order of `DIMENSIONS`. Each filter acts once the data it reads
 * is known: the price whatever the lookup's status, the rating and count once the book is `ready`,
 * the labels and year once its details have arrived too. More data can only add failures.
 */
export function failures(
  book: FilterBook,
  settings: FilterSettings,
  region?: RegionCode
): Dimension[] {
  const failed: Dimension[] = []
  const ready = book.status === 'ready'
  const rating = ready ? book.rating : undefined
  if (rating && rating.r < settings.minRating) failed.push('rating')
  if (rating && settings.minRatings > 0 && rating.n < settings.minRatings)
    failed.push('count')
  const details = ready ? book.details : undefined
  if (
    settings.hiddenLabels.length > 0 &&
    details?.genres.some(genre => hasLabel(settings.hiddenLabels, genre))
  )
    failed.push('labels')
  const year = details?.year
  // 0 means Goodreads has no year. A year filter cannot act until a known year arrives.
  if (
    year !== undefined &&
    year !== 0 &&
    ((settings.minYear !== null && year < settings.minYear) ||
      (settings.maxYear !== null && year > settings.maxYear))
  )
    failed.push('year')
  const limit = region && settings.maxPrice[region]
  if (
    region &&
    limit !== undefined &&
    book.price &&
    book.price.currency === regionByCode(region).currency &&
    book.price.amount > limit
  )
    failed.push('price')
  return failed
}

/**
 * The verdict before the card's place is considered: `show`, or what the book gets for failing a
 * filter. This is also what the `12 hidden` counter counts (`hide` here, outside carousels).
 */
export function judge(
  book: FilterBook | undefined,
  settings: FilterSettings,
  region?: RegionCode
): Verdict {
  if (!settings.enabled || !book) return 'show'
  const failed = failures(book, settings, region)
  // The strictest filter the book fails decides: one `hide` is enough to hide it.
  const verdict: Verdict =
    failed.length === 0
      ? 'show'
      : failed.some(dimension => settings.modes[dimension] === 'hide')
        ? 'hide'
        : 'dim'
  // A book not on Goodreads gets the not-found policy, or a failed price limit if that is stricter.
  return book.status === 'notFound'
    ? strictest(settings.notFound, verdict)
    : verdict
}

const STRICTNESS: Record<Verdict, number> = { show: 0, dim: 1, hide: 2 }
const strictest = (a: Verdict, b: Verdict): Verdict =>
  STRICTNESS[a] >= STRICTNESS[b] ? a : b

/**
 * Does `book` carry a label the user highlights? Independent of the filters' switch and verdict:
 * a highlighted book that fails a filter is still hidden or dimmed.
 */
export const isHighlighted = (
  book: FilterBook | undefined,
  settings: FilterSettings
): boolean =>
  settings.highlightLabels.length > 0 &&
  book?.status === 'ready' &&
  !!book.details?.genres.some(genre =>
    hasLabel(settings.highlightLabels, genre)
  )

/** Carousels and peeking soften `hide` to `dim`; nothing else changes. */
export function place(verdict: Verdict, where: Placement): Verdict {
  return verdict === 'hide' && (where.inCarousel || where.peek)
    ? 'dim'
    : verdict
}

export const verdict = (
  book: FilterBook | undefined,
  settings: FilterSettings,
  where: Placement,
  region?: RegionCode
): Verdict => place(judge(book, settings, region), where)

/**
 * How far a book's lookup is worth taking now: nothing more, its rating if the cache has it (no
 * Goodreads request), its rating only, or its details too.
 */
export type Depth = 'none' | 'cached' | 'rating' | 'details'

/** What `lookupDepth` needs to know besides the book and the settings. */
export interface DepthContext extends Placement {
  /** The background has answered the book's price (with a price, or that there is none). */
  readonly priced: boolean
}

/**
 * Eager filtering (PRD R3): how much of `book`'s lookup to ask for now. A filter's failures only
 * grow as data arrives, so a book that a `hide` filter hides on what is known stays hidden whatever
 * else arrives: nothing more is fetched for it (`none`). While a hiding price limit waits for the
 * book's price only what the cache has is asked for (`cached`), which costs Goodreads nothing; while
 * a hiding rating filter could still hide it only the rating (`rating`); the book page follows when
 * the rating lets the book through.
 *
 * A book that would be dimmed is still seen, so it gets everything (`details`), and so does every
 * book in a carousel or while the user peeks: neither is ever hidden (`place`). The caller asks
 * again whenever the answer can change: data arriving, the settings, a new card, peeking.
 */
export function lookupDepth(
  book: FilterBook | undefined,
  settings: FilterSettings,
  where: DepthContext,
  region?: RegionCode
): Depth {
  if (!settings.enabled || where.inCarousel || where.peek) return 'details'
  if (judge(book, settings, region) === 'hide') return 'none'
  const limit = region === undefined ? undefined : settings.maxPrice[region]
  if (!where.priced && limit !== undefined && settings.modes.price === 'hide')
    return 'cached'
  const ratingCanHide =
    settings.modes.rating === 'hide' ||
    (settings.modes.count === 'hide' && settings.minRatings > 0)
  if (!(book?.status === 'ready' && book.rating) && ratingCanHide)
    return 'rating'
  return 'details'
}
