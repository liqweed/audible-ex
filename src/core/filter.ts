/**
 * What happens to one book's card under the user's filters (ARCHITECTURE.md §7, PRD R3). A pure
 * function of the book, the settings and where the card sits; the content script's applier turns the
 * verdict into an attribute and CSS. The inputs are structural, so this module needs nothing from
 * the content script or from storage.
 *
 * The rule that matters most: a book whose data has not arrived is never hidden, because hiding it
 * and then showing it makes the page jump. Genres come from the book page, after the rating, so a
 * hidden-label filter cannot act on a book until its details have arrived either.
 */

export type Verdict = 'show' | 'dim' | 'hide'

/** What to do with a book that is not on Goodreads. */
export type NotFoundPolicy = Verdict

/** The part of the user's preferences the verdict reads (`Prefs['filters']`). */
export interface FilterSettings {
  /** The filters' master switch; the extension's own switch removes the whole content script. */
  readonly enabled: boolean
  readonly minRating: number
  /** 0 turns the minimum number of ratings off. */
  readonly minRatings: number
  /** Goodreads genre names, compared without regard to case. */
  readonly hiddenLabels: readonly string[]
  readonly notFound: NotFoundPolicy
  /** What a book that fails a filter gets. */
  readonly mode: 'hide' | 'dim'
}

/** The part of a book view the verdict reads. */
export interface FilterBook {
  readonly status: 'queued' | 'loading' | 'ready' | 'notFound' | 'failed'
  readonly rating?: { readonly r: number; readonly n: number } | undefined
  readonly details?: { readonly genres: readonly string[] } | undefined
}

export interface Placement {
  /** The card is a slide in a carousel: removing it breaks Audible's layout, so it is dimmed. */
  readonly inCarousel: boolean
  /** The user asked to see the hidden books (`12 hidden · Show`): they are drawn dimmed. */
  readonly peek: boolean
}

const label = (s: string) => s.trim().toLowerCase()

/**
 * The verdict before the card's place is considered: `show`, or what the book gets for failing a
 * filter. This is also what the `12 hidden` counter counts (`hide` here, outside carousels).
 */
export function judge(
  book: FilterBook | undefined,
  settings: FilterSettings
): Verdict {
  if (!settings.enabled || !book) return 'show'
  if (book.status === 'notFound') return settings.notFound
  if (book.status !== 'ready' || !book.rating) return 'show'

  const { r, n } = book.rating
  if (r < settings.minRating) return settings.mode
  if (settings.minRatings > 0 && n < settings.minRatings) return settings.mode
  if (settings.hiddenLabels.length > 0 && book.details) {
    const hidden = new Set(settings.hiddenLabels.map(label))
    if (book.details.genres.some(genre => hidden.has(label(genre))))
      return settings.mode
  }
  return 'show'
}

/** Carousels and peeking soften `hide` to `dim`; nothing else changes. */
export function place(verdict: Verdict, where: Placement): Verdict {
  return verdict === 'hide' && (where.inCarousel || where.peek)
    ? 'dim'
    : verdict
}

export const verdict = (
  book: FilterBook | undefined,
  settings: FilterSettings,
  where: Placement
): Verdict => place(judge(book, settings), where)
