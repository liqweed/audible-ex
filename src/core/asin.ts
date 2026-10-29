/**
 * ASIN extraction from Audible product links, ported from the userscript (`ASIN_RE`, `asinOf`,
 * v2.4.0). Pure TS: the caller reads the `href` attribute, this module only parses it.
 */

/**
 * `/pd/<ASIN>` or `/pd/<title-slug>/<ASIN>`, the ASIN being 10 upper-case letters or digits that
 * end the path segment (`/`, `?`, `#` or the end of the string). Only product (`/pd/`) links count:
 * author and series pages carry ASINs too, but they are not books.
 */
const ASIN_RE = /\/(?:pd\/(?:[^/?#]+\/)?)([A-Z0-9]{10})(?=[/?#]|$)/

/**
 * The ASIN in an Audible product link, or `undefined` when the link is not one (no `/pd/`, or an
 * id that is not exactly 10 upper-case letters or digits). A missing `href` has none.
 */
export function asinFromHref(
  href: string | null | undefined
): string | undefined {
  return (href || '').match(ASIN_RE)?.[1]
}
