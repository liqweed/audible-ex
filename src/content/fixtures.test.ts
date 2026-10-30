/**
 * The content script on the saved Audible pages (test/fixtures/audible, ARCHITECTURE.md §10): each
 * page type of both marketplaces gets its cards found, one badge each, in the userscript's place.
 *
 * What "every card" means here, stated independently of the code under test:
 * - the ASINs looked up are exactly the unique ASINs of the page's `/pd/` links outside the header,
 *   navigation and footer;
 * - a card is what the userscript's `cardFor` finds (copied into test/userscript-oracle.ts) and
 *   carries exactly one badge outside its hover popover. One book can legitimately be on a page
 *   twice (a carousel and a grid, the daily deal and its carousel), and each card gets its badge;
 * - each card's popover that has a title gets one more badge, inside the popover.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asinFromHref } from '@/core/asin'
import {
  failed,
  loadFixture,
  type Marketplace,
  mainBadges,
  notFound,
  ready,
  startWorld,
  type World,
} from '../../test/content-harness'
import { type OracleCard, runOracle } from '../../test/userscript-oracle'

const PAGES = ['home', 'search', 'category', 'deals'] as const
const PATHS: Record<(typeof PAGES)[number], string> = {
  home: '/',
  search: '/search',
  category: '/cat/Science-Fiction-Fantasy-Audiobooks/19378',
  deals: '/ep/audiobook-deals',
}
const HOSTS: Record<Marketplace, string> = {
  uk: 'www.audible.co.uk',
  com: 'www.audible.com',
}
/**
 * Cards that show no title text, so the userscript (and the extension) fall back: the home pages'
 * hero and featured slides link the book from the cover only (placed at the card's end), and three
 * category cards have their title only in the popover (placed before it).
 */
const FALLBACKS: Record<string, { cardEnd: number; beforePopover: number }> = {
  'uk/home': { cardEnd: 1, beforePopover: 0 },
  'com/home': { cardEnd: 17, beforePopover: 0 },
  'com/category': { cardEnd: 0, beforePopover: 3 },
}
const NAV = 'header, nav, footer, [role="navigation"]'

/** The real titles of the three books per marketplace in catalog.json. */
function catalogTitles(marketplace: Marketplace): Map<string, string> {
  const file = join(
    import.meta.dir,
    '../../test/fixtures/audible',
    marketplace,
    'catalog.json'
  )
  const json = JSON.parse(readFileSync(file, 'utf8')) as {
    products: Array<{ asin: string; title?: string }>
  }
  return new Map(
    json.products.flatMap(p => (p.title ? [[p.asin, p.title] as const] : []))
  )
}

/**
 * The userscript's catalogue title, as far as the page can tell: the real one for the ASINs in
 * catalog.json, else what the card shows (its title link, else the heading of its popover).
 */
function titleFor(marketplace: Marketplace) {
  const catalog = catalogTitles(marketplace)
  return (card: Element, asin: string) => {
    const real = catalog.get(asin)
    if (real) return real
    const link = [...card.querySelectorAll(`a[href*="${asin}"]`)].find(
      a => !a.closest('.bc-popover') && a.textContent?.trim()
    )
    if (link) return (link.textContent ?? '').replace(/\s+/g, ' ').trim()
    return (
      card
        .querySelector('.bc-popover h1, .bc-popover h2, .bc-popover h3')
        ?.textContent?.trim() ?? ''
    )
  }
}

const outerOf = (badge: Element) => {
  const wrap = badge.closest('.agx-wrap') as Element
  return wrap.closest('.agx-li') ?? wrap
}

