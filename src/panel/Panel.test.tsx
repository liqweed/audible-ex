import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type BookStore, createBookStore } from '@/content/books'
import type { PanelHandle } from '@/content/shared'
import { Panel } from './Panel'

afterEach(cleanup)

function setup() {
  const books: BookStore = createBookStore()
  let retries = 0
  const handle: PanelHandle = {
    state: books.state,
    retryFailed: () => {
      retries++
    },
  }
  return { books, handle, retries: () => retries }
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
  test('shows nothing until the tab has asked for a book', () => {
    const { handle } = setup()
    const { container } = render(<Panel handle={handle} />)
    expect(container.firstChild).toBeNull()
  })

  test('shows a bar and the counts, and follows the store', () => {
    const { books, handle } = setup()
    render(<Panel handle={handle} />)
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

  test('offers Retry failed only when something failed, and asks the badge script', () => {
    const { books, handle, retries } = setup()
    render(<Panel handle={handle} />)
    act(() => books.setProgress(counters({ done: 5, queued: 1 })))
    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull()
    act(() => books.setProgress(counters({ done: 5, failed: 2 })))
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed' }))
    expect(retries()).toBe(1)
  })

  test('says Goodreads is rate limiting, with the seconds left', () => {
    const { books, handle } = setup()
    render(<Panel handle={handle} clock={() => 1_000} />)
    act(() =>
      books.setProgress(counters({ queued: 4, done: 1, pausedUntil: 13_000 }))
    )
    expect(
      screen.getByText(/Paused — Goodreads is rate limiting \(12 s\)/)
    ).toBeTruthy()
    act(() => books.setProgress(counters({ queued: 4, done: 1 })))
    expect(screen.queryByText(/Paused/)).toBeNull()
  })

  test('a pause that is already over is not shown', () => {
    const { books, handle } = setup()
    render(<Panel handle={handle} clock={() => 20_000} />)
    act(() => books.setProgress(counters({ queued: 1, pausedUntil: 13_000 })))
    expect(screen.queryByText(/Paused/)).toBeNull()
  })

  test('a changed Goodreads format gets its own message, not the progress', () => {
    const { books, handle } = setup()
    render(<Panel handle={handle} />)
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

  test('a network failure stays an ordinary failure with a retry', () => {
    const { books, handle } = setup()
    render(<Panel handle={handle} />)
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
