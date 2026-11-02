import { beforeEach, describe, expect, test } from 'bun:test'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import type { ClearScope, Stats } from '@/schema/popup'
import { readPrefs, updatePrefs } from '@/storage/prefs'
import { App } from './App'
import type { Backend } from './backend'

const stats = (books: number, pinned = 0, bytes = 2048): Stats => ({
  _tag: 'Stats',
  books,
  entries: books * 3,
  bytes,
  pinned,
})

/** A backend with a cache of `books` books, `pinned` of them from Library and Wish List. */
function fakeBackend(books: number, pinned: number) {
  const calls: ClearScope[] = []
  let state = { books, pinned }
  const backend: Backend = {
    stats: async () => stats(state.books, state.pinned),
    clear: async scope => {
      calls.push(scope)
      const deleted = scope === 'all' ? state.books : state.books - state.pinned
      state =
        scope === 'all'
          ? { books: 0, pinned: 0 }
          : { ...state, books: state.pinned }
      return deleted
    },
  }
  return { backend, calls }
}

beforeEach(() => {
  cleanup()
  fakeBrowser.reset()
})

describe('the master switch', () => {
  test('is on by default and turns the preference off and on', async () => {
    render(<App backend={fakeBackend(0, 0).backend} />)
    const toggle = await screen.findByRole('switch', {
      name: 'Show ratings on Audible',
    })
    await waitFor(() =>
      expect(toggle.getAttribute('aria-checked')).toBe('true')
    )

    fireEvent.click(toggle)
    await waitFor(async () => expect((await readPrefs()).enabled).toBe(false))
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(toggle)
    await waitFor(async () => expect((await readPrefs()).enabled).toBe(true))
  })

  test('shows a preference that was already off', async () => {
    await updatePrefs({ enabled: false })
    render(<App backend={fakeBackend(0, 0).backend} />)
    const toggle = await screen.findByRole('switch')
    await waitFor(() =>
      expect(toggle.getAttribute('aria-checked')).toBe('false')
    )
  })

  test('follows a change made elsewhere', async () => {
    render(<App backend={fakeBackend(0, 0).backend} />)
    const toggle = await screen.findByRole('switch')
    await act(() => updatePrefs({ enabled: false }))
    await waitFor(() =>
      expect(toggle.getAttribute('aria-checked')).toBe('false')
    )
  })
})

describe('the cache', () => {
  test('says how many books are cached, how big, and how many are pinned', async () => {
    render(<App backend={fakeBackend(120, 7).backend} />)
    expect(
      await screen.findByText(
        '120 books cached (2 KB), 7 from Library and Wish List.'
      )
    ).toBeDefined()
  })

  test('says so when it is empty', async () => {
    render(<App backend={fakeBackend(0, 0).backend} />)
    expect(await screen.findByText('The cache is empty.')).toBeDefined()
  })

  test('shows why the cache could not be read', async () => {
    const backend: Backend = {
      stats: async () => {
        throw new Error('IndexedDB is blocked')
      },
      clear: async () => 0,
    }
    render(<App backend={backend} />)
    expect(
      await screen.findByText('Could not read the cache: IndexedDB is blocked')
    ).toBeDefined()
  })

  test('clearing keeps Library and Wish List books and says so', async () => {
    const { backend, calls } = fakeBackend(10, 3)
    render(<App backend={backend} />)
    await screen.findByText(/10 books cached/)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Clear, keeping Library and Wish List',
      })
    )
    expect(
      await screen.findByText(
        'Cleared 7 entries. Library and Wish List books were kept.'
      )
    ).toBeDefined()
    expect(calls).toEqual(['unpinned'])
    expect(await screen.findByText(/3 books cached/)).toBeDefined()
  })

  test('clearing everything asks first, and Cancel clears nothing', async () => {
    const { backend, calls } = fakeBackend(10, 3)
    render(<App backend={backend} />)
    await screen.findByText(/10 books cached/)
    fireEvent.click(screen.getByRole('button', { name: 'Clear everything…' }))
    expect(calls).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      screen.queryByRole('button', { name: 'Clear everything' })
    ).toBeNull()
    expect(calls).toEqual([])
  })

  test('clearing everything, once confirmed, leaves nothing', async () => {
    const { backend, calls } = fakeBackend(10, 3)
    render(<App backend={backend} />)
    await screen.findByText(/10 books cached/)
    fireEvent.click(screen.getByRole('button', { name: 'Clear everything…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear everything' }))
    expect(await screen.findByText('Cleared 10 entries.')).toBeDefined()
    expect(calls).toEqual(['all'])
    expect(await screen.findByText('The cache is empty.')).toBeDefined()
  })

  test('a clear that fails says so', async () => {
    const backend: Backend = {
      stats: async () => stats(5),
      clear: async () => {
        throw new Error('quota')
      },
    }
    render(<App backend={backend} />)
    await screen.findByText(/5 books cached/)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Clear, keeping Library and Wish List',
      })
    )
    expect(
      await screen.findByText('Could not clear the cache: quota')
    ).toBeDefined()
  })
})

describe('the footer', () => {
  test('says the extension is not affiliated and links to the privacy policy and source', async () => {
    render(<App backend={fakeBackend(0, 0).backend} />)
    expect(
      await screen.findByText(
        'Not affiliated with Audible, Amazon or Goodreads.'
      )
    ).toBeDefined()
    expect(
      screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')
    ).toBe('https://github.com/liqweed/audible-ex/blob/main/PRIVACY.md')
    expect(
      screen.getByRole('link', { name: 'Source' }).getAttribute('href')
    ).toBe('https://github.com/liqweed/audible-ex')
  })
})
