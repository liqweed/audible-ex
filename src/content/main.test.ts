/**
 * The content script's behaviour on small hand-written pages: what the saved Audible pages cannot
 * show on their own (late cards, shared ASINs, retry, pinned rows, reconnect, navigation links).
 * The saved library and wish list pages are tested in library-fixtures.test.ts; the rows below are
 * small hand-written ones for cases those pages do not hold.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import {
  failed,
  loadBody,
  loading,
  mainBadges,
  notFound,
  ready,
  startWorld,
} from '../../test/content-harness'
import { currentHandle, watchHandle } from './shared'

const A = 'B000000001'
const B = 'B000000002'
const C = 'B000000003'
const D = 'B000000004'

/** A card in the grid style: a cover link and a title link in a heading. */
const card = (asin: string, title = `Title ${asin}`) =>
  `<div class="card" data-card="${asin}">
     <a href="/pd/${title.replace(/\W+/g, '-')}/${asin}?ref=x"><img alt="${title} cover art"></a>
     <h3><a href="/pd/${title.replace(/\W+/g, '-')}/${asin}?ref=x">${title}</a></h3>
   </div>`

const settle = () => new Promise(resolve => setTimeout(resolve, 5))
const find = (asin: string) =>
  document.querySelector(`[data-card="${asin}"]`) as Element
const texts = (asin: string) =>
  [...find(asin).querySelectorAll('.agx-badge')].map(b => b.textContent)

describe('starting', () => {
  test('does nothing on a site that is not Audible', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld({ hostname: 'www.example.com' })
    expect(world.content).toBeUndefined()
    expect(world.ports).toHaveLength(0)
    expect(world.io.observed.size).toBe(0)
    expect(document.querySelector('style, .agx-badge')).toBeNull()
  })

  test('injects the stylesheet once, even if the script starts twice', () => {
    loadBody(`<main>${card(A)}</main>`)
    startWorld()
    startWorld()
    expect(document.querySelectorAll('style#agx-style')).toHaveLength(1)
  })

  test('connects only when a card needs a lookup, and watches with a 400 px margin', () => {
    loadBody(`<main>${card(A)}${card(B)}</main>`)
    const world = startWorld()
    expect(world.ports).toHaveLength(0)
    expect(world.io.rootMargin).toBe('400px 0px')
    expect(world.io.observed.size).toBe(2)
  })
})

