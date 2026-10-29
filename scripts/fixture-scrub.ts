/**
 * Pure helpers for scripts/capture-fixtures.ts: turn a fetched (or hand-saved) page into a fixture
 * that is stable between runs and carries no personal data. No I/O here, so it is unit-tested
 * (scripts/fixture-scrub.test.ts) without touching the network.
 */

export const REDACTED_EMAIL = 'redacted@example.invalid'

// Query parameters that differ on every request or identify a visitor. `ref=` is kept: it names a
// page position ("a_hp_ndi1_i2_rowitem"), which is the same every time.
const VOLATILE_PARAM =
  /^(pf_rd_.+|pageLoadId|plink|creativeId|ref_pageloadid|qid|sr|session-?id|token|csrf.*|(cust|customer|order|account)_?id|ipRedirect.*)$/i

// Encoded blobs such as `buyingOptionId=H4sIAAAA…` (base64 of gzipped, per-request data).
const LONG_TOKEN = 80

// Elements whose content never matters for card detection and often carries tokens, request ids or
// the visitor's account details.
const DROPPED_ELEMENTS = ['script', 'style', 'noscript', 'svg', 'iframe']

const SENSITIVE_ATTRIBUTE =
  /\s(?:nonce|data-[\w-]*(?:csrf|token|customer|cust|account|user|directed|session|request)[\w-]*)=(?:"[^"]*"|'[^']*')/gi

export function dropVolatileParams(url: string): string {
  const q = url.indexOf('?')
  if (q < 0) return url
  const hash = url.indexOf('#', q)
  const query = url.slice(q + 1, hash < 0 ? undefined : hash)
  const separator = query.includes('&amp;') ? '&amp;' : '&'
  const kept = query.split(/&amp;|&/).filter(pair => {
    const [name = '', value = ''] = pair.split('=')
    return pair && !VOLATILE_PARAM.test(name) && value.length < LONG_TOKEN
  })
  return (
    url.slice(0, q) +
    (kept.length ? `?${kept.join(separator)}` : '') +
    (hash < 0 ? '' : url.slice(hash))
  )
}

/**
 * Reduces an Audible page to its markup: no scripts, styles, svg, comments, `<meta>` or `<link>`,
 * no hidden-input values, no per-request URL parameters, no email addresses. Card detection works
 * on links and list items, which all stay.
 */
