/**
 * The kind of Audible page a path belongs to, for the port's `Hello` message (ARCHITECTURE.md §5).
 * Pure TS: the caller passes `location.pathname`. Audible paths carry no locale prefix, so the
 * marketplaces share one table.
 */

/** Same literals as `Page` in `src/schema/messages.ts`; `page.test.ts` checks that every kind is one the schema accepts. */
export type PageKind =
  | 'home'
  | 'search'
  | 'category'
  | 'deals'
  | 'library'
  | 'wishlist'
  | 'other'

/** True when `path` is `base` or lies below it (`/cat` and `/cat/Sci-Fi`, not `/catalog`). */
const under = (path: string, base: string) =>
  path === base || path.startsWith(`${base}/`)

/**
 * Paths of Audible deals and sale campaigns (`/ep/audiobook-deals`, `/ep/summer-deals-2026`,
 * `/ep/bfcm-uk`, `/ep/cash-sale`, `/ep/2-for-1`). Bounded on the left so unrelated words such as
 * `/author/saleem` or `wholesale` do not match; digits may follow directly (`bfcm2026`).
 */
const DEALS_PATH =
  /(?:^|[/_-])(?:deals?|sales?|bfcm|black-?friday|cyber-?monday|2-?for-?1)(?:$|[-/_\d])/

/**
 * Wish List before Library (it lives under `/library/wishlist`), product/author/series pages before
 * deals (titles, author names or series names can contain "sale" or "deal"), and deals/sales before
 * the rest.
 */
export function pageKind(pathname: string): PageKind {
  const path = pathname.toLowerCase()
  if (path === '' || path === '/') return 'home'
  if (under(path, '/library/wishlist') || under(path, '/wl')) return 'wishlist'
  if (under(path, '/library')) return 'library'
  if (under(path, '/search')) return 'search'
  if (under(path, '/cat') || under(path, '/categories')) return 'category'
  if (under(path, '/pd') || under(path, '/author') || under(path, '/series'))
    return 'other'
  if (DEALS_PATH.test(path)) return 'deals'
  return 'other'
}

/**
 * Whether the page lists the user's own books (Library, collections, Wish List). The userscript's
 * rule: anything under `/library`; only rows on such a page are pinned (`/wl` redirects there).
 */
export const isLibraryPath = (pathname: string): boolean =>
  under(pathname.toLowerCase(), '/library')