describe('looking up what comes into view', () => {
  test('looks up only the cards that intersect, in one Lookup per batch', () => {
    loadBody(`<main>${card(A)}${card(B)}${card(C)}</main>`)
    const world = startWorld()
    world.io.intersect([find(A), find(B)])
    expect(world.port.lookups()).toEqual([[A, B]])
    expect(texts(C)).toEqual([])
    expect(world.io.observed.size).toBe(1)
    world.io.leave([find(C)])
    expect(world.ports[0]?.lookups()).toEqual([[A, B]])
    world.io.intersect([find(C)])
    expect(world.port.lookups()).toEqual([[A, B], [C]])
  })

  test('a card gets a waiting badge until the background answers', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    expect(texts(A)).toEqual(['GR …'])
    world.port.receive(loading(A))
    expect(texts(A)).toEqual(['GR …'])
    world.port.receive(ready(A, { r: 3.5, n: 1_500_000 }))
    expect(texts(A)).toEqual(['★ 3.50 (1.5M)'])
  })

  test('places the badge after the title heading, as a link that opens a new tab', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    const wrap = find(A).querySelector('h3 + .agx-wrap')
    expect(wrap).not.toBeNull()
    const badge = wrap?.querySelector('a') as HTMLAnchorElement
    expect(badge.target).toBe('_blank')
    expect(badge.rel).toBe('noopener')
  })

  test('a click on the badge does not reach the card', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(ready(A, { r: 4, n: 10 }))
    let reached = 0
    find(A).addEventListener('click', () => reached++)
    ;(mainBadges()[0] as HTMLElement).click()
    expect(reached).toBe(0)
  })

  test('the badge links to the Goodreads book and renders the details once', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(ready(A, { r: 4.21, n: 12_345 }))
    const badge = mainBadges()[0] as HTMLAnchorElement
    expect(badge.href).toBe(`https://www.goodreads.com/book/show/${A}`)
    expect(find(A).querySelector('.agx-year')).toBeNull()
    const details = {
      genres: ['Fantasy', 'Audiobook', 'Epic', 'Magic', 'Dragons'],
      year: 1996,
    }
    world.port.receive(ready(A, { r: 4.21, n: 12_345 }, details))
    world.port.receive(ready(A, { r: 4.21, n: 12_345 }, details))
    expect(find(A).querySelectorAll('.agx-year')).toHaveLength(1)
    expect(find(A).querySelector('.agx-year')?.textContent).toBe('1996')
    expect(
      [...find(A).querySelectorAll('.agx-label')].map(l => l.textContent)
    ).toEqual(['Fantasy', 'Epic', 'Magic'])
  })

  test('keeps the details of the book for the overview', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(
      ready(
        A,
        { r: 4, n: 10 },
        { genres: ['Fantasy'], year: 0, desc: 'About the book.' }
      )
    )
    expect(world.content?.books.get(A)?.details).toEqual({
      genres: ['Fantasy'],
      year: 0,
      desc: 'About the book.',
    })
    expect(find(A).querySelector('.agx-year')).toBeNull()
  })

  test('not found links to a Goodreads search for the title on the page', () => {
    loadBody(`<main>${card(A, 'The Hobbit')}</main>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(notFound(A))
    const badge = mainBadges()[0] as HTMLAnchorElement
    expect(badge.textContent).toBe('GR: not found')
    expect(badge.href).toBe('https://www.goodreads.com/search?q=The%20Hobbit')
  })

  test('keeps a Progress message in the store and draws nothing for it', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    const progress = {
      queued: 1,
      active: 0,
      done: 0,
      cached: 0,
      notFound: 0,
      failed: 0,
      pausedUntil: 5_000,
    }
    world.port.receive({ _tag: 'Progress', ...progress })
    expect(world.content?.books.state.get().progress).toEqual(progress)
    expect(texts(A)).toEqual(['GR …'])
  })

  test('ignores an update for a book it has no card for', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(ready('B0ZZZZZZZZ', { r: 4, n: 1 }))
    expect(texts(A)).toEqual(['GR …'])
  })
})

describe('the hover overview', () => {
  const hover = (badge: Element) =>
    badge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  const tip = () =>
    document
      .querySelector('.agx-overview-host')
      ?.shadowRoot?.querySelector('.tip') ?? null

  test('shows the overview of the book under a badge, and a year that came later', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    const rating = { r: 4.21, n: 12_345 }
    world.port.receive(
      ready(A, rating, { genres: ['Fantasy'], year: 0, desc: 'The story.' })
    )
    const badge = mainBadges()[0] as Element
    // The overview replaces the plain tooltip.
    expect(badge.getAttribute('title')).toBeNull()
    hover(badge)
    expect(tip()?.textContent).toContain('The story.')
    expect(tip()?.textContent).not.toContain('first published')

    badge.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    world.port.receive(
      ready(A, rating, { genres: ['Fantasy'], year: 1996, desc: 'The story.' })
    )
    hover(mainBadges()[0] as Element)
    expect(tip()?.textContent).toContain('first published 1996')
  })

  test('a book without an overview keeps the plain tooltip and shows no box', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(ready(A, { r: 4, n: 10 }))
    const badge = mainBadges()[0] as Element
    expect(badge.getAttribute('title')).toContain('Goodreads: 4.00')
    hover(badge)
    expect(tip()).toBeNull()
  })

  test('the host is not mistaken for a card, and stop takes it away', async () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(
      ready(A, { r: 4, n: 10 }, { genres: [], year: 0, desc: 'Text' })
    )
    hover(mainBadges()[0] as Element)
    await settle()
    world.timers.runAll()
    expect(world.io.observed.size).toBe(0)
    world.content?.stop()
    expect(document.querySelector('.agx-overview-host')).toBeNull()
  })
})

describe('one book on several cards', () => {
  test('asks once and updates every card', () => {
    loadBody(
      `<main>${card(A)}${card(B)}<section>${card(A)}${card(C)}</section></main>`
    )
    const world = startWorld()
    world.io.intersect()
    expect(world.port.lookups()).toEqual([[A, B, C]])
    world.port.receive(ready(A, { r: 4.5, n: 2000 }))
    const cardsOfA = document.querySelectorAll(`[data-card="${A}"]`)
    expect(cardsOfA).toHaveLength(2)
    for (const c of cardsOfA)
      expect(c.querySelector('.agx-badge')?.textContent).toBe('★ 4.50 (2k)')
    expect(texts(B)).toEqual(['GR …'])
  })

  test('a late card of a ready book shows the rating and asks only for new books', async () => {
    loadBody(`<main>${card(A)}${card(B)}</main><div id="more"></div>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(
      ready(A, { r: 4.5, n: 2000 }, { genres: ['Fantasy'], year: 2001 })
    )
    const sent = world.port.sent.length
    // another carousel shows the same book next to a new one
    document
      .getElementById('more')
      ?.insertAdjacentHTML('beforeend', card(C) + card(A))
    await settle()
    world.timers.runAll()
    world.io.intersect()
    expect(document.querySelectorAll(`[data-card="${A}"]`)).toHaveLength(2)
    for (const c of document.querySelectorAll(`[data-card="${A}"]`)) {
      expect(c.querySelector('.agx-badge')?.textContent).toBe('★ 4.50 (2k)')
      expect(c.querySelector('.agx-year')?.textContent).toBe('2001')
    }
    // only the new book C is asked for
    expect(world.port.sent.slice(sent)).toEqual([
      { _tag: 'Lookup', items: [{ asin: C, pinned: false }] },
    ])
  })
})

