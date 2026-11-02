/**
 * The content script on the saved signed-in pages (library.html and
 * wishlist.html under test/fixtures/audible, captured by hand). Their rows are the user's own books: they are pinned, each row
 * is its own card with one badge, and cards that are not rows (the recommendations on the library
 * page) are looked up but not pinned. Placement is compared with the userscript's, as for the
 * public pages in fixtures.test.ts.
 *
 * `.com` has no library fixture: that account has no titles (test/fixtures/README.md).
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { asinFromHref } from '@/core/asin'
import {
  loadFixture,
  type Marketplace,
  mainBadges,
  notFound,
  ready,
  startWorld,
  type World,
} from '../../test/content-harness'
import { type OracleCard, runOracle } from '../../test/userscript-oracle'

const ROW = 'li.productListItem, [id^="adbl-library-content-row-"]'
const HOSTS: Record<Marketplace, string> = {
  uk: 'www.audible.co.uk',
  com: 'www.audible.com',
}

interface Case {
  readonly marketplace: Marketplace
  readonly page: 'library' | 'wishlist'
  readonly pathname: string
  readonly rows: number
  /** Cards on the page that are not list rows. */
  readonly others: number
}

const CASES: Case[] = [
  {
    marketplace: 'uk',
    page: 'library',
    pathname: '/library/titles',
    rows: 20,
    others: 20,
  },
  {
    marketplace: 'uk',
    page: 'wishlist',
    pathname: '/library/wishlist',
    rows: 20,
    others: 0,
  },
  {
    marketplace: 'com',
    page: 'wishlist',
    pathname: '/library/wishlist',
    rows: 1,
    others: 0,
  },
]

const asinsOf = (el: Element) =>
  new Set(
    [...el.querySelectorAll('a[href*="/pd/"]')]
      .map(a => asinFromHref(a.getAttribute('href')))
      .filter((asin): asin is string => asin !== undefined)
  )

/** What the content script asked for, as `asin → pinned` (a repeat counts as pinned if any is). */
const lookedUp = (world: World) => {
  const items = new Map<string, boolean>()
  for (const message of world.port.sent) {
    if (message._tag !== 'Lookup') continue
    for (const { asin, pinned } of message.items as Array<{
      asin: string
      pinned: boolean
    }>) {
      items.set(asin, pinned || items.get(asin) === true)
    }
  }
  return items
}

/** The title the card shows: its title link, else the heading of its popover (no catalogue here). */
const titleOf = (card: Element, asin: string) => {
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

const outerOf = (badge: Element) => {
  const wrap = badge.closest('.agx-wrap') as Element
  return wrap.closest('.agx-li') ?? wrap
}

describe.each(CASES)('badges on the $marketplace $page fixture', c => {
  let world: World
  let oracle: OracleCard[]

  beforeEach(() => {
    loadFixture(c.marketplace, c.page)
    oracle = runOracle(titleOf)
    world = startWorld({
      hostname: HOSTS[c.marketplace],
      pathname: c.pathname,
    })
    world.io.intersect()
  })

  test('has the rows the fixture was captured with, one book each', () => {
    const rows = [...document.querySelectorAll(ROW)]
    expect(rows).toHaveLength(c.rows)
    for (const row of rows) expect(asinsOf(row).size).toBe(1)
  })

  test('says Hello with the page kind, then asks for the books', () => {
    expect(world.port.sent[0]).toEqual({
      _tag: 'Hello',
      region: c.marketplace === 'uk' ? 'UK' : 'US',
      page: c.page,
    })
    expect(world.port.sent[1]?._tag).toBe('Lookup')
  })

  test('pins the ASIN of every row, and no other card', () => {
    const rowAsins = new Set(
      [...document.querySelectorAll(ROW)].flatMap(row => [...asinsOf(row)])
    )
    const items = lookedUp(world)
    for (const asin of rowAsins) expect(items.get(asin), asin).toBe(true)
    const others = [...items].filter(([asin]) => !rowAsins.has(asin))
    expect(others).toHaveLength(c.others)
    for (const [asin, pinned] of others) expect(pinned, asin).toBe(false)
  })

  test('treats each row as its card, with one badge outside the popover', () => {
    expect(oracle.length).toBe(c.rows + c.others)
    for (const row of document.querySelectorAll(ROW)) {
      expect(oracle.some(o => o.card === row)).toBe(true)
    }
    for (const { card, asin } of oracle) {
      expect(mainBadges(card), asin).toHaveLength(1)
    }
    expect(mainBadges()).toHaveLength(oracle.length)
  })

  test("places each badge where the userscript's would be", () => {
    const different = oracle.flatMap(({ card, asin, main, popovers }) => {
      const ours = outerOf(mainBadges(card)[0] as Element)
      const problems: string[] = []
      if (ours.parentElement !== main.parent) problems.push('parent')
      if (ours.previousElementSibling !== main.previous)
        problems.push('previous sibling')
      for (const { popover, placement } of popovers) {
        const theirs = outerOf(popover.querySelector('.agx-badge') as Element)
        if (theirs.parentElement !== placement.parent)
          problems.push('popover parent')
        if (theirs.previousElementSibling !== placement.previous)
          problems.push('popover previous sibling')
      }
      return problems.length ? [`${asin}: ${problems.join(', ')}`] : []
    })
    expect(different).toEqual([])
  })

  test('puts a badge in the popover of every card that has one', () => {
    const popovers = oracle.reduce((n, o) => n + o.popovers.length, 0)
    expect(document.querySelectorAll('.bc-popover .agx-badge')).toHaveLength(
      popovers
    )
  })

  test('draws a rating on every badge of a book, and not found on another', () => {
    const [first, second] = [...lookedUp(world).keys()] as [string, string?]
    world.port.receive(ready(first, { r: 4.25, n: 12_345 }))
    if (second) world.port.receive(notFound(second))
    const texts = (asin: string) =>
      oracle
        .filter(o => o.asin === asin)
        .flatMap(o => [...o.card.querySelectorAll('.agx-badge')])
        .map(b => b.textContent)
    expect(new Set(texts(first))).toEqual(new Set(['★ 4.25 (12k)']))
    if (second)
      expect(new Set(texts(second))).toEqual(new Set(['GR: not found']))
  })
})
