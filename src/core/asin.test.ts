import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asinFromHref } from '@/core/asin'

// ---------- the real pages ----------

const ROOT = join(import.meta.dir, '../../test/fixtures/audible')
const MARKETPLACES = ['uk', 'com'] as const

/** Every href on the page that contains `/pd/`, exactly as the HTML has it. */
const pdLinks = (marketplace: string) =>
  readdirSync(join(ROOT, marketplace))
    .filter(name => name.endsWith('.html'))
    .flatMap(name => {
      const html = readFileSync(join(ROOT, marketplace, name), 'utf8')
      return [...html.matchAll(/href="([^"]*)"/g)]
        .map(m => m[1] as string)
        .filter(href => href.includes('/pd/'))
        .map(href => ({ page: `${marketplace}/${name}`, href }))
    })

/**
 * The shape of a product link: the ASIN and slug replaced by placeholders, the query reduced to its
 * parameter names (`&amp;` is how the HTML spells `&`).
 */
const form = (href: string) => {
  const [path = '', query] = href.split('?')
  const shape = path
    .replace(/^\/pd\/[^/]+\/[A-Z0-9]{10}$/, '/pd/<slug>/<ASIN>')
    .replace(/^\/pd\/[A-Z0-9]{10}$/, '/pd/<ASIN>')
  if (query === undefined) return shape
  const names = query.split(/&amp;|&/).map(p => p.split('=')[0])
  return `${shape}?${names.join('&')}`
}

describe('product links on the saved Audible pages', () => {
  for (const marketplace of MARKETPLACES) {
    const links = pdLinks(marketplace)

    test(`audible.${marketplace}: there are many /pd/ links to read`, () => {
      expect(links.length).toBeGreaterThan(100)
    })

    test(`audible.${marketplace}: every /pd/ link yields a 10-character ASIN`, () => {
      for (const { page, href } of links) {
        const asin = asinFromHref(href)
        expect(asin, `${page}: ${href}`).toMatch(/^[A-Z0-9]{10}$/)
      }
    })

    test(`audible.${marketplace}: the ASIN is the last path segment, before any ?ref=`, () => {
      for (const { href } of links) {
        const path = href.split(/[?#]/)[0] as string
        expect(path.endsWith(`/${asinFromHref(href)}`), href).toBe(true)
      }
    })

    test(`audible.${marketplace}: only the known link forms occur`, () => {
      // Seen: `/pd/<slug>/<ASIN>?ref=…` (most cards), the same with `intent=discovery` ahead of
      // `ref` (search results), and `/pd/<ASIN>?ref=…` (a daily-deal link without a slug). The
      // fixtures hold no `#fragment`, trailing slash or absolute URL; the hand-written cases below
      // cover those.
      const forms = new Set(links.map(l => form(l.href)))
      expect([...forms].sort()).toEqual([
        '/pd/<ASIN>?ref',
        '/pd/<slug>/<ASIN>?intent&ref',
        '/pd/<slug>/<ASIN>?ref',
      ])
    })
  }
})

// ---------- hand-written links ----------

// Expected values were produced by the userscript's own `ASIN_RE` and `asinOf` (L57, L437) run on
// each input; none comes from this module.
describe('asinFromHref', () => {
  const ASIN = 'B002V0QK4C'

  test.each([
    ['with a title slug', `/pd/Dune-Audiobook/${ASIN}`],
    ['without a title slug', `/pd/${ASIN}`],
    ['with a ?ref= query', `/pd/Slug/${ASIN}?ref=pd_x`],
    [
      'with intent and ref parameters',
      `/pd/Slug/${ASIN}?intent=discovery&ref=a_search_c3_lProduct_1_2`,
    ],
    ['without a slug, with a ?ref= query', `/pd/${ASIN}?ref=a_ep`],
    ['with a #fragment', `/pd/Slug/${ASIN}#reviews`],
    ['without a slug, with a #fragment', `/pd/${ASIN}#reviews`],
    ['with a trailing slash', `/pd/Slug/${ASIN}/`],
    ['without a slug, with a trailing slash', `/pd/${ASIN}/`],
    ['with a trailing slash and a query', `/pd/Slug/${ASIN}/?ref=x`],
    ['with a further path segment', `/pd/Slug/${ASIN}/extra`],
    ['as an absolute URL', `https://www.audible.co.uk/pd/Slug/${ASIN}?ref=a`],
    ['as a protocol-relative URL', `//www.audible.com/pd/Slug/${ASIN}`],
    ['with a percent-encoded slug', `/pd/Slug%20Name/${ASIN}`],
    [
      'with other ASINs later in the query',
      `/pd/Slug-Name/${ASIN}?ref=a&x=B00G0WYW92`,
    ],
    ['with leading whitespace', ` /pd/${ASIN}`],
  ])('finds the ASIN %s', (_what, href) => {
    expect(asinFromHref(href)).toBe(ASIN)
  })

  test('an ASIN made of digits only is still an ASIN', () => {
    expect(asinFromHref('/pd/Slug/1234567890')).toBe('1234567890')
    expect(asinFromHref('/pd/1234567890')).toBe('1234567890')
  })

  test('takes the segment after the slug when the slug is itself ten characters', () => {
    // Quirk kept from the userscript: the slug is optional, so a ten-character uppercase slug with
    // no ASIN after it is read as the ASIN, and the segment after a slug wins over the slug.
    expect(asinFromHref('/pd/ABCDEFGHIJ')).toBe('ABCDEFGHIJ')
    expect(asinFromHref('/pd/ABCDEFGHIJ/KLMNOPQRST')).toBe('KLMNOPQRST')
    expect(asinFromHref(`/pd/B002V0QK4/${ASIN}`)).toBe(ASIN)
  })

  test.each([
    ['a 9-character id', '/pd/Slug/B002V0QK4'],
    ['an 11-character id', '/pd/Slug/B002V0QK4CD'],
    ['a lowercase id', '/pd/Slug/b002v0qk4c'],
    ['an id with a space in it', '/pd/Slug/B002V0 K4C'],
    ['an id followed by more word characters', `/pd/Slug/${'B002V0QK4C'}-x`],
    ['an id followed by an underscore', `/pd/Slug/${'B002V0QK4C'}_`],
    ['an encoded space after the id', `/pd/Slug/${'B002V0QK4C'}%20`],
    ['an author link, even with an ASIN in it', '/author/Andy-Weir/B00G0WYW92'],
    [
      'a series link, even with an ASIN in it',
      '/series/The-Stormlight-Archive/B07B7DWP6T',
    ],
    ['a podcast link', '/podcast/Show/B002V0QK4C'],
    ['a search link carrying an ASIN', '/search?keywords=B002V0QK4C'],
    ['a /pd/ link with a slug and nothing else', '/pd/Slug/'],
    [
      'a slug and a further segment before the ASIN',
      '/pd/Slug/Another/B002V0QK4C',
    ],
    ['a bare /pd/', '/pd/'],
    ['/pd without a slash', '/pd'],
    ['a path without the leading slash', 'pd/Slug/B002V0QK4C'],
    ['upper-case /PD/', '/PD/Slug/B002V0QK4C'],
    ['the root', '/'],
    ['the empty string', ''],
  ])('finds no ASIN in %s', (_what, href) => {
    expect(asinFromHref(href)).toBeUndefined()
  })

  test('a missing href has no ASIN (getAttribute("href") is null on an anchor without one)', () => {
    expect(asinFromHref(null)).toBeUndefined()
    expect(asinFromHref(undefined)).toBeUndefined()
  })
})
