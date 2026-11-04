/**
 * What happens to one book's card under the user's filters (ARCHITECTURE.md §7, PRD R3). A pure
 * function of the book, the settings and where the card sits; the content script's applier turns the
 * verdict into an attribute and CSS. The inputs are structural, so this module needs nothing from
 * the content script or from storage.
 *
 * The rule that matters most: a book whose data has not arrived is never hidden, because hiding it
 * and then showing it makes the page jump. Genres come from the book page, after the rating, so a
 * hidden-label filter cannot act on a book until its details have arrived either.
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
 * The filters `book` fails, in the order of `DIMENSIONS`. Empty for a book whose rating has not
 * arrived; each filter acts once the data it reads is known.
 */
export function failures(
  book: FilterBook,
  settings: FilterSettings,
  region?: RegionCode
): Dimension[] {
  if (book.status !== 'ready' || !book.rating) return []
  const failed: Dimension[] = []
  const { r, n } = book.rating
  if (r < settings.minRating) failed.push('rating')
  if (settings.minRatings > 0 && n < settings.minRatings) failed.push('count')
  if (
    settings.hiddenLabels.length > 0 &&
    book.details?.genres.some(genre => hasLabel(settings.hiddenLabels, genre))
  )
    failed.push('labels')
  const year = book.details?.year
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
  if (book.status === 'notFound') return settings.notFound
  const failed = failures(book, settings, region)
  if (failed.length === 0) return 'show'
  // The strictest filter the book fails decides: one `hide` is enough to hide it.
  return failed.some(dimension => settings.modes[dimension] === 'hide')
    ? 'hide'
    : 'dim'
}

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