describe('navigation', () => {
  test('a book link in the header, a menu or the footer gets no badge and no lookup', () => {
    loadBody(`
      <header><a href="/pd/Menu-Pick/${D}">Menu pick</a></header>
      <nav><ul><li><a href="/pd/Nav-Pick/${C}">Nav pick</a></li></ul></nav>
      <div role="navigation"><a href="/pd/Role-Pick/${B}">Role pick</a></div>
      <main>${card(A)}</main>
      <footer><a href="/pd/Footer-Pick/${D}">Footer pick</a></footer>`)
    const world = startWorld()
    world.io.intersect()
    expect(world.port.lookups()).toEqual([[A]])
    expect(
      document.querySelectorAll(
        'header .agx-badge, nav .agx-badge, [role="navigation"] .agx-badge, footer .agx-badge'
      )
    ).toHaveLength(0)
    expect(document.querySelectorAll('.agx-badge')).toHaveLength(1)
  })

  test('a link to a book in the menu next to a card with the same book does not give the menu a badge', () => {
    loadBody(
      `<nav><a href="/pd/X/${A}">Featured: Title</a></nav><main>${card(A)}</main>`
    )
    const world = startWorld()
    world.io.intersect()
    expect(document.querySelectorAll('nav .agx-badge')).toHaveLength(0)
    expect(texts(A)).toEqual(['GR …'])
  })
})

