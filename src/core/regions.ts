/**
 * The Audible marketplaces the extension runs on, one row each. The content script's `matches` and
 * the manifest's API host permissions are generated from this table (ARCHITECTURE.md §9), so they
 * can't drift apart. Pure TS: no DOM, no Effect, so wxt.config.ts can import it too.
 */

export type RegionCode =
  | 'US'
  | 'UK'
  | 'CA'
  | 'AU'
  | 'IN'
  | 'DE'
  | 'FR'
  | 'IT'
  | 'ES'
  | 'JP'

export interface Region {
  /** Short code, e.g. `UK`. */
  readonly code: RegionCode
  /** The marketplace's top-level domain, e.g. `co.uk`. */
  readonly tld: string
  /** The site the content script runs on, e.g. `www.audible.co.uk`. */
  readonly siteHost: string
  /** The catalogue API host the background queries, e.g. `api.audible.co.uk`. */
  readonly apiHost: string
  /** ISO 4217 currency code of the marketplace's prices. */
  readonly currency: string
  /** BCP 47 locale for formatting numbers and prices. */
  readonly locale: string
}

const region = (
  code: RegionCode,
  tld: string,
  currency: string,
  locale: string
): Region => ({
  code,
  tld,
  siteHost: `www.audible.${tld}`,
  apiHost: `api.audible.${tld}`,
  currency,
  locale,
})

/** The 10 marketplaces of the userscript's `@match` list (DECISIONS.md D6). */
export const REGIONS: readonly Region[] = [
  region('US', 'com', 'USD', 'en-US'),
  region('UK', 'co.uk', 'GBP', 'en-GB'),
  region('CA', 'ca', 'CAD', 'en-CA'),
  region('AU', 'com.au', 'AUD', 'en-AU'),
  region('IN', 'in', 'INR', 'en-IN'),
  region('DE', 'de', 'EUR', 'de-DE'),
  region('FR', 'fr', 'EUR', 'fr-FR'),
  region('IT', 'it', 'EUR', 'it-IT'),
  region('ES', 'es', 'EUR', 'es-ES'),
  region('JP', 'co.jp', 'JPY', 'ja-JP'),
]

const byHost = new Map<string, Region>(
  REGIONS.flatMap(r => [
    [r.siteHost, r],
    [`audible.${r.tld}`, r],
  ])
)

/**
 * The marketplace a page hostname belongs to: `www.audible.<tld>` or the bare `audible.<tld>`.
 * Returns `undefined` for any other host, including look-alikes such as `audible.com.evil.example`.
 */
export function regionFromHost(hostname: string): Region | undefined {
  return byHost.get(hostname.toLowerCase())
}

/** Content-script match patterns: one `https://www.audible.<tld>/*` per marketplace. */
export function contentScriptMatches(): string[] {
  return REGIONS.map(r => `https://${r.siteHost}/*`)
}

/** Host permissions for the catalogue API: one `https://api.audible.<tld>/*` per marketplace. */
export function apiHostPermissions(): string[] {
  return REGIONS.map(r => `https://${r.apiHost}/*`)
}
