/**
 * What happens to one book's card under the user's filters (ARCHITECTURE.md §7, PRD R3). A pure
 * function of the book, the settings and where the card sits; the content script's applier turns the
 * verdict into an attribute and CSS. The inputs are structural, so this module needs nothing from
 * the content script or from storage.
 *
 * Rules are evaluated in the user's priority order (`ruleOrder`, highest first): the first active
 * rule a book matches decides its verdict (`hide`/`dim` for filter dimensions, `show` for highlight
 * rules, or the `notFound` policy). A highlight above a `hide` rule keeps matching books visible; a
 * `dim` rule above a `hide` rule dims instead of hiding.
 *
 * Monotonicity (no page jumps): a book is never given a stricter verdict than a pending higher-
 * priority rule could still produce once its data arrives. Taking the least strict verdict across
 * the first match and all pending higher-priority rules guarantees verdicts can only tighten as data
 * arrives, and lets eager filtering (`lookupDepth`) stop as soon as a `hide` verdict is final.
 */

import type { PageKind } from './page'
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

/** Every rule that participates in priority order, highest priority first by default (DECISIONS.md D33). */
export const RULES = [
  'rating',
  'count',
  'year',
  'price',
  'labels',
  'highlightLabels',
  'highlightRating',
  'highlightPrice',
  'notFound',
] as const
export type Rule = (typeof RULES)[number]

export const DEFAULT_RULE_ORDER: readonly Rule[] = RULES

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
  /** Prices at or under this are marked (`isPriceHighlighted`); absent is off. */
  readonly highlightPrice: Readonly<Partial<Record<RegionCode, number>>>
  /** The price limit applies on deals/sale pages only (`settingsFor`). */
  readonly priceOnDeals: boolean
  /** Goodreads genre names, compared without regard to case. */
  readonly hiddenLabels: readonly string[]
  /** Genres the user is interested in: their books are marked, and keep matching books visible over lower rules. */
  readonly highlightLabels: readonly string[]
  /** Books rated at least this are marked, and keep matching books visible over lower rules; null turns it off. */
  readonly highlightRating: number | null
  readonly notFound: NotFoundPolicy
  /** What a book that fails each filter gets. */
  readonly modes: Readonly<Record<Dimension, MissMode>>
  /** Priority order of the rules, highest first. Defaults to `DEFAULT_RULE_ORDER` when omitted. */
  readonly ruleOrder?: readonly Rule[] | undefined
}