describe('content added after load', () => {
  test('a card appended later gets a badge', async () => {
    loadBody(`<main id="list">${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    document.getElementById('list')?.insertAdjacentHTML('beforeend', card(B))
    await settle()
    // collected for 300 ms, then scanned
    expect(world.timers.pending).toEqual([300])
    expect(texts(B)).toEqual([])
    world.timers.runAll()
    expect(world.io.observed.has(find(B))).toBe(true)
    world.io.intersect()
    expect(texts(B)).toEqual(['GR …'])
    expect(world.port.lookups()).toEqual([[A], [B]])
    world.port.receive(ready(B, { r: 3, n: 5 }))
    expect(texts(B)).toEqual(['★ 3.00 (5)'])
    expect(mainBadges(find(B))[0]?.classList.contains('agx-lo')).toBe(true)
  })

  test('cards added together are scanned in one batch', async () => {
    loadBody('<main id="list"></main>')
    const world = startWorld()
    const list = document.getElementById('list') as Element
    list.insertAdjacentHTML('beforeend', card(A))
    list.insertAdjacentHTML('beforeend', card(B))
    await settle()
    expect(world.timers.pending).toEqual([300])
    world.timers.runAll()
    world.io.intersect()
    expect(world.port.lookups()).toEqual([[A, B]])
  })

  test('a root inside another added root is not scanned twice', async () => {
    loadBody('<main id="list"></main>')
    const world = startWorld()
    const section = document.createElement('section')
    section.innerHTML = `<div id="inner">${card(A)}</div>`
    document.getElementById('list')?.appendChild(section)
    section.querySelector('#inner')?.insertAdjacentHTML('beforeend', card(B))
    await settle()
    world.timers.runAll()
    expect(world.io.observed.size).toBe(2)
    world.io.intersect()
    expect(mainBadges()).toHaveLength(2)
  })

  test('its own badges do not start another scan', async () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(
      ready(A, { r: 4, n: 5 }, { genres: ['Fantasy'], year: 1999 })
    )
    await settle()
    expect(world.timers.pending).toEqual([])
  })

  test('more than 300 added roots rescan the body', async () => {
    loadBody('<main id="list"></main>')
    const world = startWorld()
    const list = document.getElementById('list') as Element
    const asin = (i: number) => `B${String(i).padStart(9, '0')}`
    for (let i = 1; i <= 301; i++)
      list.insertAdjacentHTML('beforeend', card(asin(i)))
    await settle()
    world.timers.runAll()
    expect(world.io.observed.size).toBe(301)
  })

  test('lets go of observed cards the page removed', async () => {
    loadBody(`<main id="list">${card(A)}${card(B)}</main>`)
    const world = startWorld()
    expect(world.io.observed.size).toBe(2)
    find(A).remove()
    await settle()
    world.timers.runAll()
    expect(world.io.observed.size).toBe(1)
    expect(world.io.observed.has(find(B))).toBe(true)
  })
})

describe('retry', () => {
  test('a failed lookup shows a retry badge; a click puts the badge back and sends Retry', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(failed(A, 'HTTP 503'))
    const retry = mainBadges()[0] as HTMLElement
    expect(retry.textContent).toBe('GR: retry')
    retry.click()
    expect(world.port.sent.at(-1)).toEqual({ _tag: 'Retry', asins: [A] })
    expect(texts(A)).toEqual(['GR …'])
    expect(find(A).querySelectorAll('.agx-wrap')).toHaveLength(1)
    expect(find(A).querySelector('h3 + .agx-wrap')).not.toBeNull()
    world.port.receive(ready(A, { r: 4, n: 99 }))
    expect(texts(A)).toEqual(['★ 4.00 (99)'])
  })

  test('retry removes the list item made for the badge and makes a new one', () => {
    loadBody(`<ul>
      <li class="productListItem" data-card="${A}"><ul>
        <li class="bc-list-item"><h3><a href="/pd/T/${A}">Title</a></h3></li>
        <li class="bc-list-item">By: someone</li></ul></li></ul>`)
    const world = startWorld()
    world.io.intersect()
    expect(find(A).querySelectorAll('li.agx-li')).toHaveLength(1)
    world.port.receive(failed(A))
    ;(mainBadges()[0] as HTMLElement).click()
    expect(find(A).querySelectorAll('li.agx-li')).toHaveLength(1)
    expect(find(A).querySelectorAll('.agx-wrap')).toHaveLength(1)
    expect(
      find(A)
        .querySelector('li.agx-li')
        ?.previousElementSibling?.querySelector('h3')
    ).not.toBeNull()
  })

  test('the other cards of the book wait too, and all show the answer', () => {
    loadBody(
      `<main>${card(A)}${card(B)}</main><section>${card(A)}${card(C)}</section>`
    )
    const world = startWorld()
    world.io.intersect()
    world.port.receive(failed(A))
    ;(mainBadges()[0] as HTMLElement).click()
    const ofA = () =>
      [...document.querySelectorAll(`[data-card="${A}"] .agx-badge`)].map(
        b => b.textContent
      )
    expect(ofA()).toEqual(['GR …', 'GR …'])
    world.port.receive(notFound(A))
    expect(ofA()).toEqual(['GR: not found', 'GR: not found'])
  })
})

describe('pinned rows', () => {
  const rows = `
    <div id="adbl-library-content-row-1" data-card="${A}"><a href="/pd/T/${A}">Library Title</a></div>
    <ul><li class="productListItem" data-card="${B}"><ul>
      <li class="bc-list-item big"><h3><a href="/pd/T/${B}">List Title</a></h3></li>
      <li class="bc-list-item">By: someone</li></ul></li></ul>
    <section class="recommendations">${card(C)}</section>`

  const pinnedOf = (world: ReturnType<typeof startWorld>) =>
    Object.fromEntries(
      world.port.sent
        .filter(m => m._tag === 'Lookup')
        .flatMap(m => m.items as Array<{ asin: string; pinned: boolean }>)
        .map(i => [i.asin, i.pinned])
    )

  test('on /library, list rows are pinned and recommendation cards are not', () => {
    loadBody(rows)
    const world = startWorld({ pathname: '/library/titles' })
    world.io.intersect()
    expect(pinnedOf(world)).toEqual({ [A]: true, [B]: true, [C]: false })
    expect(world.port.sent[0]).toEqual({
      _tag: 'Hello',
      region: 'UK',
      page: 'library',
    })
  })

  test('the Wish List under /library is pinned too', () => {
    loadBody(rows)
    const world = startWorld({ pathname: '/library/wishlist' })
    world.io.intersect()
    expect(pinnedOf(world)[A]).toBe(true)
    expect(world.port.sent[0]).toMatchObject({ page: 'wishlist' })
  })

  test('outside /library nothing is pinned, not even a list row', () => {
    loadBody(rows)
    const world = startWorld({ pathname: '/search' })
    world.io.intersect()
    expect(pinnedOf(world)).toEqual({ [A]: false, [B]: false, [C]: false })
  })

  test('library rows get their badge after the title; the row is the card', () => {
    loadBody(rows)
    const world = startWorld({ pathname: '/library/titles' })
    world.io.intersect()
    expect(find(A).querySelectorAll('.agx-badge')).toHaveLength(1)
    expect(find(B).querySelector('li.agx-li')?.className).toBe(
      'bc-list-item big agx-li'
    )
    expect(find(B).querySelectorAll('.agx-badge')).toHaveLength(1)
  })

  test('a row of a book already looked up from a carousel is sent again as pinned', () => {
    loadBody(`<section>${card(A)}</section>
      <div id="adbl-library-content-row-1" data-card="row"><a href="/pd/T/${A}">Title</a></div>`)
    const world = startWorld({ pathname: '/library/titles' })
    world.io.intersect([[...world.io.observed][0] as Element])
    world.port.receive(ready(A, { r: 4, n: 10 }, { genres: [], year: 0 }))
    world.io.intersect()
    expect(world.port.lookups()).toEqual([[A], [A]])
    expect(pinnedOf(world)).toEqual({ [A]: true })
    expect(
      (document.querySelector('[data-card="row"] .agx-badge') as Element)
        .textContent
    ).toBe('★ 4.00 (10)')
    // and only once
    world.io.intersect()
    expect(world.port.lookups()).toHaveLength(2)
  })
})

describe('when the background worker stops', () => {
  test('re-sends Hello and the ASINs with no answer, pinned as before, and no others', () => {
    loadBody(`
      <div id="adbl-library-content-row-1" data-card="${A}"><a href="/pd/T/${A}">One</a></div>
      <div id="adbl-library-content-row-2" data-card="${B}"><a href="/pd/T/${B}">Two</a></div>
      <div id="adbl-library-content-row-3" data-card="${C}"><a href="/pd/T/${C}">Three</a></div>
      <div id="adbl-library-content-row-4" data-card="${D}"><a href="/pd/T/${D}">Four</a></div>`)
    const world = startWorld({ pathname: '/library/titles' })
    world.io.intersect()
    // A is complete, B has its rating but no details, C is loading, D failed
    world.port.receive(ready(A, { r: 4, n: 10 }, { genres: [], year: 1 }))
    world.port.receive(ready(B, { r: 4, n: 10 }))
    world.port.receive(loading(C))
    world.port.receive(failed(D))
    world.port.drop()
    world.timers.runAll()
    expect(world.ports).toHaveLength(2)
    expect(world.port.sent).toEqual([
      { _tag: 'Hello', region: 'UK', page: 'library' },
      {
        _tag: 'Lookup',
        items: [{ asin: C, pinned: true }],
      },
    ])
    world.port.receive(ready(C, { r: 2, n: 3 }))
    expect(texts(C)).toEqual(['★ 2.00 (3)'])
  })

  test('a book whose details never came is not asked for again: no reconnect, no loop', () => {
    loadBody(`<main>${card(A)}${card(B)}</main>`)
    const world = startWorld()
    world.io.intersect()
    // the rating came, the details read failed (the background only logs that, and caches nothing)
    world.port.receive(ready(A, { r: 4, n: 10 }))
    world.port.receive(notFound(B))
    for (let cycle = 0; cycle < 5; cycle++) {
      world.port.drop() // the idle worker was stopped
      expect(world.timers.pending).toEqual([])
    }
    expect(world.ports).toHaveLength(1)
    expect(world.port.lookups()).toEqual([[A, B]])
  })

  test('a book with no answer at all is still asked for after the worker stops', () => {
    loadBody(`<main>${card(A)}${card(B)}</main>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(ready(A, { r: 4, n: 10 }))
    world.port.receive(loading(B))
    world.port.drop()
    expect(world.timers.pending).toEqual([100])
    world.timers.runAll()
    expect(world.port.lookups()).toEqual([[B]])
  })

  test('cards of books already known open no port', () => {
    loadBody(`<main>${card(A)}${card(B)}</main><div id="more"></div>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(ready(A, { r: 4, n: 10 }))
    world.port.receive(notFound(B))
    world.port.drop()
    document
      .getElementById('more')
      ?.insertAdjacentHTML('beforeend', card(A) + card(B))
    return settle().then(() => {
      world.timers.runAll()
      world.io.intersect()
      expect(world.ports).toHaveLength(1)
      expect(
        [...document.querySelectorAll('#more .agx-badge')].map(
          b => b.textContent
        )
      ).toEqual(['★ 4.00 (10)', 'GR: not found'])
    })
  })

  test('with everything answered it stays quiet until the next card comes into view', () => {
    loadBody(`<main id="list">${card(A)}${card(B)}</main>`)
    const world = startWorld()
    world.io.intersect([find(A)])
    world.port.receive(notFound(A))
    world.port.drop()
    expect(world.timers.pending).toEqual([])
    world.io.intersect()
    expect(world.ports).toHaveLength(2)
    expect(world.port.sent.map(m => m._tag)).toEqual(['Hello', 'Lookup'])
    expect(world.port.lookups()).toEqual([[B]])
  })
})

describe('the panel handle', () => {
  // The harness leaves the last test's script running; starting on a site that is not Audible
  // stops it and starts nothing.
  beforeEach(() => {
    startWorld({ hostname: 'www.example.com' })
  })

  test('is published when the script starts and withdrawn when it stops', () => {
    loadBody(`<main>${card(A)}</main>`)
    expect(currentHandle()).toBeUndefined()
    const world = startWorld()
    expect(currentHandle()?.state).toBe(world.content?.books.state)
    world.content?.stop()
    expect(currentHandle()).toBeUndefined()
  })

  test('is withdrawn when the extension is turned off, and a restart publishes a new one', () => {
    loadBody(`<main>${card(A)}</main>`)
    const first = startWorld()
    const firstHandle = currentHandle()
    first.content?.remove()
    expect(currentHandle()).toBeUndefined()
    startWorld()
    expect(currentHandle()).toBeDefined()
    expect(currentHandle()).not.toBe(firstHandle)
  })

  test('announces each change on the document', () => {
    loadBody(`<main>${card(A)}</main>`)
    const heard: Array<boolean> = []
    const stop = watchHandle(document, handle => heard.push(!!handle))
    const world = startWorld()
    world.content?.stop()
    stop()
    expect(heard).toEqual([false, true, false])
  })

  test('retryFailed puts every failed book back to waiting and sends one Retry', () => {
    loadBody(`<main>${card(A)}${card(B)}${card(C)}</main>`)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(failed(A))
    world.port.receive(failed(B))
    world.port.receive(ready(C, { r: 4, n: 9 }))
    currentHandle()?.retryFailed()
    expect(world.port.sent.at(-1)).toEqual({ _tag: 'Retry', asins: [A, B] })
    expect(texts(A)).toEqual(['GR …'])
    expect(texts(B)).toEqual(['GR …'])
    expect(texts(C)).toEqual(['★ 4.00 (9)'])
    world.port.receive(ready(A, { r: 4.5, n: 1 }))
    expect(texts(A)).toEqual(['★ 4.50 (1)'])
  })

  test('retryFailed with nothing failed sends nothing', () => {
    loadBody(`<main>${card(A)}</main>`)
    const world = startWorld()
    world.io.intersect()
    const sent = world.port.sent.length
    currentHandle()?.retryFailed()
    expect(world.port.sent).toHaveLength(sent)
  })
})
