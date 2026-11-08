import { beforeEach, describe, expect, test } from 'bun:test'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import type { CacheBackend } from '@/options/cache-backend'
import { exportPrefs } from '@/options/settings'
import { DEFAULT_PREFS, readPrefs, updateFilters } from '@/storage/prefs'
import { App } from './App'

beforeEach(() => {
  cleanup()
  fakeBrowser.reset()
})

/** A cache of 880 books, 312 from Library and Wish List, whose books carry these genres. */
const backend: CacheBackend = {
  list: async () => [],
  genres: async () => ['Fantasy', 'Fiction', 'Romance', 'Science Fiction'],
  stats: async () => ({
    _tag: 'Stats',
    books: 880,
    entries: 2640,
    bytes: 869 * 1024,
    pinned: 312,
    library: 200,
    wishlist: 100,
  }),
  deleteBook: async () => {},
  correct: async () => {},
}

async function show(download = (_text: string) => {}) {
  await act(async () => {
    render(<App download={download} backend={backend} />)
  })
  await screen.findByRole('heading', { name: 'Display' })
}
const save = async () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  })
const value = (label: string) =>
  (screen.getByLabelText(label) as HTMLInputElement).value
const change = (label: string, v: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value: v } })
const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }))
/** Types a label into one of the lists' fields and presses Enter. */
async function addLabel(list: string, label: string) {
  change(list, label)
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText(list), { key: 'Enter' })
  })
}

async function upload(text: string) {
  const file = new File([text], 'prefs.json', { type: 'application/json' })
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Import prefs from JSON'), {
      target: { files: [file] },
    })
  })
}

