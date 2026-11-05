/**
 * The book a product page (`/pd/…`) is about. The page never links to it: Audible draws it as an
 * `adbl-product-hero` whose title, cover and buy box sit in named slots, as saved from
 * audible.co.uk/pd/Gough-Whitlam-Audiobook/B0F55GZBGQ (2026-11-05). The extension takes the ASIN from
 * the address, badges the hero after its title lockup, and never filters it.
 */
import { describe, expect, test } from 'bun:test'
import type { FilterSettings } from '@/core/filter'
import { DEFAULT_FILTERS } from '@/storage/prefs'
import {
  FakeFilters,
  loadBody,
  mainBadges,
  ready,
  startWorld,
} from '../../test/content-harness'
import { currentHandle } from './shared'

const ASIN = 'B0F55GZBGQ'
const PATH = `/pd/Gough-Whitlam-Audiobook/${ASIN}`

const FILTERS: FilterSettings = {
  ...DEFAULT_FILTERS,
  minRatings: 0,
  highlightRating: 3,
}

const HERO = `
  <adbl-page><div id="adbl-main"><div id="center-1">
    <adbl-product-hero>
      <adbl-color-splash slot="background"></adbl-color-splash>
      <adbl-product-image slot="image">
        <img src="https://m.media-amazon.com/images/I/51i+ZWD0YTL._SL500_.jpg" alt="Gough Whitlam cover art">
      </adbl-product-image>
      <adbl-title-lockup slot="title-lockup">
        <h1 slot="title">Gough Whitlam</h1>
        <h2 slot="subtitle">The Vista of the New</h2>
      </adbl-title-lockup>
      <adbl-product-metadata slot="metadata"></adbl-product-metadata>
      <div slot="buybox">Buy Now for £3.99</div>
    </adbl-product-hero>
  </div></div></adbl-page>`

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

async function open(html = HERO, pathname = PATH) {
  loadBody(html)
  const world = startWorld({
    hostname: 'www.audible.co.uk',
    pathname,
    filters: new FakeFilters(FILTERS),
  })
  await flush()
  world.io.intersect()
  return world
}

describe('the hero of a product page', () => {
  test('is a card for the page address’s ASIN and is looked up', async () => {
    const world = await open()
    expect(world.port.lookups().flat()).toEqual([ASIN])
    expect(mainBadges()).toHaveLength(1)
    world.content?.remove()
  })

  test('gets its badge after the title lockup, in the lockup’s slot, so it is drawn', async () => {
    const world = await open()
    const lockup = document.querySelector('adbl-title-lockup') as Element
    const wrap = lockup.nextElementSibling as HTMLElement
    expect(wrap.className).toBe('agx-wrap')
    expect(wrap.getAttribute('slot')).toBe('title-lockup')
    expect(wrap.parentElement?.tagName).toBe('ADBL-PRODUCT-HERO')
    expect(lockup.querySelector('.agx-wrap')).toBeNull()
    world.content?.remove()
  })

  test('shows the rating', async () => {
    const world = await open()
    world.port.receive(ready(ASIN, { r: 4.4, n: 900 }))
    expect(mainBadges()[0]?.textContent).toContain('4.40')
    world.content?.remove()
  })

  test('is never hidden or dimmed, whatever its rating, but is highlighted', async () => {
    const world = await open()
    world.port.receive(ready(ASIN, { r: 3.2, n: 900 }))
    const hero = document.querySelector('adbl-product-hero') as Element
    expect(hero.hasAttribute('data-agx-filter')).toBe(false)
    expect(hero.hasAttribute('data-agx-highlight')).toBe(true)
    world.content?.remove()
  })

  test('is not counted as hidden or dimmed', async () => {
    const world = await open()
    world.port.receive(ready(ASIN, { r: 2, n: 900 }))
    const { hidden, dimmed } = currentHandle()?.filter.get() ?? {}
    expect([hidden, dimmed]).toEqual([0, 0])
    world.content?.remove()
  })

  test('is not a card on a page that is not its own product page', async () => {
    const world = await open(HERO, '/search')
    expect(mainBadges()).toHaveLength(0)
    world.content?.remove()
  })

  test('does not double the badge when a link to the book surrounds it', async () => {
    const world = await open(`<div><a href="${PATH}">Listen</a>${HERO}</div>`)
    expect(mainBadges()).toHaveLength(1)
    world.content?.remove()
  })
})
