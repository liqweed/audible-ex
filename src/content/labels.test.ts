/**
 * The label popover and the mark on filtered labels, on a saved Audible page: hovering a genre
 * label offers to hide books with it, a label the user already hides is struck through and offers
 * to stop. The page is the .com search fixture; the first three books carry genres.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import type { FilterSettings } from '@/core/filter'
import { DEFAULT_FILTERS } from '@/storage/prefs'
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
  minYear: null,
  maxYear: null,
  maxPrice: {},
  hiddenLabels: [],
  highlightLabels: [],
  highlightRating: null,
  notFound: 'show',
  modes: DEFAULT_FILTERS.modes,
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
  // Lookups wait for the filters to be read.
  await flush()
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
/** The popover's radio button for `choice`: Hide, Show or Highlight. */
const option = (choice: 'Hide' | 'Show' | 'Highlight') =>
  [...(popover()?.querySelectorAll('.choice label') ?? [])]
    .find(l => l.textContent === choice)
    ?.querySelector('input') as HTMLInputElement
const checked = () =>
  (popover()?.querySelector('.choice input:checked') as HTMLInputElement)
    ?.parentElement?.textContent
const pick = async (choice: 'Hide' | 'Show' | 'Highlight') => {
  option(choice).click()
  await flush()
}
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

  test('names the label, how many books carry it, and offers hide, show or highlight', () => {
    openOn(pills('Romance')[0] as Element)
    expect(popover()?.querySelector('b')?.textContent).toBe('Romance')
    expect(popover()?.textContent).toContain('2 books on this page')
    const group = popover()?.querySelector('fieldset.choice')
    expect(group?.querySelector('legend')?.textContent).toBe(
      'Books labelled “Romance”'
    )
    expect(
      [...(group?.querySelectorAll('label') ?? [])].map(l => l.textContent)
    ).toEqual(['Hide', 'Show', 'Highlight'])
    expect(checked()).toBe('Show')
  })

  test('explains the choice behind its info button', () => {
    openOn(pills('Romance')[0] as Element)
    const info = popover()?.querySelector('button.info') as HTMLButtonElement
    const help = popover()?.querySelector('.help') as HTMLElement
    expect(info.getAttribute('aria-label')).toBe('About hide and highlight')
    expect(help.hidden).toBe(true)
    info.dispatchEvent(new Event('pointerenter'))
    expect(help.hidden).toBe(false)
    expect(info.getAttribute('aria-expanded')).toBe('true')
    expect(help.textContent).toContain('Highlight makes their covers shine')
    info.dispatchEvent(new Event('pointerleave'))
    expect(help.hidden).toBe(true)
    info.click()
    expect(help.hidden).toBe(false)
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
    await pick('Hide')
    expect(filters.current.hiddenLabels).toEqual(['Romance'])
    expect(popover()?.textContent).toContain('Hiding books labelled “Romance”.')
    expect(checked()).toBe('Hide')
    expect(
      pills('Romance').every(p => p.classList.contains('agx-filtered'))
    ).toBe(true)
  })

  test('hides the books that carry it', async () => {
    openOn(pills('Fantasy')[0] as Element)
    await pick('Hide')
    const hidden = document.querySelectorAll('[data-agx-filter="hide"]')
    const dimmed = document.querySelectorAll('[data-agx-filter="dim"]')
    expect(hidden.length + dimmed.length).toBeGreaterThan(0)
  })

  test('Show undoes it', async () => {
    openOn(pills('Romance')[0] as Element)
    await pick('Hide')
    await pick('Show')
    expect(filters.current.hiddenLabels).toEqual([])
    expect(popover()?.textContent).toContain('No longer hiding “Romance”.')
    expect(document.querySelectorAll('.agx-filtered')).toHaveLength(0)
  })

  test('keeps the labels already hidden, and does not add one twice', async () => {
    filters.change({ ...FILTERS, hiddenLabels: ['Horror'] })
    openOn(pills('Romance')[0] as Element)
    await pick('Hide')
    expect(filters.current.hiddenLabels).toEqual(['Horror', 'Romance'])
  })

  test('says the filters are off, and switches them on', async () => {
    filters.change({ ...FILTERS, enabled: false })
    openOn(pills('Romance')[0] as Element)
    expect(popover()?.textContent).toContain(
      'Filters are off; Hide switches them on.'
    )
    await pick('Hide')
    expect(filters.current.enabled).toBe(true)
    expect(filters.current.hiddenLabels).toEqual(['Romance'])
  })

  test('tells the user when it could not be saved, and allows another try', async () => {
    openOn(pills('Romance')[0] as Element)
    filters.failNextUpdate = true
    await pick('Hide')
    expect(popover()?.querySelector('.status.error')?.textContent).toBe(
      'Could not save the filter. Try again.'
    )
    expect(filters.current.hiddenLabels).toEqual([])
    expect(option('Hide').disabled).toBe(false)
    expect(checked()).toBe('Show')

    await pick('Hide')
    expect(filters.current.hiddenLabels).toEqual(['Romance'])
  })
})