describe('options settings', () => {
  test('loads defaults and saves display, filters and marketplace prices together', async () => {
    await show()
    expect(value('Minimum rating')).toBe('4')
    expect(value('Labels per book')).toBe('4')
    change('Labels per book', '0')
    fireEvent.click(screen.getByLabelText('Show overview on hover'))
    change('From year', '-800')
    change('To year', '-700')
    change('audible.co.uk (GBP)', '0')
    change('Highlight price on audible.com (USD)', '5.5')
    await addLabel('Hidden labels', 'Fantasy')
    await addLabel('Hidden labels', 'History, Politics')
    expect((await readPrefs()).display.labels).toBe(4)
    await save()
    await screen.findByText('Settings saved.')
    expect((await readPrefs()).display).toEqual({
      labels: 0,
      year: true,
      overview: false,
    })
    expect((await readPrefs()).filters).toMatchObject({
      minYear: -800,
      maxYear: -700,
      maxPrice: { UK: 0 },
      highlightPrice: { US: 5.5 },
      hiddenLabels: ['Fantasy', 'History, Politics'],
    })
  })
  test('invalid years and prices leave storage untouched and can be corrected', async () => {
    await show()
    change('From year', '2020')
    change('To year', '2000')
    await save()
    await screen.findByRole('alert')
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
    change('To year', '2021')
    change('audible.com (USD)', '-1')
    await save()
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
    change('audible.com (USD)', '15.5')
    await save()
    await screen.findByText('Settings saved.')
    expect((await readPrefs()).filters.maxPrice).toEqual({ US: 15.5 })
  })
  test('follows external changes when clean and preserves a draft while dirty', async () => {
    await show()
    await act(() => updateFilters({ minRating: 4.5 }))
    await waitFor(() => expect(value('Minimum rating')).toBe('4.5'))
    change('Labels per book', '1')
    await act(() => updateFilters({ minRating: 3.5, maxPrice: { US: 20 } }))
    expect(value('Labels per book')).toBe('1')
    expect(screen.getByText(/Settings changed in another tab/)).toBeTruthy()
    await save()
    await screen.findByText('Settings saved.')
    expect((await readPrefs()).filters.minRating).toBe(3.5)
    expect((await readPrefs()).display.labels).toBe(1)
    expect(value('Minimum rating')).toBe('3.5')
  })
  test('discard reloads saved prefs without writing the draft', async () => {
    await show()
    change('Minimum rating', '5')
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(value('Minimum rating')).toBe('4')
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
  })
  test('reset is confirmed, can be cancelled and preserves device-local panel state', async () => {
    await updateFilters({ minRating: 5 })
    await fakeBrowser.storage.local.set({ panel: { corner: 'topLeft' } })
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults…' }))
    expect((await readPrefs()).filters.minRating).toBe(5)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect((await readPrefs()).filters.minRating).toBe(5)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset preferences' }))
    await screen.findByText('Preferences reset to defaults.')
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
    expect((await fakeBrowser.storage.local.get('panel')).panel).toEqual({
      corner: 'topLeft',
    })
  })
  test('exports saved prefs and imports only after confirmation', async () => {
    const exported: string[] = []
    await show(text => exported.push(text))
    change('Minimum rating', '5')
    fireEvent.click(
      screen.getByRole('button', { name: 'Export prefs as JSON' })
    )
    await screen.findByText('Saved preferences exported.')
    expect(JSON.parse(exported[0] ?? '').prefs.filters.minRating).toBe(4)
    await upload(exportPrefs({ ...DEFAULT_PREFS, enabled: false }))
    await screen.findByRole('button', { name: 'Import preferences' })
    expect((await readPrefs()).enabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Import preferences' }))
    await screen.findByText('Preferences imported.')
    expect((await readPrefs()).enabled).toBe(false)
    expect(value('Minimum rating')).toBe('4')
  })
  test('refuses an invalid backup without changing prefs', async () => {
    await show()
    await upload('{"format":"other"}')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
    expect(
      screen.queryByRole('button', { name: 'Import preferences' })
    ).toBeNull()
  })
  test('includes the privacy statement, source and affiliation notice', async () => {
    await show()
    expect(
      screen
        .getByRole('link', { name: 'Privacy statement' })
        .getAttribute('href')
    ).toContain('PRIVACY')
    expect(screen.getByRole('link', { name: 'GitHub repository' })).toBeTruthy()
    expect(
      screen.getByText('Not affiliated with Audible, Amazon or Goodreads.')
    ).toBeTruthy()
  })
  test('a failed storage write keeps the draft and reports the failure', async () => {
    await show()
    change('Minimum rating', '5')
    const original = fakeBrowser.storage.sync.set
    fakeBrowser.storage.sync.set = (() =>
      Promise.reject(new Error('Storage full'))) as typeof original
    try {
      await save()
      expect((await screen.findByRole('alert')).textContent).toContain(
        'Storage full'
      )
      expect(value('Minimum rating')).toBe('5')
    } finally {
      fakeBrowser.storage.sync.set = original
    }
  })
})

describe('options page design', () => {
  test('the bar of unsaved changes appears with the first edit and goes with Save or Discard', async () => {
    await show()
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
    click('Increase Minimum rating')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    click('Discard changes')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect(value('Minimum rating')).toBe('4')
    click('Increase Minimum rating')
    await save()
    await screen.findByText('Settings saved.')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect((await readPrefs()).filters.minRating).toBe(4.1)
  })
  test('the number fields step by their own increments and stop at their limits', async () => {
    await show()
    click('Increase Minimum rating')
    click('Increase Minimum rating')
    expect(value('Minimum rating')).toBe('4.2')
    click('Decrease Minimum rating')
    expect(value('Minimum rating')).toBe('4.1')
    change('Minimum rating', '5')
    click('Increase Minimum rating')
    expect(value('Minimum rating')).toBe('5')
    expect(
      (
        screen.getByRole('button', {
          name: 'Increase Minimum rating',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    click('Increase Minimum ratings')
    expect(value('Minimum ratings')).toBe('60')
    // A blank optional field starts from a sensible value.
    expect(value('Highlight rating')).toBe('')
    click('Increase Highlight rating')
    expect(value('Highlight rating')).toBe('4.5')
    click('Decrease Highlight rating')
    expect(value('Highlight rating')).toBe('4.4')
  })
  test('labels per book has a slider that moves with the number', async () => {
    await show()
    const thumb = screen.getByRole('slider', {
      name: 'Labels per book (slider)',
    })
    expect(thumb.getAttribute('aria-valuenow')).toBe('4')
    fireEvent.keyDown(thumb, { key: 'ArrowRight' })
    expect(value('Labels per book')).toBe('5')
    click('Decrease Labels per book')
    expect(thumb.getAttribute('aria-valuenow')).toBe('4')
  })
  test('hidden and highlighted labels are chips removed by a click, added with suggestions from the cache', async () => {
    await updateFilters({
      hiddenLabels: ['Horror'],
      highlightLabels: ['Fiction'],
    })
    await show()
    const hidden = screen.getByLabelText('Hidden labels')
    expect(
      screen
        .getByRole('button', { name: 'Remove Horror from the hidden labels' })
        .getAttribute('title')
    ).toContain('Click to remove')
    // Suggestions come from the cached books, minus the labels already in either list.
    fireEvent.focus(hidden)
    const suggestions = screen.getByRole('group', {
      name: 'Suggestions for the hidden labels',
    })
    expect(
      within(suggestions)
        .getAllByRole('button')
        .map(b => b.textContent)
    ).toEqual(['Fantasy', 'Romance', 'Science Fiction'])
    change('Hidden labels', 'rom')
    fireEvent.click(
      within(suggestions).getByRole('button', { name: 'Romance' })
    )
    expect(
      screen.getByRole('button', {
        name: 'Remove Romance from the hidden labels',
      })
    ).toBeTruthy()
    click('Remove Horror from the hidden labels')
    // A label added to one list leaves the other.
    await addLabel('Highlighted labels', 'Romance')
    expect(
      screen.queryByRole('button', {
        name: 'Remove Romance from the hidden labels',
      })
    ).toBeNull()
    expect(
      screen.getByRole('button', {
        name: 'Remove Romance from the highlighted labels',
      })
    ).toBeTruthy()
    await save()
    await screen.findByText('Settings saved.')
    expect((await readPrefs()).filters).toMatchObject({
      hiddenLabels: [],
      highlightLabels: ['Fiction', 'Romance'],
    })
  })
  test('free text is added when no suggestion fits, and a label is never added twice', async () => {
    await show()
    await addLabel('Hidden labels', 'Kitchen Sink Realism')
    await addLabel('Hidden labels', 'kitchen sink realism')
    expect(
      screen.getAllByRole('button', {
        name: /^Remove .* from the hidden labels$/,
      })
    ).toHaveLength(1)
  })
  test('what happens to a failing book is a list of Hide/Dim choices', async () => {
    await show()
    const rating = screen.getByRole('group', {
      name: 'Below the minimum rating',
    })
    expect(
      (within(rating).getByRole('radio', { name: 'Hide' }) as HTMLInputElement)
        .checked
    ).toBe(true)
    fireEvent.click(within(rating).getByRole('radio', { name: 'Dim' }))
    const missing = screen.getByRole('group', { name: 'Not on Goodreads' })
    expect(within(missing).getAllByRole('radio')).toHaveLength(3)
    fireEvent.click(within(missing).getByRole('radio', { name: 'Hide' }))
    await save()
    await screen.findByText('Settings saved.')
    const { filters } = await readPrefs()
    expect(filters.modes).toEqual({
      ...DEFAULT_PREFS.filters.modes,
      rating: 'dim',
    })
    expect(filters.notFound).toBe('hide')
  })
  test('maximum and highlight prices share one table with a link to each marketplace', async () => {
    await show()
    const table = screen.getByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map(h => h.textContent)
    ).toEqual(['Marketplace', 'Maximum price', 'Highlight price'])
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    expect(
      within(table)
        .getByRole('link', { name: 'audible.co.uk' })
        .getAttribute('href')
    ).toBe('https://www.audible.co.uk/')
    expect(screen.queryByText(/^Highlight price on audible/)).toBeNull()
  })
  test('the year range reads as one range and says when it is reversed', async () => {
    await show()
    expect(screen.getByText('Any year')).toBeTruthy()
    change('From year', '1990')
    expect(screen.getByText('1990 or later')).toBeTruthy()
    change('To year', '2020')
    expect(screen.getByText('1990 to 2020')).toBeTruthy()
    change('To year', '1980')
    expect(screen.getByText('“From” is later than “To”.')).toBeTruthy()
  })
  test('arrow keys step a number field, and the pointer-only buttons and links are skipped by Tab', async () => {
    await show()
    const field = screen.getByLabelText('Minimum rating')
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(value('Minimum rating')).toBe('4.1')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(value('Minimum rating')).toBe('3.9')
    expect(
      screen
        .getByRole('button', { name: 'Increase Minimum rating' })
        .getAttribute('tabindex')
    ).toBe('-1')
    for (const link of within(screen.getByRole('table')).getAllByRole('link')) {
      expect(link.getAttribute('tabindex')).toBe('-1')
    }
  })
  test('the suggestions can be reached and chosen with the keyboard', async () => {
    await show()
    const field = screen.getByLabelText('Hidden labels')
    fireEvent.focus(field)
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    const first = screen.getByRole('button', { name: 'Fantasy' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Fiction' })
    )
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' })
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(field)
  })
  test('the master switch lives with the display settings, and prices have currency signs', async () => {
    await show()
    expect(screen.queryByRole('heading', { name: 'General' })).toBeNull()
    const display = screen
      .getByRole('heading', { name: 'Display' })
      .closest('section') as HTMLElement
    expect(
      within(display).getByLabelText('Show ratings on Audible')
    ).toBeTruthy()
    const row = screen
      .getByRole('link', { name: 'audible.de' })
      .closest('tr') as HTMLElement
    expect(row.textContent).toContain('€')
    const uk = screen.getByRole('link', { name: 'audible.co.uk' }).closest('tr')
    expect(uk?.textContent).toContain('£')
  })
  test('the preview is one book inside the display settings and follows the draft', async () => {
    await show()
    const display = screen
      .getByRole('heading', { name: 'Display' })
      .closest('section') as HTMLElement
    const preview = within(display).getByText('Preview')
      .parentElement as HTMLElement
    expect(within(preview).getByText('Orbit of Glass')).toBeTruthy()
    // The default shows four labels and the year.
    expect(within(preview).getByText('Science Fiction')).toBeTruthy()
    expect(within(preview).getByText('Fiction')).toBeTruthy()
    expect(within(preview).queryByText('Humor')).toBeNull()
    expect(within(preview).getByText('2021')).toBeTruthy()
    change('Labels per book', '6')
    expect(within(preview).getByText('Humor')).toBeTruthy()
    change('Labels per book', '1')
    expect(within(preview).queryByText('Space Opera')).toBeNull()
    fireEvent.click(screen.getByLabelText('Show first-published year'))
    expect(within(preview).queryByText('2021')).toBeNull()
    // The lists colour the labels they name; nothing is saved.
    change('Labels per book', '4')
    await addLabel('Highlighted labels', 'Adventure')
    expect(within(preview).getByText('Adventure').className).toContain(
      'font-semibold'
    )
    await addLabel('Hidden labels', 'Space Opera')
    expect(within(preview).getByText('Space Opera').className).toContain(
      'line-through'
    )
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
  })
  test('hovering the preview rating shows the overview box, or the plain tooltip when it is off', async () => {
    await show()
    const badge = () => screen.getByRole('button', { name: /^★ 4\.52/ })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerEnter(badge())
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('21,340 ratings')
    expect(tip.textContent).toContain('first published 2021')
    expect(tip.textContent).toContain('A lone engineer wakes aboard')
    fireEvent.pointerLeave(badge())
    expect(screen.queryByRole('tooltip')).toBeNull()
    // The year follows its switch, and with the overview off only the native tooltip is left.
    fireEvent.click(screen.getByLabelText('Show first-published year'))
    fireEvent.pointerEnter(badge())
    expect(screen.getByRole('tooltip').textContent).not.toContain(
      'first published'
    )
    fireEvent.click(screen.getByLabelText('Show overview on hover'))
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(badge().getAttribute('title')).toContain('from 21,340 ratings')
  })
  test('the price table is not an inner scroll area, and its currency signs share one width', async () => {
    await show()
    const table = screen.getByRole('table')
    expect(table.parentElement?.className ?? '').not.toContain('overflow')
    const signs = [...table.querySelectorAll('span[aria-hidden="true"]')]
    expect(signs.length).toBe(20)
    for (const sign of signs) expect(sign.className).toContain('w-10')
  })
  test('opened at #cache, the page scrolls to the cache section once the settings are drawn', async () => {
    const scrolled: string[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    location.hash = '#cache'
    try {
      await show()
      await waitFor(() => expect(scrolled).toEqual(['cache']))
    } finally {
      location.hash = ''
      Element.prototype.scrollIntoView = original
    }
  })
  test('leaving the page asks first only while there are unsaved changes', async () => {
    await show()
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(leave()).toBe(false)
    click('Increase Minimum rating')
    expect(leave()).toBe(true)
    click('Discard changes')
    expect(leave()).toBe(false)
    click('Increase Minimum rating')
    await save()
    await screen.findByText('Settings saved.')
    expect(leave()).toBe(false)
  })
  test('the preview says when ratings are off', async () => {
    await show()
    fireEvent.click(screen.getByLabelText('Show ratings on Audible'))
    expect(screen.getByText(/Ratings are off/)).toBeTruthy()
    expect(screen.queryByText('Orbit of Glass')).toBeNull()
  })
  test('shows the state of the cache with its split', async () => {
    await show()
    await screen.findByText(
      '880 books cached (869 KB), 312 from Library and Wish List.'
    )
    expect(
      screen.getByRole('img', {
        name: 'Cached books: 200 Library, 100 Wish List, 12 Library or Wish List, not told apart yet, 568 Everything else',
      })
    ).toBeTruthy()
  })
  test('links to the repository and the store page', async () => {
    await show()
    const nav = screen.getByRole('navigation', { name: 'Project links' })
    expect(
      within(nav)
        .getByRole('link', { name: 'GitHub repository' })
        .getAttribute('href')
    ).toContain('github.com/')
    expect(
      within(nav)
        .getByRole('link', { name: 'Chrome Web Store page' })
        .getAttribute('href')
    ).toContain('chromewebstore.google.com')
    expect(
      within(nav)
        .getByRole('link', { name: 'Rate it on the Chrome Web Store' })
        .getAttribute('href')
    ).toMatch(/chromewebstore\.google\.com\/detail\/.+\/reviews$/)
  })
})

test('import errors name unknown fields and invalid values', async () => {
  await show()
  await upload(
    JSON.stringify({
      format: 'audible-ex-prefs',
      version: 1,
      prefs: { unexpectedSetting: true },
    })
  )
  expect((await screen.findByRole('alert')).textContent).toContain(
    'unexpectedSetting'
  )
  await upload(
    JSON.stringify({
      format: 'audible-ex-prefs',
      version: 1,
      prefs: { filters: { minRating: 9 } },
    })
  )
  expect((await screen.findByRole('alert')).textContent).toContain('minRating')
  expect(await readPrefs()).toEqual(DEFAULT_PREFS)
})
