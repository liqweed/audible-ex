/**
 * The label popover and the mark on filtered labels, on a saved Audible page: hovering a genre
 * label offers to hide books with it, a label the user already hides is struck through and offers
 * to stop. The page is the .com search fixture; the first three books carry genres.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import type { FilterSettings } from '@/core/filter'
import {
  FakeFilters,
  loadFixture,
  ready,
  startWorld,
  type World,
} from '../../test/content-harness'
import { HIDE_DELAY_MS, SHOW_DELAY_MS } from './labels'

const FILTERS: FilterSettings = {
  enabled: true,
  minRating: 1,
  minRatings: 0,
  hiddenLabels: [],
  notFound: 'show',
  mode: 'hide',
}
const GOOD = { r: 4.5, n: 900 }
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

let world: World
let filters: FakeFilters

async function open(settings: Partial<FilterSettings> = {}) {
  loadFixture('com', 'search')
  filters = new FakeFilters({ ...FILTERS, ...settings })
  world = startWorld({
    hostname: 'www.audible.com',
    pathname: '/search',
    filters,
  })
  world.io.intersect()
  const [a, b, c] = [...new Set(world.port.lookups().flat())]
  const details = (genres: string[]) => ({ genres, year: 2001 })
  world.port.receive(ready(a as string, GOOD, details(['Fantasy', 'Romance'])))
  world.port.receive(ready(b as string, GOOD, details(['Romance', 'Horror'])))
  world.port.receive(ready(c as string, GOOD, details(['Horror'])))
  await flush()
}

const pills = (text: string) =>
  [...document.querySelectorAll('.agx-label')].filter(
    p => p.textContent === text
  ) as HTMLElement[]
const popover = () =>
  document
    .querySelector('.agx-label-host')
    ?.shadowRoot?.querySelector('.pop') ?? null
const button = () => popover()?.querySelector('button') as HTMLButtonElement
const hover = (el: Element) =>
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
/** The pointer reaches the popover: its events arrive at the document from the host. */
const hoverPopover = () =>
  hover(document.querySelector('.agx-label-host') as Element)
const hoverElsewhere = () => hover(document.body)
/** Hovers a pill and lets the delay pass, so the popover is open. */
function openOn(pill: Element) {
  hover(pill)
  world.timers.runAll()
}

beforeEach(async () => {
  await open()
})

describe('the pills', () => {
  test('are focusable and say they open a dialog', () => {
    const [pill] = pills('Romance')
    expect(pill?.getAttribute('tabindex')).toBe('0')
    expect(pill?.getAttribute('aria-haspopup')).toBe('dialog')
  })

  test('are not marked while no label is filtered', () => {
    expect(document.querySelectorAll('.agx-filtered')).toHaveLength(0)
  })

  test('are marked where their genre is hidden, in any case, and only there', async () => {
    filters.change({ ...FILTERS, hiddenLabels: [' romance '] })
    const marked = [...document.querySelectorAll('.agx-filtered')]
    expect(marked.length).toBeGreaterThan(0)
    expect(marked.every(p => p.textContent === 'Romance')).toBe(true)
    expect(marked).toHaveLength(pills('Romance').length)
    expect(marked[0]?.getAttribute('aria-label')).toBe(
      'Romance, hidden by your filters'
    )
    expect(
      pills('Horror').every(p => !p.classList.contains('agx-filtered'))
    ).toBe(true)
  })

  test('lose the mark when the label is no longer hidden, or the filters go off', () => {
    filters.change({ ...FILTERS, hiddenLabels: ['Romance'] })
    filters.change({ ...FILTERS, hiddenLabels: [] })
    expect(document.querySelectorAll('.agx-filtered')).toHaveLength(0)
    filters.change({ ...FILTERS, hiddenLabels: ['Romance'] })
    filters.change({ ...FILTERS, hiddenLabels: ['Romance'], enabled: false })
    expect(document.querySelectorAll('.agx-filtered')).toHaveLength(0)
    expect(document.querySelectorAll('.agx-label[aria-label]')).toHaveLength(0)
  })
})

describe('hovering a label', () => {
  test('opens the popover after a short wait, not at once', () => {
    const [pill] = pills('Romance')
    hover(pill as Element)
    expect(popover()).toBeNull()
    expect(world.timers.pending).toContain(SHOW_DELAY_MS)
    world.timers.runAll()
    expect(popover()).not.toBeNull()
  })

  test('names the label, how many books carry it, and offers to hide it', () => {
    openOn(pills('Romance')[0] as Element)
    expect(popover()?.querySelector('b')?.textContent).toBe('Romance')
    expect(popover()?.textContent).toContain('2 books on this page')
    expect(button().textContent).toBe('Hide books labelled “Romance”')
  })

  test('says one book in the singular', () => {
    openOn(pills('Fantasy')[0] as Element)
    expect(popover()?.textContent).toContain('1 book on this page')
  })

  test('a pointer passing over a label does not open it', () => {
    hover(pills('Romance')[0] as Element)
    hoverElsewhere()
    world.timers.runAll()
    expect(popover()).toBeNull()
  })

  test('stays while the pointer moves from the label to the popover, and goes after it leaves', () => {
    const [pill] = pills('Romance')
    openOn(pill as Element)
    hoverElsewhere()
    expect(world.timers.pending).toContain(HIDE_DELAY_MS)
    hoverPopover()
    world.timers.runAll()
    expect(popover()).not.toBeNull()

    hoverElsewhere()
    world.timers.runAll()
    expect(popover()).toBeNull()
  })

  test('moving to another label shows that one instead', () => {
    openOn(pills('Romance')[0] as Element)
    openOn(pills('Horror')[0] as Element)
    expect(popover()?.querySelector('b')?.textContent).toBe('Horror')
  })

  test('scrolling closes it', () => {
    openOn(pills('Romance')[0] as Element)
    document.dispatchEvent(new Event('scroll'))
    expect(popover()).toBeNull()
  })

  test('adds nothing to the page outside its own shadow root', () => {
    openOn(pills('Romance')[0] as Element)
    expect(document.querySelectorAll('.pop')).toHaveLength(0)
    expect(document.querySelector('.agx-label-host')?.children).toHaveLength(0)
  })
})

