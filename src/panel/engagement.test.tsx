import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createStore } from '@tanstack/store'
import { act, cleanup, render } from '@testing-library/react'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { createBookStore } from '@/content/books'
import type { FilterState } from '@/content/filter'
import type { PanelHandle } from '@/content/shared'
import { useCountRatings } from './engagement'

beforeEach(() => fakeBrowser.reset())
afterEach(cleanup)

const rating = {
  r: 4.2,
  n: 100,
  url: 'https://www.goodreads.com/book/show/1',
  loose: false,
}

function setup() {
  const books = createBookStore()
  const handle: PanelHandle = {
    state: books.state,
    filter: createStore<FilterState>({
      hidden: 0,
      dimmed: 0,
      highlighted: 0,
      peek: false,
    }),
    retryFailed: () => {},
    setPeek: () => {},
  }
  const written: number[] = []
  const record = async (count: number) => {
    written.push(count)
  }
  const probe = <Counter handle={handle} record={record} />
  return { books, written, probe }
}

const FLUSH = 20

function Counter({
  handle,
  record,
}: {
  handle: PanelHandle
  record: (count: number) => Promise<void>
}) {
  useCountRatings(handle, record, FLUSH)
  return null
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('useCountRatings', () => {
  test('writes the ratings that arrived, in one batch', async () => {
    const { books, written, probe } = setup()
    render(probe)
    await act(async () => {
      for (const asin of ['A', 'B', 'C'])
        books.set(asin, { status: 'ready', rating })
      books.set('D', { status: 'notFound' })
      books.set('E', { status: 'loading' })
    })
    expect(written).toEqual([])
    await act(async () => wait(FLUSH + 50))
    expect(written).toEqual([3])
  })

  test('counts a book once while it stays on the page', async () => {
    const { books, written, probe } = setup()
    render(probe)
    await act(async () => books.set('A', { status: 'ready', rating }))
    await act(async () =>
      books.set('A', {
        status: 'ready',
        rating,
        details: { genres: [], year: 0, desc: '' },
      })
    )
    await act(async () => wait(FLUSH + 50))
    expect(written).toEqual([1])
  })

  test('writes what is waiting when the panel goes away', async () => {
    const { books, written, probe } = setup()
    const { unmount } = render(probe)
    await act(async () => books.set('A', { status: 'ready', rating }))
    unmount()
    expect(written).toEqual([1])
  })

  test('writes what is waiting when the page is left', async () => {
    const { books, written, probe } = setup()
    render(probe)
    await act(async () => books.set('A', { status: 'ready', rating }))
    window.dispatchEvent(new Event('pagehide'))
    expect(written).toEqual([1])
  })
})