/** The part of a book view the verdict reads. */
export interface FilterBook {
  readonly status: 'queued' | 'loading' | 'ready' | 'notFound' | 'failed'
  readonly price?:
    | { readonly amount: number; readonly currency: string }
    | undefined
  /** Whether the public price lookup has settled; omitted means settled. */
  readonly priced?: boolean | undefined
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

/**
 * The settings in force on a page of this kind: with `priceOnDeals`, the price limit is off
 * everywhere but on a deals page. Every reader of the settings on a page goes through this, so a
 * book is never judged, or its price asked for, by a limit that is not in force there.
 */
export const settingsFor = (
  settings: FilterSettings,
  page: PageKind
): FilterSettings =>
  settings.priceOnDeals &&
  page !== 'deals' &&
  Object.keys(settings.maxPrice).length > 0
    ? { ...settings, maxPrice: {} }
    : settings

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

const STRICTNESS: Record<Verdict, number> = { show: 0, dim: 1, hide: 2 }
const leastStrict = (a: Verdict, b: Verdict): Verdict =>
  STRICTNESS[a] <= STRICTNESS[b] ? a : b

/** The verdict `rule` assigns to a book that matches it. */
export function ruleOutcome(rule: Rule, settings: FilterSettings): Verdict {
  switch (rule) {
    case 'rating':
    case 'count':
    case 'labels':
    case 'year':
    case 'price':
      return settings.modes[rule]
    case 'highlightLabels':
    case 'highlightRating':
    case 'highlightPrice':
      return 'show'
    case 'notFound':
      return settings.notFound
  }
}

type RuleMatch = 'match' | 'miss' | 'pending'

/** Whether `rule` is configured and can match books on `region`. */
function isRuleActive(
  rule: Rule,
  settings: FilterSettings,
  region?: RegionCode
): boolean {
  switch (rule) {
    case 'rating':
    case 'notFound':
      return true
    case 'count':
      return settings.minRatings > 0
    case 'labels':
      return settings.hiddenLabels.length > 0
    case 'year':
      return settings.minYear !== null || settings.maxYear !== null
    case 'price':
      return region !== undefined && settings.maxPrice[region] !== undefined
    case 'highlightLabels':
      return settings.highlightLabels.length > 0
    case 'highlightRating':
      return settings.highlightRating !== null
    case 'highlightPrice':
      return (
        region !== undefined && settings.highlightPrice[region] !== undefined
      )
  }
}

/**
 * Evaluates one active rule against `book`: `'match'` when known data satisfies it, `'miss'` when
 * known data rules it out, and `'pending'` when the data it reads has not arrived yet.
 */
function evaluateRule(
  rule: Rule,
  book: FilterBook,
  settings: FilterSettings,
  region?: RegionCode
): RuleMatch {
  const waitingGoodreads = book.status === 'queued' || book.status === 'loading'
  switch (rule) {
    case 'price': {
      const limit = region === undefined ? undefined : settings.maxPrice[region]
      if (region === undefined || limit === undefined) return 'miss'
      if (book.price !== undefined) {
        return book.price.currency === regionByCode(region).currency &&
          book.price.amount > limit
          ? 'match'
          : 'miss'
      }
      return book.priced === false ? 'pending' : 'miss'
    }
    case 'highlightPrice': {
      const limit =
        region === undefined ? undefined : settings.highlightPrice[region]
      if (region === undefined || limit === undefined) return 'miss'
      if (book.price !== undefined) {
        return book.price.currency === regionByCode(region).currency &&
          book.price.amount <= limit
          ? 'match'
          : 'miss'
      }
      return book.priced === false ? 'pending' : 'miss'
    }
    case 'rating':
      if (book.status === 'ready' && book.rating)
        return book.rating.r < settings.minRating ? 'match' : 'miss'
      return waitingGoodreads ? 'pending' : 'miss'
    case 'count':
      if (settings.minRatings <= 0) return 'miss'
      if (book.status === 'ready' && book.rating)
        return book.rating.n < settings.minRatings ? 'match' : 'miss'
      return waitingGoodreads ? 'pending' : 'miss'
    case 'highlightRating':
      if (settings.highlightRating === null) return 'miss'
      if (book.status === 'ready' && book.rating)
        return book.rating.r >= settings.highlightRating ? 'match' : 'miss'
      return waitingGoodreads ? 'pending' : 'miss'
    case 'notFound':
      if (book.status === 'notFound') return 'match'
      return waitingGoodreads ? 'pending' : 'miss'
    case 'labels':
      if (settings.hiddenLabels.length === 0) return 'miss'
      if (book.status === 'ready') {
        if (!book.details) return 'pending'
        return book.details.genres.some(genre =>
          hasLabel(settings.hiddenLabels, genre)
        )
          ? 'match'
          : 'miss'
      }
      return waitingGoodreads ? 'pending' : 'miss'
    case 'year': {
      if (settings.minYear === null && settings.maxYear === null) return 'miss'
      if (book.status === 'ready') {
        if (!book.details) return 'pending'
        const { year } = book.details
        // 0 means Goodreads has no year.
        return year !== undefined &&
          year !== 0 &&
          ((settings.minYear !== null && year < settings.minYear) ||
            (settings.maxYear !== null && year > settings.maxYear))
          ? 'match'
          : 'miss'
      }
      return waitingGoodreads ? 'pending' : 'miss'
    }
    case 'highlightLabels':
      if (settings.highlightLabels.length === 0) return 'miss'
      if (book.status === 'ready') {
        if (!book.details) return 'pending'
        return book.details.genres.some(genre =>
          hasLabel(settings.highlightLabels, genre)
        )
          ? 'match'
          : 'miss'
      }
      return waitingGoodreads ? 'pending' : 'miss'
  }
}

/**
 * The verdict before the card's place is considered: `show`, `dim`, or `hide`. Evaluated in
 * `ruleOrder` (highest priority first): the first matching rule wins, bounded below by any pending
 * higher-priority rule's outcome so verdicts are monotonic and never cause page jumps.
 * This is also what the `12 hidden` counter counts (`hide` here, outside carousels).
 */
export function judge(
  book: FilterBook | undefined,
  settings: FilterSettings,
  region?: RegionCode
): Verdict {
  if (!settings.enabled || !book) return 'show'
  const order = settings.ruleOrder ?? DEFAULT_RULE_ORDER
  let floor: Verdict = 'hide'
  for (const rule of order) {
    if (!isRuleActive(rule, settings, region)) continue
    const state = evaluateRule(rule, book, settings, region)
    if (state === 'match')
      return leastStrict(ruleOutcome(rule, settings), floor)
    if (state === 'pending')
      floor = leastStrict(floor, ruleOutcome(rule, settings))
  }
  return 'show'
}

/**
 * Does `book` carry a label the user highlights, or a rating at or above their highlight rating?
 * Visual highlight mark: works with filtering off too. When filtering is on, a highlight rule's
 * position in `ruleOrder` decides whether it overrides lower-priority hide or dim rules.
 */
export const isHighlighted = (
  book: FilterBook | undefined,
  settings: FilterSettings
): boolean =>
  book?.status === 'ready' &&
  ((settings.highlightRating !== null &&
    !!book.rating &&
    book.rating.r >= settings.highlightRating) ||
    (settings.highlightLabels.length > 0 &&
      !!book.details?.genres.some(genre =>
        hasLabel(settings.highlightLabels, genre)
      )))

/**
 * Is this book's public cash price at or under the user's highlight price for the marketplace?
 * Visual price chip: works with filtering off too. When filtering is on, `highlightPrice`'s
 * position in `ruleOrder` decides whether it keeps a book visible over lower-priority rules.
 * A missing price, or one in another currency, is not highlighted.
 */
export const isPriceHighlighted = (
  book: FilterBook | undefined,
  settings: FilterSettings,
  region?: RegionCode
): boolean => {
  const limit = region && settings.highlightPrice[region]
  return (
    region !== undefined &&
    limit !== undefined &&
    !!book?.price &&
    book.price.currency === regionByCode(region).currency &&
    book.price.amount <= limit
  )
}

/** Does anything on this marketplace need the books' public prices: a price limit in force, or a highlight? */
export const wantsPrices = (
  settings: FilterSettings,
  region: RegionCode
): boolean =>
  (settings.enabled && settings.maxPrice[region] !== undefined) ||
  settings.highlightPrice[region] !== undefined

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

const isDetailsRule = (rule: Rule) =>
  rule === 'labels' || rule === 'year' || rule === 'highlightLabels'

const isGoodreadsRule = (rule: Rule) =>
  rule !== 'price' && rule !== 'highlightPrice'

// Only rules that can hide a found book at the rating stage (`notFound` books have no book page to skip).
const isRatingStageRule = (rule: Rule) => rule === 'rating' || rule === 'count'

/**
 * Eager filtering (PRD R3): how much of `book`'s lookup to ask for now. Verdicts are monotonic as
 * data arrives, so a book that `judge` hides on what is known stays hidden whatever else arrives:
 * nothing more is fetched for it (`none`). While a hiding price limit that no still-live higher-
 * priority non-hiding Goodreads rule can override waits for the book's price, only what the cache
 * has is asked for (`cached`); while a hiding rating-stage rule (`rating` or `count`) or an already-
 * matched hide rule held only by a pending price rule could still hide the book without details,
 * only the rating (`rating`); the book page follows once the book can no longer be hidden without it.
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
  const current = book ? { ...book, priced: where.priced } : undefined
  if (judge(current, settings, region) === 'hide') return 'none'
  const probe: FilterBook = current ?? {
    status: 'queued',
    priced: where.priced,
  }
  const order = settings.ruleOrder ?? DEFAULT_RULE_ORDER

  // Can `price` hide the book as soon as the price arrives, without consulting Goodreads?
  const limit = region === undefined ? undefined : settings.maxPrice[region]
  if (!where.priced && limit !== undefined && settings.modes.price === 'hide') {
    let blockedByGoodreads = false
    for (const rule of order) {
      if (rule === 'price') break
      if (
        isGoodreadsRule(rule) &&
        isRuleActive(rule, settings, region) &&
        ruleOutcome(rule, settings) !== 'hide' &&
        evaluateRule(rule, probe, settings, region) !== 'miss'
      ) {
        blockedByGoodreads = true
        break
      }
    }
    if (!blockedByGoodreads) return 'cached'
  }

  // Can a rating-stage rule (or an already-matched hide rule waiting only on price) hide the book
  // before its Goodreads book page (details) is fetched?
  if (!book?.details) {
    let blockedByDetails = false
    for (const rule of order) {
      if (!isRuleActive(rule, settings, region)) continue
      const state = evaluateRule(rule, probe, settings, region)
      if (state === 'miss') continue
      const outcome = ruleOutcome(rule, settings)
      if (state === 'match') {
        if (outcome !== 'hide') break
        if (!blockedByDetails) return 'rating'
        break
      }
      if (isDetailsRule(rule) && outcome !== 'hide') {
        blockedByDetails = true
      } else if (
        !blockedByDetails &&
        isRatingStageRule(rule) &&
        outcome === 'hide'
      ) {
        return 'rating'
      }
    }
  }
  return 'details'
}
