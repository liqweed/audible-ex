import { beforeEach, describe, expect, test } from 'bun:test'
import { createStore } from '@tanstack/store'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { type BookStore, createBookStore } from '@/content/books'
import type { FilterState } from '@/content/filter'
import type { PanelHandle } from '@/content/shared'
import { readPrefs, updateFilters } from '@/storage/prefs'
import { Filters } from './Filters'
import { genresSeen, suggestions } from './genres'

beforeEach(() => {
  cleanup()
  fakeBrowser.reset()
})

function setup(filter: Partial<FilterState> = {}) {
  const books: BookStore = createBookStore()
  const state = createStore<FilterState>({ hidden: 0, peek: false, ...filter })
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

async function show(handle: PanelHandle) {
  await act(async () => {
    render(<Filters handle={handle} />)
  })
}

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
    // With the filters off there is nothing to configure.
    expect(screen.queryByRole('button', { name: 'Filter settings' })).toBeNull()
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
      (screen.getByLabelText(/Minimum number of ratings/) as HTMLInputElement)
        .value
    ).toBe('50')
    expect(
      (screen.getByLabelText('Books not on Goodreads') as HTMLSelectElement)
        .value
    ).toBe('show')
    expect(
      (screen.getByLabelText('Books that fail a filter') as HTMLSelectElement)
        .value
    ).toBe('hide')
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
    fireEvent.change(screen.getByLabelText(/Minimum number of ratings/), {
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
    const input = screen.getByLabelText(/Minimum number of ratings/)
    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.change(input, { target: { value: '120.7' } })
    await waitFor(async () => expect((await saved()).minRatings).toBe(120), {
      timeout: 1000,
    })
  })

  test('the policies are saved', async () => {
    const { handle } = setup()
    await show(handle)
    openSettings()
    fireEvent.change(screen.getByLabelText('Books not on Goodreads'), {
      target: { value: 'dim' },
    })
    fireEvent.change(screen.getByLabelText('Books that fail a filter'), {
      target: { value: 'dim' },
    })
    await waitFor(async () => {
      const filters = await saved()
      expect(filters.notFound).toBe('dim')
      expect(filters.mode).toBe('dim')
    })
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
    fireEvent.focus(screen.getByLabelText('Hide books labelled'))
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
    const input = screen.getByLabelText('Hide books labelled')
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
    const input = screen.getByLabelText('Hide books labelled')
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
    const input = screen.getByLabelText('Hide books labelled')
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
    const input = screen.getByLabelText('Hide books labelled')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect((await saved()).hiddenLabels).toEqual([])
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