describe.each(['uk', 'com'] as const)(
  'badges on the %s fixtures',
  marketplace => {
    describe.each([...PAGES])('%s', page => {
      let world: World
      let oracle: OracleCard[]

      beforeEach(() => {
        loadFixture(marketplace, page)
        oracle = runOracle(titleFor(marketplace))
        world = startWorld({
          hostname: HOSTS[marketplace],
          pathname: PATHS[page],
        })
        world.io.intersect()
      })

      test('finds cards on the page', () => {
        expect(oracle.length).toBeGreaterThanOrEqual(15)
      })

      test('looks up the ASINs of the page, and only those', () => {
        const linked = new Set(
          [...document.querySelectorAll('a[href*="/pd/"]')]
            .filter(a => !a.closest(NAV))
            .map(a => asinFromHref(a.getAttribute('href')))
            .filter((asin): asin is string => asin !== undefined)
        )
        const looked = world.port.lookups().flat()
        expect(new Set(looked)).toEqual(linked)
        expect(looked.length).toBe(linked.size)
      })

      test('sends Hello first, with the region and the page kind', () => {
        expect(world.port.sent[0]).toEqual({
          _tag: 'Hello',
          region: marketplace === 'uk' ? 'UK' : 'US',
          page: page === 'category' ? 'category' : page,
        })
        expect(world.port.sent).toHaveLength(2)
      })

      test('puts exactly one badge outside the popover on every card', () => {
        for (const { card, asin } of oracle) {
          expect(mainBadges(card), `${asin}`).toHaveLength(1)
        }
        expect(mainBadges()).toHaveLength(oracle.length)
      })

      test('puts no badge in the header, navigation or footer', () => {
        expect(document.querySelectorAll('.agx-badge').length).toBeGreaterThan(
          0
        )
        for (const area of document.querySelectorAll(NAV)) {
          expect(
            area.querySelectorAll('.agx-badge, .agx-wrap, .agx-li')
          ).toHaveLength(0)
        }
      })

      test('puts one badge in each popover that has a title, and none elsewhere', () => {
        for (const { card, popovers } of oracle) {
          for (const popover of card.querySelectorAll('.bc-popover')) {
            const expected = popovers.some(p => p.popover === popover) ? 1 : 0
            expect(popover.querySelectorAll('.agx-badge')).toHaveLength(
              expected
            )
          }
        }
        const inPopovers = document.querySelectorAll(
          '.bc-popover .agx-badge'
        ).length
        expect(inPopovers).toBe(
          oracle.reduce((n, o) => n + o.popovers.length, 0)
        )
        if (page === 'search' || page === 'deals')
          expect(inPopovers).toBeGreaterThanOrEqual(15)
      })

      test("places each badge where the userscript's would be", () => {
        const different = oracle.flatMap(({ card, asin, main, popovers }) => {
          const ours = outerOf(mainBadges(card)[0] as Element)
          const problems: string[] = []
          if (ours.parentElement !== main.parent) problems.push('parent')
          if (ours.previousElementSibling !== main.previous)
            problems.push('previous sibling')
          for (const { popover, placement } of popovers) {
            const badge = popover.querySelector('.agx-badge') as Element
            const theirs = outerOf(badge)
            if (theirs.parentElement !== placement.parent)
              problems.push('popover parent')
            if (theirs.previousElementSibling !== placement.previous)
              problems.push('popover previous sibling')
          }
          return problems.length ? [`${asin}: ${problems.join(', ')}`] : []
        })
        expect(different).toEqual([])
      })

      test('draws a rating on every badge of a book, once', () => {
        const asins = new Set(world.port.lookups().flat())
        for (const asin of asins) {
          world.port.receive(ready(asin, { r: 4.25, n: 12_345 }))
          world.port.receive(
            ready(
              asin,
              { r: 4.25, n: 12_345 },
              {
                genres: ['Fantasy', 'Audiobook', 'Adult', 'Romance'],
                year: 2021,
              }
            )
          )
          // the same details twice: no second year or label
          world.port.receive(
            ready(
              asin,
              { r: 4.25, n: 12_345 },
              {
                genres: ['Fantasy', 'Audiobook', 'Adult', 'Romance'],
                year: 2021,
              }
            )
          )
        }
        const badges = [...document.querySelectorAll('.agx-badge')]
        expect(badges.length).toBeGreaterThan(0)
        for (const badge of badges) {
          expect(badge.textContent).toBe('★ 4.25 (12k)')
          expect(badge.classList.contains('agx-hi')).toBe(true)
          const wrap = badge.closest('.agx-wrap') as Element
          expect(wrap.querySelectorAll('.agx-year')).toHaveLength(1)
          expect(
            [...wrap.querySelectorAll('.agx-label')].map(l => l.textContent)
          ).toEqual(['Fantasy', 'Romance'])
        }
      })

      test('draws not found and failed on every badge of a book', () => {
        const [first, second] = [...new Set(world.port.lookups().flat())]
        world.port.receive(notFound(first as string))
        world.port.receive(failed(second as string))
        const texts = (asin: string) =>
          oracle
            .filter(o => o.asin === asin)
            .flatMap(o => [...o.card.querySelectorAll('.agx-badge')])
            .map(b => b.textContent)
        expect(new Set(texts(first as string))).toEqual(
          new Set(['GR: not found'])
        )
        expect(new Set(texts(second as string))).toEqual(new Set(['GR: retry']))
      })

      test('cards with no title element take the userscript fallback', () => {
        const how = (kind: string) =>
          oracle.filter(o => o.main.how === kind).length
        expect({
          cardEnd: how('card-end'),
          beforePopover: how('before-popover'),
        }).toEqual(
          FALLBACKS[`${marketplace}/${page}`] ?? {
            cardEnd: 0,
            beforePopover: 0,
          }
        )
      })
    })
  }
)
