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
 * Wish List before Library (it lives under `/library/wishlist`), and deals before the rest: the
 * deals page is `/ep/audiobook-deals` and other campaign pages carry `deals` in their path too.
 */
export function pageKind(pathname: string): PageKind {
  const path = pathname.toLowerCase()
  if (path === '' || path === '/') return 'home'
  if (under(path, '/library/wishlist') || under(path, '/wl')) return 'wishlist'
  if (under(path, '/library')) return 'library'
  if (under(path, '/search')) return 'search'
  if (under(path, '/cat') || under(path, '/categories')) return 'category'
  if (path.includes('deals')) return 'deals'
  return 'other'
}

/**
 * Whether the page lists the user's own books (Library, collections, Wish List). The userscript's
 * rule: anything under `/library`; only rows on such a page are pinned (`/wl` redirects there).
 */
export const isLibraryPath = (pathname: string): boolean =>
  under(pathname.toLowerCase(), '/library')
