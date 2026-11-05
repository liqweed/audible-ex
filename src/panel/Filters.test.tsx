import { beforeEach, describe, expect, test } from 'bun:test'
import { createStore } from '@tanstack/store'
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
import { type BookStore, createBookStore } from '@/content/books'
import type { FilterState } from '@/content/filter'
import type { PanelHandle } from '@/content/shared'
import { regionByCode } from '@/core/regions'
import { readPrefs, updateFilters } from '@/storage/prefs'
import { Filters } from './Filters'
import { genresSeen, suggestions } from './genres'

beforeEach(() => {
  cleanup()
  fakeBrowser.reset()
})

function setup(filter: Partial<FilterState> = {}) {
  const books: BookStore = createBookStore()
  const state = createStore<FilterState>({
    hidden: 0,
    dimmed: 0,
    highlighted: 0,
    peek: false,
    ...filter,
  })
  const peeks: boolean[] = []
  const handle: PanelHandle = {
    state: books.state,
    filter: state,
    retryFailed: () => {},
    setPeek: peek => {
      peeks.push(peek)
      state.setState(prev => ({ ...prev, peek }))
    },
  }
  return { books, state, handle, peeks }
}

async function show(handle: PanelHandle, openOptions?: () => void) {
  await act(async () => {
    render(<Filters handle={handle} openOptions={openOptions} />)
  })
}

/** The radio button `option` of the choice named `group`. */
const radio = (group: string, option: string) =>
  within(screen.getByRole('group', { name: group })).getByRole('radio', {
    name: option,
  }) as HTMLInputElement

const saved = async () => (await readPrefs()).filters
const openSettings = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Filter settings' }))

