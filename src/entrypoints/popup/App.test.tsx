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
import { markNudgeShown, readNudge, recordRatings } from '@/storage/nudge'
import { readPanel, updatePanel } from '@/storage/panel'
import { readPrefs, updateFilters, updatePrefs } from '@/storage/prefs'
import { App } from './App'
import type { Backend } from './backend'

const stats = (books: number, pinned = 0, bytes = 2048): Stats => ({
  _tag: 'Stats',
  books,
  entries: books * 3,
  bytes,
  pinned,
  library: Math.ceil(pinned / 2),
  wishlist: Math.floor(pinned / 2),
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

describe('the panel', () => {
  test('offers nothing while the panel is hidden nowhere', async () => {
    render(<App backend={fakeBackend(0, 0).backend} />)
    await screen.findByRole('switch')
    expect(
      screen.queryByRole('button', { name: 'Show the panel again' })
    ).toBeNull()
  })

  test('brings the panel back on the sites where it was hidden', async () => {
    await updatePanel({ hiddenHosts: ['www.audible.com', 'www.audible.co.uk'] })
    render(<App backend={fakeBackend(0, 0).backend} />)
    expect(
      await screen.findByText('Hidden on www.audible.com, www.audible.co.uk.')
    ).toBeDefined()

    fireEvent.click(
      screen.getByRole('button', { name: 'Show the panel again' })
    )
    await waitFor(async () =>
      expect((await readPanel()).hiddenHosts).toEqual([])
    )
    expect(
      screen.queryByRole('button', { name: 'Show the panel again' })
    ).toBeNull()
  })

  test('notices a site hidden while the popup is open', async () => {
    render(<App backend={fakeBackend(0, 0).backend} />)
    await screen.findByRole('switch')
    await act(() => updatePanel({ hiddenHosts: ['www.audible.de'] }))
    expect(await screen.findByText('Hidden on www.audible.de.')).toBeDefined()
  })
})

test('every button leads with an icon, hidden from assistive technology', async () => {
  await updatePanel({ hiddenHosts: ['www.audible.com'] })
  render(<App backend={fakeBackend(120, 7).backend} />)
  await screen.findByText('Show the panel again')
  fireEvent.click(screen.getByRole('button', { name: 'Clear everything…' }))
  const buttons = screen.getAllByRole('button')
  expect(buttons.length).toBeGreaterThanOrEqual(6)
  for (const button of buttons) {
    const icon = button.querySelector('svg')
    expect(icon, button.textContent ?? '').not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  }
})

describe('the cache', () => {
  test('a button below the clearing buttons opens the options page at its cache overview', async () => {
    const created: unknown[] = []
    const original = fakeBrowser.tabs.create
    fakeBrowser.tabs.create = (async (props: unknown) => {
      created.push(props)
      return {}
    }) as unknown as typeof original
    try {
      render(<App backend={fakeBackend(120, 7).backend} />)
      const buttons = await screen.findAllByRole('button')
      const names = buttons.map(b => b.textContent)
      expect(names.indexOf('Open the cache overview')).toBe(
        names.indexOf('Clear everything…') + 1
      )
      fireEvent.click(
        screen.getByRole('button', { name: 'Open the cache overview' })
      )
      expect(created).toHaveLength(1)
      expect(JSON.stringify(created[0])).toContain('options.html#cache')
    } finally {
      fakeBrowser.tabs.create = original
    }
  })

  test('says how many books are cached, how big, and how many are pinned', async () => {
    render(<App backend={fakeBackend(120, 7).backend} />)
    expect(
      await screen.findByText(
        '120 books cached (2 KB), 7 from Library and Wish List.'
      )
    ).toBeDefined()
  })

  test('draws the split between Library and Wish List and the rest', async () => {
    render(<App backend={fakeBackend(120, 7).backend} />)
    expect(
      await screen.findByRole('img', {
        name: 'Cached books: 4 Library, 3 Wish List, 113 Everything else',
      })
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
        name: 'Clear, keeping Library, Wish List and manual matches',
      })
    )
    expect(
      await screen.findByText(
        'Cleared 7 entries. Library, Wish List and manual matches were kept.'
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
        name: 'Clear, keeping Library, Wish List and manual matches',
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

describe('the request to rate the extension', () => {
  const used = async (ratings: number) => {
    await recordRatings(ratings, '2026-11-01')
    await recordRatings(1, '2026-11-02')
    await recordRatings(1, '2026-11-03')
  }
  const request = () =>
    screen.queryByRole('region', { name: 'Rate this extension' })

  test('always has a quiet "Rate" link in the footer', async () => {
    render(<App backend={fakeBackend(0, 0).backend} />)
    const link = await screen.findByRole('link', {
      name: 'Rate it on the Chrome Web Store',
    })
    expect(link.getAttribute('href')).toMatch(/\/reviews$/)
    expect(request()).toBeNull()
  })

  test('is shown once to someone who has used the extension, and then never again', async () => {
    await used(200)
    const first = render(<App backend={fakeBackend(0, 0).backend} />)
    expect(
      await screen.findByRole('region', { name: 'Rate this extension' })
    ).toBeDefined()
    await waitFor(async () => expect((await readNudge()).shown).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(request()).toBeNull()
    first.unmount()
    render(<App backend={fakeBackend(0, 0).backend} />)
    await screen.findByText('Not affiliated with Audible, Amazon or Goodreads.')
    expect(request()).toBeNull()
  })

  test('follows a changed setting instead of the ratings seen', async () => {
    await used(3)
    await updateFilters({ highlightLabels: ['Fantasy'] })
    render(<App backend={fakeBackend(0, 0).backend} />)
    expect(
      await screen.findByRole('region', { name: 'Rate this extension' })
    ).toBeDefined()
  })

  test('stays away from someone who has not used it enough, or was asked already', async () => {
    await recordRatings(900, '2026-11-01')
    render(<App backend={fakeBackend(0, 0).backend} />)
    await screen.findByText('Not affiliated with Audible, Amazon or Goodreads.')
    expect(request()).toBeNull()
    cleanup()
    await used(200)
    await markNudgeShown()
    render(<App backend={fakeBackend(0, 0).backend} />)
    await screen.findByText('Not affiliated with Audible, Amazon or Goodreads.')
    expect(request()).toBeNull()
  })
})
