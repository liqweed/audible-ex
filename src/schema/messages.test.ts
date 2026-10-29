import { describe, expect, test } from 'bun:test'
import * as Schema from 'effect/Schema'
import { REGIONS } from '../core/regions'
import {
  type BackgroundMessage as Background,
  BackgroundMessage,
  type ContentMessage as Content,
  ContentMessage,
} from './messages'

const rating = {
  r: 4.29,
  n: 1_723_399,
  url: 'https://www.goodreads.com/book/show/44767458-dune',
  loose: false,
} as const

const toBackground: Content[] = [
  { _tag: 'Hello', region: 'UK', page: 'search' },
  { _tag: 'Hello', region: 'JP', page: 'other' },
  { _tag: 'Lookup', items: [] },
  {
    _tag: 'Lookup',
    items: [
      { asin: 'B08G9PRS1K', pinned: false },
      { asin: '197865085X', pinned: true },
    ],
  },
  { _tag: 'Retry', asins: ['B08G9PRS1K'] },
]

const toContent: Background[] = [
  { _tag: 'BookUpdate', asin: 'B08G9PRS1K', status: 'loading' },
  {
    _tag: 'BookUpdate',
    asin: 'B08G9PRS1K',
    status: 'ready',
    rating,
    details: { genres: ['Science Fiction'], year: 1965, desc: 'Arrakis.' },
  },
  { _tag: 'BookUpdate', asin: 'B08G9PRS1K', status: 'notFound' },
  {
    _tag: 'BookUpdate',
    asin: 'B08G9PRS1K',
    status: 'failed',
    error: {
      reason: 'formatChanged',
      message: 'Goodreads changed its page format',
    },
  },
  {
    _tag: 'Progress',
    queued: 12,
    active: 3,
    done: 34,
    cached: 18,
    notFound: 2,
    failed: 1,
  },
  {
    _tag: 'Progress',
    queued: 0,
    active: 0,
    done: 0,
    cached: 0,
    notFound: 0,
    failed: 0,
    pausedUntil: 1_761_700_012_000,
  },
]

describe('content script → background', () => {
  test.each(toBackground)(
    '$_tag round-trips through encode and decode',
    message => {
      const encoded = Schema.encodeSync(ContentMessage)(message)
      expect(Schema.decodeSync(ContentMessage)(encoded)).toEqual(message)
    }
  )

  test('every marketplace is a region a Hello can name', () => {
    for (const { code } of REGIONS) {
      const hello = { _tag: 'Hello', region: code, page: 'home' } as const
      expect(Schema.decodeSync(ContentMessage)(hello)).toEqual(hello)
    }
  })

  test.each([
    [
      'an unknown region',
      { _tag: 'Hello', region: 'XX', page: 'home' },
      'region',
    ],
    ['an unknown page', { _tag: 'Hello', region: 'UK', page: 'cart' }, 'page'],
    ['a Lookup without items', { _tag: 'Lookup' }, 'items'],
    ['a malformed ASIN', { _tag: 'Retry', asins: ['not-an-asin'] }, 'asins'],
    [
      'an item without pinned',
      { _tag: 'Lookup', items: [{ asin: 'B08G9PRS1K' }] },
      'pinned',
    ],
  ])('%s fails and the error names the field', (_, message, field) => {
    expect(() => Schema.decodeUnknownSync(ContentMessage)(message)).toThrow(
      `["${field}"]`
    )
  })

  test('a message of the other direction fails', () => {
    expect(() =>
      Schema.decodeUnknownSync(ContentMessage)(toContent[0])
    ).toThrow()
  })

  test('a message with no tag fails', () => {
    expect(() =>
      Schema.decodeUnknownSync(ContentMessage)({ items: [] })
    ).toThrow()
  })
})

describe('background → content script', () => {
  test.each(toContent)(
    '$_tag $status round-trips through encode and decode',
    message => {
      const encoded = Schema.encodeSync(BackgroundMessage)(message)
      expect(Schema.decodeSync(BackgroundMessage)(encoded)).toEqual(message)
    }
  )

  test.each([
    [
      'a status the content script does not receive',
      { _tag: 'BookUpdate', asin: 'B08G9PRS1K', status: 'queued' },
      'status',
    ],
    [
      'a rating above 5',
      {
        _tag: 'BookUpdate',
        asin: 'B08G9PRS1K',
        status: 'ready',
        rating: { ...rating, r: 6 },
      },
      'r',
    ],
    [
      'an unknown error reason',
      {
        _tag: 'BookUpdate',
        asin: 'B08G9PRS1K',
        status: 'failed',
        error: { reason: 'oops', message: '' },
      },
      'reason',
    ],
    [
      'a negative counter',
      {
        _tag: 'Progress',
        queued: -1,
        active: 0,
        done: 0,
        cached: 0,
        notFound: 0,
        failed: 0,
      },
      'queued',
    ],
    ['a Progress without counters', { _tag: 'Progress' }, 'queued'],
    [
      'a ready book without a rating',
      { _tag: 'BookUpdate', asin: 'B08G9PRS1K', status: 'ready' },
      'rating',
    ],
    [
      'a failed book without an error',
      { _tag: 'BookUpdate', asin: 'B08G9PRS1K', status: 'failed' },
      'error',
    ],
  ])('%s fails and the error names the field', (_, message, field) => {
    expect(() => Schema.decodeUnknownSync(BackgroundMessage)(message)).toThrow(
      `["${field}"]`
    )
  })

  test('a message of the other direction fails', () => {
    expect(() =>
      Schema.decodeUnknownSync(BackgroundMessage)(toBackground[0])
    ).toThrow()
  })
})