describe('the master switch and the counter', () => {
  test('is on by default and turns the filters off and on in the prefs', async () => {
    const { handle } = setup()
    await show(handle)
    const toggle = screen.getByRole('switch', { name: 'Filter books' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(toggle)
    await waitFor(async () => expect((await saved()).enabled).toBe(false))
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    // The settings stay reachable: highlighting works with the filters off.
    expect(screen.getByRole('button', { name: 'Filter settings' })).toBeTruthy()
  })

  test('says how many are hidden and shows them, then hides them again', async () => {
    const { handle, peeks } = setup({ hidden: 12 })
    await show(handle)
    expect(screen.getByText(/12 hidden/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(peeks).toEqual([true])
    fireEvent.click(await screen.findByRole('button', { name: 'Hide again' }))
    expect(peeks).toEqual([true, false])
  })

  test('says nothing when nothing is hidden', async () => {
    const { handle } = setup({ hidden: 0 })
    await show(handle)
    expect(screen.queryByText(/hidden/)).toBeNull()
  })

  test('follows a change made in another tab', async () => {
    const { handle } = setup()
    await show(handle)
    await act(() => updateFilters({ enabled: false }))
    await waitFor(() =>
      expect(
        screen
          .getByRole('switch', { name: 'Filter books' })
          .getAttribute('aria-checked')
      ).toBe('false')
    )
  })
})

describe('the settings', () => {
  test('are closed until asked for', async () => {
    const { handle } = setup()
    await show(handle)
    expect(screen.queryByRole('slider')).toBeNull()
    openSettings()
    expect(screen.getByRole('slider', { name: 'Minimum rating' })).toBeTruthy()
  })

  test('start at the defaults', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    const slider = screen.getByRole('slider', { name: 'Minimum rating' })
    expect(slider.getAttribute('aria-valuenow')).toBe('4')
    expect(slider.getAttribute('aria-valuemin')).toBe('3')
    expect(slider.getAttribute('aria-valuemax')).toBe('5')
    expect(
      (screen.getByLabelText('Minimum ratings') as HTMLInputElement).value
    ).toBe('50')
    expect(radio('Books not on Goodreads', 'Show').checked).toBe(true)
    for (const group of [
      'Books that fail the minimum rating',
      'Books that fail the minimum ratings',
      'Books that fail the year range',
      'Books that fail the hidden labels',
    ])
      expect(radio(group, 'Hide').checked).toBe(true)
  })

  test('the slider moves in tenths and saves once the user pauses', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    const slider = screen.getByRole('slider', { name: 'Minimum rating' })
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(slider, { key: 'ArrowRight' })
    }
    expect(slider.getAttribute('aria-valuenow')).toBe('4.3')
    expect(screen.getByText('4.3')).toBeTruthy()
    // Not saved yet: the user may still be moving it.
    expect((await saved()).minRating).toBe(4)
    await waitFor(async () => expect((await saved()).minRating).toBe(4.3), {
      timeout: 1000,
    })
  })

  test('the minimum number of ratings is saved, and 0 is allowed', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    fireEvent.change(screen.getByLabelText('Minimum ratings'), {
      target: { value: '0' },
    })
    await waitFor(async () => expect((await saved()).minRatings).toBe(0), {
      timeout: 1000,
    })
  })

  test('a negative or fractional count is not saved as typed', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    const input = screen.getByLabelText('Minimum ratings')
    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.change(input, { target: { value: '120.7' } })
    await waitFor(async () => expect((await saved()).minRatings).toBe(120), {
      timeout: 1000,
    })
  })

  test('the policy for books not on Goodreads is saved', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    fireEvent.click(radio('Books not on Goodreads', 'Dim'))
    await waitFor(async () => expect((await saved()).notFound).toBe('dim'))
  })

  test('each filter hides or dims on its own', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    fireEvent.click(radio('Books that fail the minimum rating', 'Dim'))
    await waitFor(async () => expect((await saved()).modes.rating).toBe('dim'))
    fireEvent.click(radio('Books that fail the year range', 'Dim'))
    await waitFor(async () =>
      expect((await saved()).modes).toEqual({
        rating: 'dim',
        count: 'hide',
        labels: 'hide',
        year: 'dim',
        price: 'hide',
      })
    )
    expect(radio('Books that fail the minimum rating', 'Dim').checked).toBe(
      true
    )
    expect(radio('Books that fail the minimum ratings', 'Hide').checked).toBe(
      true
    )
  })

  test('a mode changed in another tab is shown', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    await act(() =>
      updateFilters(current => ({ modes: { ...current.modes, count: 'dim' } }))
    )
    await waitFor(() =>
      expect(radio('Books that fail the minimum ratings', 'Dim').checked).toBe(
        true
      )
    )
  })

  test('explanations show while their info button is hovered or focused', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    const info = screen.getByRole('button', {
      name: 'About the minimum number of ratings',
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerEnter(info)
    expect(screen.getByRole('tooltip').textContent).toContain(
      '0 turns this off'
    )
    expect(info.getAttribute('aria-describedby')).toBe(
      screen.getByRole('tooltip').id
    )
    fireEvent.pointerLeave(info)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(info)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.keyDown(info, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  test('link to the options page when they can', async () => {
    const { handle } = setup()
    let opened = 0
    await show(handle, () => opened++)
    openSettings()
    fireEvent.click(screen.getByRole('button', { name: 'More settings' }))
    expect(opened).toBe(1)
  })

  test('have no options link without a way to open the page', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    expect(screen.queryByRole('button', { name: 'More settings' })).toBeNull()
  })

  test('a change saved at the last moment is not lost when the panel goes away', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' })
    cleanup()
    await waitFor(async () => expect((await saved()).minRating).toBe(4.1))
  })
})

