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
