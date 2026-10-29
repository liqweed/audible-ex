/**
 * Choosing the Goodreads book for an Audible book from `book/auto_complete` results, ported from the
 * userscript's `searchGoodreads` (v2.4.0). Pure TS: no HTTP, no Effect, no DOM. The Goodreads
 * service in the background worker owns the requests (through the `LookupQueue`) and drives this
 * module:
 *
 * 1. fetch the list for `bareTitle(title)`, then `scoreCandidates` it;
 * 2. if `needsAuthorSearch`, fetch the list for `titleAuthorQuery(title, author)` and score it;
 * 3. `chooseMatch(first, second)` gives the match, or `undefined` for a miss.
 *
 * The title-only search comes first because adding the author tends to surface "summary" and study
 * guide books for famous titles; the author search is the fallback that disambiguates common
 * titles. The userscript is the reference: change the rules only with a fixture for the book that
 * motivated it.
 */

import { lastName, norm, shortTitle } from './text'

/**
 * One result of `book/auto_complete?format=json`, reduced to what matching reads. Anything the
 * response has beyond this is ignored.
 */
export interface Candidate {
  readonly bookId: string
  /** Path on goodreads.com, e.g. `/book/show/5907.The_Hobbit`; it may carry a query string. */
  readonly bookUrl: string
  /** Full title with edition and series text, e.g. `Dune (Dune, #1)`. */
  readonly title: string
  /** Title without the series suffix; preferred over `title` when present. */
  readonly bookTitleBare?: string | undefined
  readonly author?: { readonly name?: string | undefined } | undefined
  /** Goodreads sends it as a string (`"4.29"`); some results carry a number. */
  readonly avgRating?: string | number | undefined
  readonly ratingsCount?: number | undefined
}

/** What Audible says about the book. A missing author turns the author checks off. */
export interface BookQuery {
  readonly title: string
  readonly author?: string | null | undefined
}

export interface ScoredCandidate {
  readonly candidate: Candidate
  /**
   * 3: author and title both match. 2: the author matches, the title only roughly. 1: the title
   * matches and no author is known (not reachable in practice: without an author every candidate
   * passes the author check and scores 2 or 3).
   */
  readonly score: number
}

/** The chosen Goodreads book. */
export interface Match {
  readonly bookId: string
  readonly rating: number
  readonly count: number
  /** Absolute book URL without its query string; every badge links here. */
  readonly url: string
  /** The approximate match: the author matched but the title only roughly (score below 3). */
  readonly loose: boolean
}

/**
 * The title-only query: the title before the first `:`, en dash or em dash. Unlike `shortTitle`,
 * a spaced hyphen does not cut it.
 */
export function bareTitle(title: string): string {
  return (title.split(/[:–—]/)[0] ?? '').trim()
}

/** The second query: the bare title and the author's name as Audible spells it. */
export function titleAuthorQuery(title: string, author: string): string {
  return `${bareTitle(title)} ${author}`
}

/**
 * Scores one autocomplete list against the book: 2 when the candidate's author name contains the
 * book's last name (or no author is known), plus 1 when the normalised short titles are equal or
 * one starts with the other. Keeps score 2 and up, in list order. (The userscript also keeps 1
 * "when no author is known", but then the author check always passes, so that branch is dead.)
 */
export function scoreCandidates(
  candidates: readonly Candidate[],
  query: BookQuery
): readonly ScoredCandidate[] {
  const wanted = shortTitle(query.title)
  const surname = lastName(query.author)
  return candidates.flatMap(candidate => {
    const found = shortTitle(candidate.bookTitleBare || candidate.title)
    const authorOk = !surname || norm(candidate.author?.name).includes(surname)
    const titleOk =
      found === wanted || found.startsWith(wanted) || wanted.startsWith(found)
    const score = (authorOk ? 2 : 0) + (titleOk ? 1 : 0)
    return score >= 2 || (score === 1 && !surname) ? [{ candidate, score }] : []
  })
}

/**
 * Whether to also search for title + author: when the title-only list has no score-3 candidate and
 * an author is known.
 */
export function needsAuthorSearch(
  first: readonly ScoredCandidate[],
  query: BookQuery
): boolean {
  return !first.some(x => x.score === 3) && Boolean(query.author)
}

/**
 * The best candidate of the title-only list followed by the title + author list (empty when that
 * search was skipped): highest score first, then most ratings. Ties keep list order, so the
 * title-only list wins them. `undefined` is a miss.
 */
export function chooseMatch(
  first: readonly ScoredCandidate[],
  second: readonly ScoredCandidate[] = []
): Match | undefined {
  const [best] = [...first, ...second].sort(
    (x, y) =>
      y.score - x.score ||
      (y.candidate.ratingsCount || 0) - (x.candidate.ratingsCount || 0)
  )
  if (!best) return undefined
  const { candidate, score } = best
  return {
    bookId: candidate.bookId,
    rating: parseFloat(String(candidate.avgRating ?? '')) || 0,
    count: candidate.ratingsCount || 0,
    url: `https://www.goodreads.com${candidate.bookUrl.split('?')[0]}`,
    loose: score < 3,
  }
}