describe('the first-published year range', () => {
  const from = () => screen.getByLabelText('From year') as HTMLInputElement
  const to = () => screen.getByLabelText('To year') as HTMLInputElement

  test('starts open at both ends and saves the range together after typing pauses', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    expect(from().value).toBe('')
    expect(to().value).toBe('')
    fireEvent.change(from(), { target: { value: '2000' } })
    fireEvent.change(to(), { target: { value: '2020' } })
    expect((await saved()).minYear).toBeNull()
    await waitFor(async () => {
      const filters = await saved()
      expect(filters.minYear).toBe(2000)
      expect(filters.maxYear).toBe(2020)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('keeps a bound open, supports BCE, and clears back to any year', async () => {
    await updateFilters({ minYear: -800, maxYear: -700 })
    const { handle } = setup()
    await show(handle)
    openSettings()
    expect(from().value).toBe('-800')
    expect(to().value).toBe('-700')
    fireEvent.change(from(), { target: { value: '' } })
    await waitFor(async () => {
      expect((await saved()).minYear).toBeNull()
      expect((await saved()).maxYear).toBe(-700)
    })
    fireEvent.change(to(), { target: { value: '' } })
    await waitFor(async () => expect((await saved()).maxYear).toBeNull())
    fireEvent.change(from(), { target: { value: '-600' } })
    await waitFor(async () => expect((await saved()).minYear).toBe(-600))
  })

  test('a reversed range shows an error and keeps the last saved range until corrected', async () => {
    await updateFilters({ minYear: 2000, maxYear: 2020 })
    const { handle } = setup()
    await show(handle)
    openSettings()
    fireEvent.change(from(), { target: { value: '2030' } })
    expect(screen.getByRole('alert').textContent).toContain('From year')
    expect(from().getAttribute('aria-invalid')).toBe('true')
    await act(() => Bun.sleep(350))
    expect((await saved()).minYear).toBe(2000)
    fireEvent.change(to(), { target: { value: '2030' } })
    await waitFor(async () => {
      expect((await saved()).minYear).toBe(2030)
      expect((await saved()).maxYear).toBe(2030)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test.each(['0', '2000.5', 'unknown', '-'])(
    'does not save the invalid year %s, even on close',
    async text => {
      await updateFilters({ minYear: 2000 })
      const { handle } = setup()
      await show(handle)
      openSettings()
      fireEvent.change(from(), { target: { value: text } })
      expect(screen.getByRole('alert').textContent).toContain('whole years')
      fireEvent.click(
        screen.getByRole('button', { name: 'Hide filter settings' })
      )
      await act(() => Bun.sleep(10))
      expect((await saved()).minYear).toBe(2000)
      openSettings()
      expect(from().value).toBe('2000')
    }
  )

  test('saves pending edits on collapse and reloads them when reopened', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    fireEvent.change(from(), { target: { value: '1990' } })
    fireEvent.change(to(), { target: { value: '2000' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide filter settings' })
    )
    await waitFor(async () => expect((await saved()).maxYear).toBe(2000))
    cleanup()
    await show(handle)
    openSettings()
    expect(from().value).toBe('1990')
    expect(to().value).toBe('2000')
  })

  test('follows year edits from another tab and preserves a draft during unrelated changes', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    await act(() => updateFilters({ minYear: 2000, maxYear: 2020 }))
    await waitFor(() => expect(from().value).toBe('2000'))
    expect(to().value).toBe('2020')
    fireEvent.change(from(), { target: { value: '2010' } })
    await act(() => updateFilters({ minRatings: 100 }))
    expect(from().value).toBe('2010')
    await waitFor(async () => expect((await saved()).minYear).toBe(2010))
    expect((await saved()).minRatings).toBe(100)
  })
})

describe('hidden labels', () => {
  function withGenres(books: BookStore) {
    const rating = { r: 4, n: 100, url: 'https://x.test', loose: false }
    const book = (genres: string[]) => ({
      status: 'ready' as const,
      rating,
      details: { genres, year: 2000, desc: '' },
    })
    books.set('B000000001', book(['Fantasy', 'Romance']))
    books.set('B000000002', book(['Fantasy', 'Horror']))
  }

  test('suggests the genres the page carries, most common first', async () => {
    const { handle, books } = setup()
    withGenres(books)
    await show(handle)
    openSettings()
    fireEvent.focus(screen.getByLabelText('Hide labels'))
    const options = screen
      .getAllByRole('button')
      .filter(b =>
        screen.getByRole('group', { name: 'Suggestions' }).contains(b)
      )
    expect(options.map(o => o.textContent)).toEqual([
      'Fantasy',
      'Horror',
      'Romance',
    ])
  })

  test('adds a suggestion by click, and shows it as a chip that can be removed', async () => {
    const { handle, books } = setup()
    withGenres(books)
    await show(handle)
    openSettings()
    const input = screen.getByLabelText('Hide labels')
    fireEvent.focus(input)
    fireEvent.click(screen.getByRole('button', { name: 'Romance' }))
    await waitFor(async () =>
      expect((await saved()).hiddenLabels).toEqual(['Romance'])
    )
    expect(
      screen.getByRole('button', { name: 'Stop hiding Romance' })
    ).toBeTruthy()
    // It is no longer suggested.
    fireEvent.focus(input)
    expect(screen.queryByRole('button', { name: 'Romance' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Stop hiding Romance' }))
    await waitFor(async () => expect((await saved()).hiddenLabels).toEqual([]))
  })

  test("Enter adds the genre that fits what was typed, in the genre's own case", async () => {
    const { handle, books } = setup()
    withGenres(books)
    await show(handle)
    openSettings()
    const input = screen.getByLabelText('Hide labels')
    fireEvent.change(input, { target: { value: 'rom' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(async () =>
      expect((await saved()).hiddenLabels).toEqual(['Romance'])
    )
    expect((input as HTMLInputElement).value).toBe('')
  })

  test('Enter adds a label no book carries yet, once', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    const input = screen.getByLabelText('Hide labels')
    for (const typed of ['Cozy Mystery', 'cozy mystery']) {
      fireEvent.change(input, { target: { value: typed } })
      fireEvent.keyDown(input, { key: 'Enter' })
    }
    await waitFor(async () =>
      expect((await saved()).hiddenLabels).toEqual(['Cozy Mystery'])
    )
  })

  test('Enter with nothing typed adds nothing', async () => {
    const { handle, books } = setup()
    withGenres(books)
    await show(handle)
    openSettings()
    const input = screen.getByLabelText('Hide labels')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect((await saved()).hiddenLabels).toEqual([])
  })
})

describe('highlighted labels', () => {
  function withGenres(books: BookStore) {
    const rating = { r: 4, n: 100, url: 'https://x.test', loose: false }
    books.set('B000000001', {
      status: 'ready',
      rating,
      details: { genres: ['Fantasy', 'Romance'], year: 2000, desc: '' },
    })
  }

  test('are added from the suggestions and removed from their chip', async () => {
    const { handle, books } = setup()
    withGenres(books)
    await show(handle)
    openSettings()
    fireEvent.focus(screen.getByLabelText('Highlight labels'))
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Suggestions' })).getByRole(
        'button',
        { name: 'Fantasy' }
      )
    )
    await waitFor(async () =>
      expect((await saved()).highlightLabels).toEqual(['Fantasy'])
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Stop highlighting Fantasy' })
    )
    await waitFor(async () =>
      expect((await saved()).highlightLabels).toEqual([])
    )
  })

  test('a label moves between hidden and highlighted, never in both', async () => {
    await updateFilters({ hiddenLabels: ['Romance'] })
    const { handle } = setup()
    await show(handle)
    openSettings()
    const input = screen.getByLabelText('Highlight labels')
    fireEvent.change(input, { target: { value: 'Romance' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(async () => {
      const filters = await saved()
      expect(filters.highlightLabels).toEqual(['Romance'])
      expect(filters.hiddenLabels).toEqual([])
    })
    const hide = screen.getByLabelText('Hide labels')
    fireEvent.change(hide, { target: { value: 'romance' } })
    fireEvent.keyDown(hide, { key: 'Enter' })
    await waitFor(async () => {
      const filters = await saved()
      expect(filters.hiddenLabels).toEqual(['romance'])
      expect(filters.highlightLabels).toEqual([])
    })
  })

  test('a hidden label is not suggested for highlighting', async () => {
    await updateFilters({ hiddenLabels: ['Romance'] })
    const { handle, books } = setup()
    withGenres(books)
    await show(handle)
    openSettings()
    fireEvent.focus(screen.getByLabelText('Highlight labels'))
    const offered = within(
      screen.getByRole('group', { name: 'Suggestions' })
    ).getAllByRole('button')
    expect(offered.map(b => b.textContent)).toEqual(['Fantasy'])
  })

  test('say how many cards on the page they mark', async () => {
    await updateFilters({ highlightLabels: ['Fantasy'] })
    const { handle } = setup({ highlighted: 3 })
    await show(handle)
    openSettings()
    expect(screen.getByText('3 on this page')).toBeTruthy()
  })
})

describe('genresSeen and suggestions', () => {
  test('count each genre once per book and sort by count, then name', () => {
    const books = new Map([
      [
        'A',
        {
          status: 'ready' as const,
          details: { genres: ['B', 'A'], year: 0, desc: '' },
        },
      ],
      [
        'B',
        {
          status: 'ready' as const,
          details: { genres: ['B'], year: 0, desc: '' },
        },
      ],
      ['C', { status: 'loading' as const }],
    ])
    expect(genresSeen(books)).toEqual(['B', 'A'])
  })

  test('suggestions skip hidden labels, match anywhere, and are limited', () => {
    const seen = ['Science Fiction', 'Fantasy', 'Romance', 'Historical Romance']
    expect(suggestions(seen, ['romance'], 'rom')).toEqual([
      'Historical Romance',
    ])
    expect(suggestions(seen, [], '')).toEqual(seen)
    expect(suggestions(seen, [], '', 2)).toEqual(['Science Fiction', 'Fantasy'])
    expect(suggestions(seen, [], 'zzz')).toEqual([])
  })
})

describe('the highlight rating', () => {
  async function showRating() {
    await act(async () => {
      render(<Filters handle={setup().handle} />)
    })
    openSettings()
    return screen.getByLabelText('Highlight rating') as HTMLInputElement
  }
  test('saves a rating, and blank turns it off', async () => {
    const input = await showRating()
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: '4.5' } })
    await waitFor(async () => expect((await saved()).highlightRating).toBe(4.5))
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(async () =>
      expect((await saved()).highlightRating).toBeNull()
    )
  })
  test('an invalid rating leaves the saved one in force, and an external edit updates the field', async () => {
    await updateFilters({ highlightRating: 4.2 })
    const input = await showRating()
    expect(input.value).toBe('4.2')
    fireEvent.change(input, { target: { value: '6' } })
    expect(screen.getByRole('alert').textContent).toContain('1 to 5')
    await act(async () => {
      await Bun.sleep(350)
    })
    expect((await saved()).highlightRating).toBe(4.2)
    await act(() => updateFilters({ highlightRating: 4.8 }))
    await waitFor(() => expect(input.value).toBe('4.8'))
  })
  test('works with the filters off', async () => {
    await updateFilters({ enabled: false })
    const input = await showRating()
    fireEvent.change(input, { target: { value: '4' } })
    await waitFor(async () => expect((await saved()).highlightRating).toBe(4))
  })
})

describe('maximum public price', () => {
  async function showPrice() {
    await act(async () => {
      render(<Filters handle={setup().handle} region={regionByCode('UK')} />)
    })
    openSettings()
    return screen.getByLabelText('Max price (GBP)') as HTMLInputElement
  }
  test('saves zero, preserves other marketplaces, and blank removes the limit', async () => {
    await updateFilters({ maxPrice: { US: 20 } })
    const input = await showPrice()
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: '0' } })
    await waitFor(async () =>
      expect((await saved()).maxPrice).toEqual({ UK: 0, US: 20 })
    )
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(async () =>
      expect((await saved()).maxPrice).toEqual({ US: 20 })
    )
  })
  test('invalid input leaves the saved price in force and an external edit updates the field', async () => {
    await updateFilters({ maxPrice: { UK: 10 } })
    const input = await showPrice()
    fireEvent.change(input, { target: { value: '-1' } })
    expect(screen.getByRole('alert').textContent).toContain('0 or more')
    await act(async () => {
      await Bun.sleep(350)
    })
    expect((await saved()).maxPrice).toEqual({ UK: 10 })
    await act(() => updateFilters({ maxPrice: { UK: 15.5 } }))
    await waitFor(() => expect(input.value).toBe('15.5'))
  })
  test('flushes the last edit when unmounted', async () => {
    const input = await showPrice()
    fireEvent.change(input, { target: { value: '12.5' } })
    cleanup()
    await waitFor(async () =>
      expect((await saved()).maxPrice).toEqual({ UK: 12.5 })
    )
  })
})

describe('highlight price', () => {
  async function showHighlight() {
    await act(async () => {
      render(<Filters handle={setup().handle} region={regionByCode('UK')} />)
    })
    openSettings()
    return screen.getByLabelText('Highlight price (GBP)') as HTMLInputElement
  }
  test('saves zero, keeps the other marketplaces and the price limit, and blank turns it off', async () => {
    await updateFilters({ maxPrice: { UK: 12 }, highlightPrice: { US: 8 } })
    const input = await showHighlight()
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: '0' } })
    await waitFor(async () =>
      expect((await saved()).highlightPrice).toEqual({ UK: 0, US: 8 })
    )
    expect((await saved()).maxPrice).toEqual({ UK: 12 })
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(async () =>
      expect((await saved()).highlightPrice).toEqual({ US: 8 })
    )
  })
  test('invalid input is not saved', async () => {
    await updateFilters({ highlightPrice: { UK: 5 } })
    const input = await showHighlight()
    fireEvent.change(input, { target: { value: '-2' } })
    expect(screen.getByRole('alert').textContent).toContain('0 or more')
    await act(async () => {
      await Bun.sleep(350)
    })
    expect((await saved()).highlightPrice).toEqual({ UK: 5 })
  })
})
