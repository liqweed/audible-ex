import { describe, expect, test } from 'bun:test'
import { createBookStore, isUnresolved, viewOf } from './books'

describe('book store', () => {
  test('holds a view per ASIN and tells listeners about each change', () => {
    const store = createBookStore()
    const heard: Array<[string, string]> = []
    const stop = store.subscribe((asin, view) =>
      heard.push([asin, view.status])
    )
    expect(store.get('B000000001')).toBeUndefined()
    store.set('B000000001', { status: 'queued' })
    store.set('B000000001', { status: 'loading' })
    expect(store.get('B000000001')?.status).toBe('loading')
    stop()
    store.set('B000000002', { status: 'notFound' })
    expect(heard).toEqual([
      ['B000000001', 'queued'],
      ['B000000001', 'loading'],
    ])
    expect([...store.entries()].map(([asin]) => asin)).toEqual([
      'B000000001',
      'B000000002',
    ])
  })

  test('a listener that unsubscribes while being called does not skip the next one', () => {
    const store = createBookStore()
    const calls: string[] = []
    const stopFirst = store.subscribe(() => {
      calls.push('first')
      stopFirst()
    })
    store.subscribe(() => calls.push('second'))
    store.set('B000000001', { status: 'queued' })
    expect(calls).toEqual(['first', 'second'])
  })
})

describe('book store state', () => {
  test('holds the books and the progress in one TanStack Store', () => {
    const store = createBookStore()
    expect(store.state.get()).toEqual({
      books: new Map(),
      progress: undefined,
      held: new Set(),
    })
    const states: number[] = []
    const stop = store.state.subscribe(state => states.push(state.books.size))
    store.set('B000000001', { status: 'queued' })
    store.set('B000000001', { status: 'loading' })
    store.set('B000000002', { status: 'queued' })
    expect(states).toEqual([1, 1, 2])
    stop.unsubscribe()
    expect(store.state.get().books.get('B000000001')?.status).toBe('loading')
  })

  test('replaces the books on each change, so a selector sees a new value', () => {
    const store = createBookStore()
    const before = store.state.get().books
    store.set('B000000001', { status: 'queued' })
    expect(store.state.get().books).not.toBe(before)
    expect(before.size).toBe(0)
  })

  test('keeps the latest progress, and a book change does not lose it', () => {
    const store = createBookStore()
    const first = {
      queued: 2,
      active: 1,
      done: 0,
      cached: 0,
      notFound: 0,
      failed: 0,
    }
    store.setProgress(first)
    store.set('B000000001', { status: 'queued' })
    expect(store.state.get().progress).toEqual(first)
    const next = { ...first, queued: 0, active: 0, done: 3, pausedUntil: 9_000 }
    store.setProgress(next)
    expect(store.state.get().progress).toEqual(next)
    expect(store.get('B000000001')?.status).toBe('queued')
  })

  test('progress changes do not call the per-book listeners', () => {
    const store = createBookStore()
    let calls = 0
    store.subscribe(() => calls++)
    store.setProgress({
      queued: 0,
      active: 0,
      done: 1,
      cached: 0,
      notFound: 0,
      failed: 0,
    })
    expect(calls).toBe(0)
  })
})

describe('viewOf', () => {
  test('copies what the update carries and nothing else', () => {
    const rating = {
      r: 4,
      n: 3,
      url: 'https://www.goodreads.com/book/show/1',
      loose: false,
    }
    expect(
      viewOf({
        _tag: 'BookUpdate',
        asin: 'B000000001',
        status: 'ready',
        rating,
      })
    ).toEqual({
      status: 'ready',
      rating,
    })
    expect(
      viewOf({ _tag: 'BookUpdate', asin: 'B000000001', status: 'loading' })
    ).toEqual({
      status: 'loading',
    })
  })
})

describe('isUnresolved', () => {
  test.each([
    [undefined, false],
    [{ status: 'queued' }, true],
    [{ status: 'loading' }, true],
    [{ status: 'notFound' }, false],
    [{ status: 'failed', error: { reason: 'httpError', message: '' } }, false],
    [
      { status: 'ready', rating: { r: 1, n: 1, url: 'u', loose: false } },
      false,
    ],
    [
      {
        status: 'ready',
        rating: { r: 1, n: 1, url: 'u', loose: false },
        details: { genres: [], year: 0, desc: '' },
      },
      false,
    ],
  ] as const)('%j is %s', (view, expected) => {
    expect(isUnresolved(view)).toBe(expected)
  })
})
