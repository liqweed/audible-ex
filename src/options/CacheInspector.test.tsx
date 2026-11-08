import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { CachedBook } from '@/schema/inspector'
import { CacheInspector } from './CacheInspector'
import type { CacheBackend } from './cache-backend'

const book = (n: number): CachedBook => ({
  asin: `B${String(n).padStart(9, '0')}`,
  title: `Book ${n}`,
  author: `Author ${n}`,
  savedAt: n * 1000,
  bookId: String(n),
  rating: {
    r: n % 2 ? 4.8 : 3.2,
    n: 100,
    url: `https://www.goodreads.com/book/show/${n}`,
    loose: false,
  },
  manual: false,
  pinned: false,
})
const dimensions = ['clientHeight', 'clientWidth'] as const
const originals = dimensions.map(key =>
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)
)
beforeEach(() => {
  dimensions.forEach((key, index) => {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get: () => (index === 0 ? 400 : 700),
    })
  })
})
afterEach(() => {
  cleanup()
  dimensions.forEach((key, index) => {
    const original = originals[index]
    if (original) Object.defineProperty(HTMLElement.prototype, key, original)
    else Reflect.deleteProperty(HTMLElement.prototype, key)
  })
})
const rows = () =>
  within(screen.getByRole('list', { name: 'Cached books' })).queryAllByRole(
    'listitem'
  )
async function show(
  initial: readonly CachedBook[] = [book(1), book(2)],
  broken = false
) {
  let stored = [...initial]
  const calls: unknown[] = []
  const backend: CacheBackend = {
    list: async () => {
      if (broken) throw new Error('Cache blocked')
      return stored
    },
    genres: async () => [],
    stats: async () => {
      throw new Error('not used by the inspector')
    },
    correct: async (asin, url) => {
      calls.push({ asin, url })
      if (url.includes('/999')) throw new Error('Goodreads unavailable')
    },
    deleteBook: async asin => {
      calls.push({ delete: asin })
      stored = stored.filter(b => b.asin !== asin)
    },
  }
  await act(async () => {
    render(<CacheInspector backend={backend} />)
  })
  return calls
}
test('virtualizes thousands of books and searches title, author and ASIN', async () => {
  await show(Array.from({ length: 5000 }, (_, i) => book(i + 1)))
  expect(rows().length).toBeGreaterThan(0)
  expect(rows().length).toBeLessThan(25)
  for (const term of ['Book 4999', 'Author 4999', 'B000004999']) {
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search title, author or ASIN'), {
        target: { value: term },
      })
    })
    expect(rows()).toHaveLength(1)
    expect(rows()[0]?.textContent).toContain('Book 4999')
  }
})
test('sorts rating and age in both directions with unrated books last', async () => {
  await show([book(1), book(2), { ...book(3), rating: undefined }])
  const sort = screen.getByLabelText('Sort cached books')
  for (const [value, first] of [
    ['rating:true', 'Book 1'],
    ['rating:false', 'Book 2'],
    ['savedAt:false', 'Book 1'],
    ['savedAt:true', 'Book 3'],
  ]) {
    await act(async () => {
      fireEvent.change(sort, { target: { value } })
    })
    expect(rows()[0]?.textContent).toContain(first)
    if (value?.startsWith('rating'))
      expect(rows().at(-1)?.textContent).toContain('Book 3')
  }
})
test('validates a correction, keeps it editable after failure and saves a valid URL', async () => {
  const calls = await show()
  fireEvent.click(screen.getByRole('button', { name: 'Manage Book 1' }))
  const input = screen.getByLabelText('Correct Goodreads URL')
  const submit = screen.getByRole('button', { name: 'Save manual match' })
  fireEvent.change(input, {
    target: { value: 'https://evil.test/book/show/1' },
  })
  await act(async () => {
    fireEvent.click(submit)
  })
  expect(calls).toEqual([])
  expect(screen.getByRole('alert').textContent).toContain('HTTPS Goodreads')
  fireEvent.change(input, {
    target: { value: 'https://www.goodreads.com/book/show/999' },
  })
  await act(async () => {
    fireEvent.click(submit)
  })
  expect(screen.getByRole('alert').textContent).toContain(
    'Goodreads unavailable'
  )
  expect(screen.getByLabelText('Correct Goodreads URL')).toBeTruthy()
  fireEvent.change(input, {
    target: { value: 'https://www.goodreads.com/book/show/1000' },
  })
  await act(async () => {
    fireEvent.click(submit)
  })
  expect(calls).toHaveLength(2)
  expect(screen.getByRole('status').textContent).toContain('Manual match saved')
  expect(screen.queryByLabelText('Correct Goodreads URL')).toBeNull()
})
test('deletes a selected book and refreshes the list', async () => {
  const calls = await show()
  fireEvent.click(screen.getByRole('button', { name: 'Manage Book 2' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Delete cached book' }))
  })
  expect(calls).toEqual([{ delete: book(2).asin }])
  expect(rows()).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Manage Book 2' })).toBeNull()
})
test('empty cache and read errors have distinct states with a retry', async () => {
  await show([])
  expect(screen.getByText(/No cached books yet/)).toBeTruthy()
  cleanup()
  await show([], true)
  expect(screen.getByRole('alert').textContent).toContain('Cache blocked')
  expect(screen.queryByText(/No cached books yet/)).toBeNull()
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Refresh cache',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  )
})