describe('hiding a label from the popover', () => {
  test('saves it, says so, and marks the pills', async () => {
    openOn(pills('Romance')[0] as Element)
    button().click()
    await flush()
    expect(filters.current.hiddenLabels).toEqual(['Romance'])
    expect(popover()?.textContent).toContain('Hiding books labelled “Romance”.')
    expect(button().textContent).toBe('Stop hiding “Romance”')
    expect(
      pills('Romance').every(p => p.classList.contains('agx-filtered'))
    ).toBe(true)
  })

  test('hides the books that carry it', async () => {
    openOn(pills('Fantasy')[0] as Element)
    button().click()
    await flush()
    const hidden = document.querySelectorAll('[data-agx-filter="hide"]')
    const dimmed = document.querySelectorAll('[data-agx-filter="dim"]')
    expect(hidden.length + dimmed.length).toBeGreaterThan(0)
  })

  test('the same button undoes it', async () => {
    openOn(pills('Romance')[0] as Element)
    button().click()
    await flush()
    button().click()
    await flush()
    expect(filters.current.hiddenLabels).toEqual([])
    expect(popover()?.textContent).toContain('No longer hiding “Romance”.')
    expect(document.querySelectorAll('.agx-filtered')).toHaveLength(0)
  })

  test('keeps the labels already hidden, and does not add one twice', async () => {
    filters.change({ ...FILTERS, hiddenLabels: ['Horror'] })
    openOn(pills('Romance')[0] as Element)
    button().click()
    await flush()
    expect(filters.current.hiddenLabels).toEqual(['Horror', 'Romance'])
  })

  test('says the filters are off, and switches them on', async () => {
    filters.change({ ...FILTERS, enabled: false })
    openOn(pills('Romance')[0] as Element)
    expect(popover()?.textContent).toContain(
      'Filters are off; this switches them on.'
    )
    button().click()
    await flush()
    expect(filters.current.enabled).toBe(true)
    expect(filters.current.hiddenLabels).toEqual(['Romance'])
  })

  test('tells the user when it could not be saved, and allows another try', async () => {
    openOn(pills('Romance')[0] as Element)
    filters.failNextUpdate = true
    button().click()
    await flush()
    expect(popover()?.querySelector('.status.error')?.textContent).toBe(
      'Could not save the filter. Try again.'
    )
    expect(filters.current.hiddenLabels).toEqual([])
    expect(button().disabled).toBe(false)
    expect(button().textContent).toBe('Hide books labelled “Romance”')

    button().click()
    await flush()
    expect(filters.current.hiddenLabels).toEqual(['Romance'])
  })
})

describe('a label that is already filtered', () => {
  test('offers to stop hiding it', async () => {
    filters.change({ ...FILTERS, hiddenLabels: ['romance'] })
    openOn(pills('Romance')[0] as Element)
    expect(button().textContent).toBe('Stop hiding “Romance”')
    button().click()
    await flush()
    expect(filters.current.hiddenLabels).toEqual([])
    expect(document.querySelectorAll('.agx-filtered')).toHaveLength(0)
  })
})

describe('from the keyboard', () => {
  test('focusing a label opens the popover at once', () => {
    const [pill] = pills('Romance')
    pill?.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(popover()).not.toBeNull()
  })

  test('Enter on a label opens it and moves focus to its button', () => {
    const [pill] = pills('Romance')
    pill?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    expect(popover()).not.toBeNull()
    const root = document.querySelector('.agx-label-host')?.shadowRoot
    expect(root?.activeElement).toBe(button())
  })

  test('Escape closes it and returns focus to the label', () => {
    const pill = pills('Romance')[0] as HTMLElement
    pill.focus()
    pill.dispatchEvent(new Event('focusin', { bubbles: true }))
    pill.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(pill)
  })
})

describe('turning the extension off', () => {
  test('removes the popover, its host and the marks', async () => {
    filters.change({ ...FILTERS, hiddenLabels: ['Romance'] })
    openOn(pills('Romance')[0] as Element)
    world.content?.remove()
    expect(document.querySelector('.agx-label-host')).toBeNull()
    expect(document.querySelectorAll('.agx-filtered')).toHaveLength(0)
  })
})
