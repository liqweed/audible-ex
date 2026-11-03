import { afterEach, describe, expect, test } from 'bun:test'
import { createStore } from '@tanstack/store'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type BookStore, createBookStore } from '@/content/books'
import type { FilterState } from '@/content/filter'
import type { PanelHandle } from '@/content/shared'
import {
  DEFAULT_PANEL,
  type PanelState,
  type PanelStorage,
} from '@/storage/panel'
import { Panel } from './Panel'

afterEach(cleanup)

/** The panel's storage, in memory: `saved` is what has been written, in order. */
function memoryStorage(initial: Partial<PanelState> = {}) {
  let state: PanelState = { ...DEFAULT_PANEL, ...initial }
  const listeners = new Set<(state: PanelState) => void>()
  const saved: PanelState[] = []
  const storage: PanelStorage = {
    read: async () => state,
    update: async change => {
      const patch = typeof change === 'function' ? change(state) : change
      state = { ...state, ...patch }
      saved.push(state)
      for (const listener of listeners) listener(state)
    },
    watch: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return { storage, saved, current: () => state }
}

/** Renders the panel and lets it read its stored state. */
async function show(ui: React.ReactElement) {
  let result: ReturnType<typeof render> | undefined
  await act(async () => {
    result = render(ui)
  })
  return result as ReturnType<typeof render>
}

function setup() {
  const books: BookStore = createBookStore()
  let retries = 0
  const filter = createStore<FilterState>({ hidden: 0, peek: false })
  const handle: PanelHandle = {
    state: books.state,
    filter,
    retryFailed: () => {
      retries++
    },
    setPeek: peek => filter.setState(prev => ({ ...prev, peek })),
  }
  return { books, filter, handle, retries: () => retries }
}

const counters = (over = {}) => ({
  queued: 0,
  active: 0,
  done: 0,
  cached: 0,
  notFound: 0,
  failed: 0,
  ...over,
})

describe('Panel', () => {
  test('shows nothing until the tab has asked for a book', async () => {
    const { handle } = setup()
    const { container } = await show(
      <Panel handle={handle} storage={memoryStorage().storage} />
    )
    expect(container.firstChild).toBeNull()
  })

  test('shows a bar and the counts, and follows the store', async () => {
    const { books, handle } = setup()
    await show(<Panel handle={handle} storage={memoryStorage().storage} />)
    act(() =>
      books.setProgress(
        counters({ done: 34, queued: 20, active: 6, cached: 18, notFound: 2 })
      )
    )
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('34')
    expect(bar.getAttribute('aria-valuemax')).toBe('60')
    expect(screen.getByRole('status').textContent).toBe(
      '34/60 · 18 cached · 2 not found'
    )
    act(() =>
      books.setProgress(counters({ done: 60, cached: 18, notFound: 2 }))
    )
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '60'
    )
    expect(screen.getByRole('status').textContent).toBe(
      '60/60 · 18 cached · 2 not found'
    )
  })

  test('offers Retry failed only when something failed, and asks the badge script', async () => {
    const { books, handle, retries } = setup()
    await show(<Panel handle={handle} storage={memoryStorage().storage} />)
    act(() => books.setProgress(counters({ done: 5, queued: 1 })))
    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull()
    act(() => books.setProgress(counters({ done: 5, failed: 2 })))
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed' }))
    expect(retries()).toBe(1)
  })

  test('says Goodreads is rate limiting, with the seconds left', async () => {
    const { books, handle } = setup()
    await show(
      <Panel
        handle={handle}
        clock={() => 1_000}
        storage={memoryStorage().storage}
      />
    )
    act(() =>
      books.setProgress(counters({ queued: 4, done: 1, pausedUntil: 13_000 }))
    )
    expect(
      screen.getByText(/Paused — Goodreads is rate limiting \(12 s\)/)
    ).toBeTruthy()
    act(() => books.setProgress(counters({ queued: 4, done: 1 })))
    expect(screen.queryByText(/Paused/)).toBeNull()
  })

  test('a pause that is already over is not shown', async () => {
    const { books, handle } = setup()
    await show(
      <Panel
        handle={handle}
        clock={() => 20_000}
        storage={memoryStorage().storage}
      />
    )
    act(() => books.setProgress(counters({ queued: 1, pausedUntil: 13_000 })))
    expect(screen.queryByText(/Paused/)).toBeNull()
  })

  test('a changed Goodreads format gets its own message, not the progress', async () => {
    const { books, handle } = setup()
    await show(<Panel handle={handle} storage={memoryStorage().storage} />)
    act(() => {
      books.setProgress(counters({ done: 3, failed: 1 }))
      books.set('B000000001', {
        status: 'failed',
        error: { reason: 'formatChanged', message: 'x' },
      })
    })
    expect(screen.getByRole('alert').textContent).toContain(
      'Goodreads changed its page format'
    )
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  test('a network failure stays an ordinary failure with a retry', async () => {
    const { books, handle } = setup()
    await show(<Panel handle={handle} storage={memoryStorage().storage} />)
    act(() => {
      books.setProgress(counters({ done: 3, failed: 1 }))
      books.set('B000000001', {
        status: 'failed',
        error: { reason: 'httpError', message: 'x' },
      })
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry failed' })).toBeTruthy()
  })
})

describe('the shell', () => {
  /** A panel with books to show, over `stored` state. */
  async function open(
    stored: Partial<PanelState> = {},
    host = 'www.audible.com'
  ) {
    const { books, handle } = setup()
    const memory = memoryStorage(stored)
    act(() => books.setProgress(counters({ done: 34, queued: 26 })))
    const view = await show(
      <Panel handle={handle} storage={memory.storage} host={host} />
    )
    return { ...memory, books, view }
  }
  const box = (view: { container: HTMLElement }) =>
    view.container.firstElementChild as HTMLElement

  test('is docked at the bottom right until moved', async () => {
    const { view } = await open()
    expect(box(view).className).toContain('right-4')
    expect(box(view).className).toContain('bottom-4')
  })

  test('docks where it was left', async () => {
    const { view } = await open({ corner: 'topLeft' })
    expect(box(view).className).toContain('top-4')
    expect(box(view).className).toContain('left-4')
  })

  test('collapses to a pill with the count, and expands again', async () => {
    const { view, saved, current } = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByRole('progressbar')).toBeNull()
    const pill = screen.getByRole('button', { name: /expand/i })
    expect(pill.textContent).toBe('34/60')
    expect(current().collapsed).toBe(true)

    fireEvent.click(pill)
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(saved.map(s => s.collapsed)).toEqual([true, false])
    expect(box(view)).toBeTruthy()
  })

  test('starts as a pill when it was left collapsed', async () => {
    await open({ collapsed: true })
    expect(screen.getByRole('button', { name: /expand/i }).textContent).toBe(
      '34/60'
    )
  })

  test('hides on this site only, and remembers it', async () => {
    const { view, current } = await open({ hiddenHosts: ['www.audible.de'] })
    fireEvent.click(screen.getByRole('button', { name: 'Hide on this site' }))
    expect(view.container.firstChild).toBeNull()
    expect(current().hiddenHosts).toEqual(['www.audible.de', 'www.audible.com'])
  })

  test('stays hidden on a site where it was hidden, and returns when shown again', async () => {
    const { view, storage } = await open({ hiddenHosts: ['www.audible.com'] })
    expect(view.container.firstChild).toBeNull()
    await act(async () => storage.update({ hiddenHosts: [] }))
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  test('is not hidden on another marketplace', async () => {
    await open({ hiddenHosts: ['www.audible.com'] }, 'www.audible.co.uk')
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  test('a changed format is still told when collapsed', async () => {
    const { books } = await open({ collapsed: true })
    act(() =>
      books.set('B000000001', {
        status: 'failed',
        error: { reason: 'formatChanged', message: 'x' },
      })
    )
    expect(screen.getByRole('button', { name: /expand/i }).textContent).toBe(
      'Update needed'
    )
  })

  describe('dragging', () => {
    /** Moves the title from (10, 10) to `to`, the panel's box measuring 288 × 80 at the top left. */
    function dragTo(
      to: { x: number; y: number },
      handle = 'Goodreads ratings'
    ) {
      const grip = screen.getByText(handle)
      const wrapper = grip.closest('div[class*="fixed"]') as HTMLElement
      wrapper.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 288, height: 80 }) as DOMRect
      fireEvent.pointerDown(grip, { clientX: 10, clientY: 10, button: 0 })
      fireEvent.pointerMove(grip, { clientX: to.x, clientY: to.y })
      fireEvent.pointerUp(grip, { clientX: to.x, clientY: to.y })
      return wrapper
    }

    test('docks to the corner the panel is dropped nearest to, and saves it', async () => {
      const { current } = await open()
      // A 1024 × 768 viewport: the centre ends at (154 + 10, 40 + 10), the top left.
      dragTo({ x: 20, y: 20 })
      expect(current().corner).toBe('topLeft')
    })

    test('follows the pointer while it is held', async () => {
      await open()
      const grip = screen.getByText('Goodreads ratings')
      const wrapper = grip.closest('div[class*="fixed"]') as HTMLElement
      wrapper.getBoundingClientRect = () =>
        ({ left: 700, top: 600, width: 288, height: 80 }) as DOMRect
      fireEvent.pointerDown(grip, { clientX: 710, clientY: 610, button: 0 })
      fireEvent.pointerMove(grip, { clientX: 660, clientY: 560 })
      expect(wrapper.style.left).toBe('650px')
      expect(wrapper.style.top).toBe('550px')
      fireEvent.pointerUp(grip, { clientX: 660, clientY: 560 })
      expect(wrapper.style.left).toBe('')
    })

    test('a press that barely moves is not a drag', async () => {
      const { current } = await open({ corner: 'bottomLeft' })
      dragTo({ x: 12, y: 11 })
      expect(current().corner).toBe('bottomLeft')
    })

    test('dragging the pill moves it without expanding it', async () => {
      const { current } = await open({ collapsed: true })
      dragTo({ x: 30, y: 30 }, '34/60')
      fireEvent.click(screen.getByRole('button', { name: /expand/i }))
      expect(current().corner).toBe('topLeft')
      expect(current().collapsed).toBe(true)
    })
  })

  describe('the two levels of lookups', () => {
    const rating = { r: 4.2, n: 100, url: 'https://example.test', loose: false }
    const details = { genres: ['Fantasy'], year: 2001, desc: 'x' }
    /** Three books are rated; `read` of them have had their Goodreads page read. */
    function rated(books: BookStore, read: number) {
      act(() => {
        books.setProgress(counters({ done: 3, queued: 2 }))
        ;['B000000001', 'B000000002', 'B000000003'].forEach((asin, i) => {
          books.set(asin, {
            status: 'ready',
            rating,
            ...(i < read ? { details } : {}),
          })
        })
      })
    }

    test('shows a second bar for genres, year and overview once a book is rated', async () => {
      const { books, handle } = setup()
      await show(<Panel handle={handle} storage={memoryStorage().storage} />)
      act(() => books.setProgress(counters({ done: 0, queued: 5 })))
      expect(
        screen.queryByRole('progressbar', { name: 'Genres and details read' })
      ).toBeNull()

      rated(books, 1)
      const bar = screen.getByRole('progressbar', {
        name: 'Genres and details read',
      })
      expect(bar.getAttribute('aria-valuenow')).toBe('1')
      expect(bar.getAttribute('aria-valuemax')).toBe('3')
      expect(screen.getByText('1/3')).toBeTruthy()
      expect(screen.getByText('Genres, year & overview')).toBeTruthy()
      // The ratings bar is a different one and counts the lookups.
      expect(
        screen
          .getByRole('progressbar', { name: 'Ratings looked up' })
          .getAttribute('aria-valuenow')
      ).toBe('3')
    })

    test('the collapsed pill follows the details once every rating is in', async () => {
      const { books, handle } = setup()
      await show(
        <Panel
          handle={handle}
          storage={memoryStorage({ collapsed: true }).storage}
        />
      )
      act(() => books.setProgress(counters({ done: 3, queued: 2 })))
      rated(books, 1)
      expect(screen.getByRole('button', { name: /expand/i }).textContent).toBe(
        '3/5'
      )
      act(() => books.setProgress(counters({ done: 3 })))
      expect(screen.getByRole('button', { name: /expand/i }).textContent).toBe(
        'details 1/3'
      )
      rated(books, 3)
      act(() => books.setProgress(counters({ done: 3 })))
      expect(screen.getByRole('button', { name: /expand/i }).textContent).toBe(
        '3/3'
      )
    })
  })

  describe('the extension mark', () => {
    test('links the logo to the project page, and shows it on the pill', async () => {
      const { books, handle } = setup()
      act(() => books.setProgress(counters({ done: 1, queued: 1 })))
      const memory = memoryStorage()
      await show(
        <Panel handle={handle} storage={memory.storage} logoSrc='data:,logo' />
      )
      const link = screen.getByRole('link', { name: /open the project page/ })
      expect(link.getAttribute('href')).toBe(
        'https://github.com/liqweed/audible-ex'
      )
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.querySelector('img')?.getAttribute('src')).toBe('data:,logo')

      fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
      const pill = screen.getByRole('button', { name: /expand/i })
      expect(pill.querySelector('img')?.getAttribute('src')).toBe('data:,logo')
    })

    test('has no link without a logo', async () => {
      const { books, handle } = setup()
      act(() => books.setProgress(counters({ done: 1, queued: 1 })))
      await show(<Panel handle={handle} storage={memoryStorage().storage} />)
      expect(screen.queryByRole('link')).toBeNull()
    })
  })

  describe('the drag affordance', () => {
    test('says the title can be dragged', async () => {
      await open()
      const grip = screen.getByText('Goodreads ratings')
      const zone = grip.parentElement as HTMLElement
      expect(zone.title).toMatch(/drag/i)
      expect(zone.className).toContain('cursor-grab')
      expect(zone.querySelector('svg')).toBeTruthy()
    })

    test('lights the corner it would dock to while it is dragged, then goes away', async () => {
      await open()
      const grip = screen.getByText('Goodreads ratings')
      const wrapper = grip.closest('div[class*="fixed"]') as HTMLElement
      wrapper.getBoundingClientRect = () =>
        ({ left: 700, top: 600, width: 288, height: 80 }) as DOMRect
      expect(
        wrapper.parentElement?.querySelectorAll('[aria-hidden] > div')
      ).toHaveLength(0)

      fireEvent.pointerDown(grip, { clientX: 710, clientY: 610, button: 0 })
      fireEvent.pointerMove(grip, { clientX: 20, clientY: 20 })
      const targets = [
        ...(wrapper.parentElement?.querySelectorAll('[aria-hidden] > div') ??
          []),
      ]
      expect(targets).toHaveLength(4)
      const lit = targets.filter(t => t.className.includes('border-indigo-600'))
      expect(lit).toHaveLength(1)
      expect(lit[0]?.className).toContain('top-4 left-4')

      fireEvent.pointerUp(grip, { clientX: 20, clientY: 20 })
      expect(
        wrapper.parentElement?.querySelectorAll('[aria-hidden] > div')
      ).toHaveLength(0)
    })
  })
})
