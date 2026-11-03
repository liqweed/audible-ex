import { describe, expect, test } from 'bun:test'
import type { BookView, ProgressView } from '@/content/books'
import { counts, hasFormatChange, panelView, secondsLeft } from './summary'

const progress = (over: Partial<ProgressView> = {}): ProgressView => ({
  queued: 0,
  active: 0,
  done: 0,
  cached: 0,
  notFound: 0,
  failed: 0,
  ...over,
})

describe('panelView', () => {
  test('is hidden before the background has sent anything, and for a tab with no books', () => {
    expect(panelView(undefined, false, 0)).toEqual({ kind: 'hidden' })
    expect(panelView(progress(), false, 0)).toEqual({ kind: 'hidden' })
  })

  test('totals done, queued and active, and is finished when none are pending', () => {
    const working = panelView(
      progress({ done: 34, queued: 20, active: 6, cached: 18 }),
      false,
      0
    )
    expect(working).toMatchObject({
      kind: 'progress',
      done: 34,
      total: 60,
      cached: 18,
      finished: false,
    })
    expect(panelView(progress({ done: 60 }), false, 0)).toMatchObject({
      total: 60,
      finished: true,
    })
  })

  test('reports a pause only while it is still ahead', () => {
    const p = progress({ queued: 1, pausedUntil: 5_000 })
    expect(panelView(p, false, 1_000)).toMatchObject({ pausedUntil: 5_000 })
    expect(panelView(p, false, 5_000)).toMatchObject({ pausedUntil: undefined })
    expect(panelView(progress({ queued: 1 }), false, 0)).toMatchObject({
      pausedUntil: undefined,
    })
  })

  test('a changed Goodreads format replaces the progress, even before any counters', () => {
    expect(panelView(undefined, true, 0)).toEqual({ kind: 'formatChanged' })
    expect(panelView(progress({ done: 3 }), true, 0)).toEqual({
      kind: 'formatChanged',
    })
  })
})

describe('hasFormatChange', () => {
  const failedWith = (reason: string): BookView => ({
    status: 'failed',
    error: { reason, message: 'x' },
  })

  test('is true when a book failed because the page format changed', () => {
    const books = new Map<string, BookView>([
      ['A', { status: 'ready' }],
      ['B', failedWith('formatChanged')],
    ])
    expect(hasFormatChange(books)).toBe(true)
  })

  test('is false for other failures and for books that are not failed', () => {
    const books = new Map<string, BookView>([
      ['A', failedWith('httpError')],
      ['B', failedWith('rateLimited')],
      ['C', { status: 'loading' }],
    ])
    expect(hasFormatChange(books)).toBe(false)
    expect(hasFormatChange(new Map())).toBe(false)
  })
})

describe('counts', () => {
  const view = (over: Partial<ProgressView>) => {
    const v = panelView(progress({ done: 34, queued: 26, ...over }), false, 0)
    if (v.kind !== 'progress') throw new Error('expected progress')
    return v
  }

  test('lists only the counts that are not zero', () => {
    expect(counts(view({ cached: 18, notFound: 2, failed: 1 }))).toBe(
      '34/60 · 18 cached · 2 not found · 1 failed'
    )
    expect(counts(view({}))).toBe('34/60')
  })
})

describe('secondsLeft', () => {
  test('rounds up, and is at least 1 while the pause is ahead', () => {
    expect(secondsLeft(12_000, 0)).toBe(12)
    expect(secondsLeft(12_001, 0)).toBe(13)
    expect(secondsLeft(5_000, 4_999)).toBe(1)
    expect(secondsLeft(5_000, 6_000)).toBe(1)
  })
})