describe('a label that is already filtered', () => {
  test('shows Hide chosen, and Show stops hiding it', async () => {
    filters.change({ ...FILTERS, hiddenLabels: ['romance'] })
    openOn(pills('Romance')[0] as Element)
    expect(checked()).toBe('Hide')
    await pick('Show')
    expect(popover()?.textContent).toContain('No longer hiding “Romance”.')
    expect(filters.current.hiddenLabels).toEqual([])
    expect(document.querySelectorAll('.agx-filtered')).toHaveLength(0)
  })
})

describe('highlighting a label', () => {
  test('saves it, says so, and marks the pills without hiding anything', async () => {
    openOn(pills('Romance')[0] as Element)
    await pick('Highlight')
    expect(filters.current.highlightLabels).toEqual(['Romance'])
    expect(filters.current.hiddenLabels).toEqual([])
    expect(popover()?.querySelector('.status')?.textContent).toBe(
      'Highlighting books labelled “Romance”.'
    )
    expect(document.querySelectorAll('.agx-highlighted').length).toBe(
      pills('Romance').length
    )
    expect(document.querySelectorAll('[data-agx-filter]')).toHaveLength(0)
  })

  test('shows Highlight chosen, and Show stops highlighting it', async () => {
    filters.change({ ...FILTERS, highlightLabels: ['romance'] })
    openOn(pills('Romance')[0] as Element)
    expect(checked()).toBe('Highlight')
    await pick('Show')
    expect(popover()?.textContent).toContain(
      'No longer highlighting “Romance”.'
    )
    expect(filters.current.highlightLabels).toEqual([])
    expect(document.querySelectorAll('.agx-highlighted')).toHaveLength(0)
  })

  test('hiding one label keeps the others highlighted, and the other way round', async () => {
    filters.change({ ...FILTERS, highlightLabels: ['Horror'] })
    openOn(pills('Romance')[0] as Element)
    await pick('Hide')
    expect(filters.current.hiddenLabels).toEqual(['Romance'])
    expect(filters.current.highlightLabels).toEqual(['Horror'])
    filters.change({
      ...FILTERS,
      hiddenLabels: ['Horror'],
      highlightLabels: [],
      highlightRating: null,
    })
    openOn(pills('Fantasy')[0] as Element)
    await pick('Highlight')
    expect(filters.current.highlightLabels).toEqual(['Fantasy'])
    expect(filters.current.hiddenLabels).toEqual(['Horror'])
  })

  test('moves straight from hidden to highlighted and back', async () => {
    filters.change({ ...FILTERS, hiddenLabels: ['Romance'] })
    openOn(pills('Romance')[0] as Element)
    await pick('Highlight')
    expect(filters.current.hiddenLabels).toEqual([])
    expect(filters.current.highlightLabels).toEqual(['Romance'])
    await pick('Hide')
    expect(filters.current.hiddenLabels).toEqual(['Romance'])
    expect(filters.current.highlightLabels).toEqual([])
  })
})

describe('from the keyboard', () => {
  test('focusing a label opens the popover at once', () => {
    const [pill] = pills('Romance')
    pill?.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(popover()).not.toBeNull()
  })

  test('Enter on a label opens it and moves focus to the chosen option', () => {
    const [pill] = pills('Romance')
    pill?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    expect(popover()).not.toBeNull()
    const root = document.querySelector('.agx-label-host')?.shadowRoot
    expect(root?.activeElement === option('Show')).toBe(true)
  })

  test('a choice made from the keyboard keeps the focus on it', async () => {
    const [pill] = pills('Romance')
    pill?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    await pick('Hide')
    const root = document.querySelector('.agx-label-host')?.shadowRoot
    expect(root?.activeElement === option('Hide')).toBe(true)
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

  test('Escape after Enter closes it, and the focus it returns does not reopen it', () => {
    const pill = pills('Romance')[0] as HTMLElement
    pill.focus()
    pill.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    expect(popover()).not.toBeNull()
    // Focus is in the popover now, so returning it to the label is a real focus change.
    pill.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    // Booleans, not the elements: a failing comparison of two DOM nodes never finishes printing.
    expect(popover() === null).toBe(true)
    expect(document.activeElement === pill).toBe(true)
  })

  test('focusing the label again after Escape opens it again', () => {
    const pill = pills('Romance')[0] as HTMLElement
    pill.focus()
    pill.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    pill.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    pill.blur()
    pill.focus()
    expect(popover()).not.toBeNull()
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