export function scrubAudibleHtml(html: string): string {
  let out = html
  for (const tag of DROPPED_ELEMENTS) {
    out = out.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi'),
      ''
    )
  }
  out = out
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(?:meta|link)\b[^>]*>/gi, '')
    // Amazon's logging pixels carry a request id in their path.
    .replace(/<img\b[^>]*\ssrc=(["'])(?:https?:)?\/\/fls-[^"']*\1[^>]*>/gi, '')
    .replace(/<input\b[^>]*>/gi, tag =>
      /\stype=["']?hidden/i.test(tag)
        ? tag.replace(/\svalue=(?:"[^"]*"|'[^']*')/i, ' value=""')
        : tag
    )
    .replace(SENSITIVE_ATTRIBUTE, '')
    .replace(
      /\s(href|src|action|data-[\w-]+)=("[^"]*"|'[^']*')/gi,
      (all, name: string, quoted: string) => {
        const value = quoted.slice(1, -1)
        return /^(https?:)?\/|^\?/.test(value)
          ? ` ${name}=${quoted[0]}${dropVolatileParams(value)}${quoted[0]}`
          : all
      }
    )
    .replace(EMAIL, REDACTED_EMAIL)
  return tidy(out)
}

/** Replaces each `redact` string (names, a nickname) as a whole word, ignoring case. */
export function redactStrings(text: string, redact: readonly string[]): string {
  return redact.reduce(
    (out, s) =>
      s.trim()
        ? out.replace(
            new RegExp(
              `(?<![\\p{L}\\p{N}])${escapeRegExp(s.trim())}(?![\\p{L}\\p{N}])`,
              'giu'
            ),
            'REDACTED'
          )
        : out,
    text
  )
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

const tidy = (text: string) =>
  `${text
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/\n\s*\n+/g, '\n')
    .trim()}\n`

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const PERSONAL_DATA: readonly [label: string, pattern: RegExp][] = [
  ['email address', EMAIL],
  ['order id', /\b[D\d]\d{2}-\d{7}-\d{7}\b/g],
  ['Amazon account id', /amzn1\.account\.[A-Z0-9]+/g],
  [
    'customer or session id',
    /(?:customer|cust|account|session|directed)[-_]?id["'=:\s]+[\w.-]{8,}/gi,
  ],
]
const GREETING: [string, RegExp] = [
  'greeting with a name',
  /\b(?:Hello|Hi|Welcome back),\s+[A-Z][\w'’-]+/g,
]

// Chrome's "Copy outerHTML" writes the quotes inside a JSON attribute as `&amp;quot;`.
const decodeEntities = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&(?:quot|#34|#x22);/gi, '"')
    .replace(/&#(?:64|x40);/gi, '@')

/**
 * What a fixture must not contain; empty when it is clean. Shared by the script and the guard test.
 * Book text may greet someone ("Hello, Ron"), so Goodreads output is checked with `greeting: false`.
 */
export function findPersonalData(
  text: string,
  { greeting = true } = {}
): string[] {
  const decoded = decodeEntities(text)
  return [...PERSONAL_DATA, ...(greeting ? [GREETING] : [])].flatMap(
    ([label, pattern]) =>
      [...decoded.matchAll(pattern)]
        .filter(m => m[0] !== REDACTED_EMAIL && !m[0].endsWith(', REDACTED'))
        .map(m => `${label}: ${m[0]}`)
  )
}

/** Goodreads autocomplete: `qid` is a random id per request; everything else is left as served. */
export function normaliseAutocomplete(list: unknown): unknown {
  if (!Array.isArray(list)) throw new Error('autocomplete is not a JSON array')
  return list.map(item =>
    item && typeof item === 'object' && 'qid' in item
      ? { ...item, qid: 'fixture' }
      : item
  )
}

// The extension reads Book and Work (genres, description, publication time); Contributor is kept so
// authors still resolve. Everything else on a book page is reviewers (names, profile links),
// shelvings, ads and banners: personal data of third parties, and the part that changes by the hour.
const KEPT_TYPES = new Set(['Query', 'Book', 'Work', 'Contributor'])
const KEPT_ROOT_FIELDS = /^(__typename|getBookByLegacyId)/
// `Work.featuredKNH` names a notable reader of the work and links their profile;
// `Contributor.user` points at the author's own Goodreads account, whose entity is dropped below.
const DROPPED_FIELDS: Record<string, Set<string>> = {
  Work: new Set(['featuredKNH']),
  Contributor: new Set(['user']),
}
// Allowlists, so a field Goodreads adds later (a token, a viewer) is left out until someone looks.
// What this leaves out today: jwtToken, apiKey, authContextParams, userAgent*, weblabs.
const KEPT_TOP_LEVEL = new Set(['props', 'page', 'query', 'buildId', 'locale'])
const KEPT_PAGE_PROPS = new Set([
  'params',
  'query',
  'locale',
  'dataSource',
  'apolloState',
])

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Goodreads book page → a minimal HTML document holding only `__NEXT_DATA__`, the one thing the
 * extension reads, with everything outside an allowlist removed (session values, viewer, weblabs) and
 * the reviewer entities, `Work.featuredKNH` and `Contributor.user` with it. Throws if the page has the wrong shape, so a changed
 * page never overwrites a good fixture.
 */
export function extractBookFixture(html: string, id: string): string {
  const start = '<script id="__NEXT_DATA__" type="application/json">'
  const i = html.indexOf(start)
  const j = i < 0 ? -1 : html.indexOf('</script>', i)
  if (j < 0) throw new Error('no __NEXT_DATA__ in the book page')
  const data: unknown = JSON.parse(html.slice(i + start.length, j))
  if (!isRecord(data) || !isRecord(data.props)) {
    throw new Error('__NEXT_DATA__ has no props')
  }
  const pageProps = data.props.pageProps
  if (!isRecord(pageProps) || !isRecord(pageProps.apolloState)) {
    throw new Error('__NEXT_DATA__ has no props.pageProps.apolloState')
  }

  const state: Json = {}
  for (const [key, value] of Object.entries(pageProps.apolloState)) {
    if (!isRecord(value) || !KEPT_TYPES.has(String(value.__typename))) continue
    state[key] =
      key === 'ROOT_QUERY'
        ? Object.fromEntries(
            Object.entries(value).filter(([field]) =>
              KEPT_ROOT_FIELDS.test(field)
            )
          )
        : Object.fromEntries(
            Object.entries(value).filter(
              ([field]) => !DROPPED_FIELDS[String(value.__typename)]?.has(field)
            )
          )
  }
  const book = Object.values(state).find(
    v => isRecord(v) && v.__typename === 'Book' && String(v.legacyId) === id
  )
  if (!book) throw new Error(`no Book with legacyId ${id} in the book page`)

  const fixture = {
    ...Object.fromEntries(
      Object.entries(data).filter(([key]) => KEPT_TOP_LEVEL.has(key))
    ),
    props: {
      pageProps: {
        ...Object.fromEntries(
          Object.entries(pageProps).filter(([key]) => KEPT_PAGE_PROPS.has(key))
        ),
        apolloState: state,
      },
    },
  }
  // Pretty-printed so a refresh diffs line by line; `<` escaped as Next.js does, so the JSON can't
  // end the script element early.
  const json = JSON.stringify(fixture, null, 2).replace(/</g, '\\u003c')
  // Fail closed: a reference to a user, or anything findPersonalData knows, means the page changed
  // shape and the filters above no longer cover it.
  const leaks = [
    ...findPersonalData(json, { greeting: false }),
    ...(/"User:\d+"/.test(json) ? ['reference to a User entity'] : []),
  ]
  if (leaks.length) {
    throw new Error(
      `book page still has personal data: ${leaks.slice(0, 3).join('; ')}`
    )
  }
  return `<script id="__NEXT_DATA__" type="application/json">\n${json}\n</script>\n`
}
