import { describe, expect, test } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  DetailsRecord,
  HousekeepingRecord,
  MetaRecord,
  PinRecord,
  RatingRecord,
} from './cache'
import { DESCRIPTION_MAX } from './common'

const savedAt = 1_761_700_000_000
const found = {
  _tag: 'Found',
  asin: 'B08G9PRS1K',
  savedAt,
  bookId: '54493401',
  r: 4.52,
  n: 1_200_000,
  url: 'https://www.goodreads.com/book/show/54493401-project-hail-mary',
  loose: false,
} as const

const records = {
  'a found rating': [RatingRecord, found],
  'a miss': [RatingRecord, { _tag: 'Miss', asin: 'B08G9PRS1K', savedAt }],
  meta: [
    MetaRecord,
    {
      asin: 'B08G9PRS1K',
      savedAt,
      title: 'Project Hail Mary',
      author: 'Andy Weir',
    },
  ],
  'meta without an author': [
    MetaRecord,
    { asin: 'B08G9PRS1K', savedAt, title: 'Anonymous', author: '' },
  ],
  details: [
    DetailsRecord,
    {
      bookId: '54493401',
      savedAt,
      genres: ['Science Fiction'],
      year: 2021,
      desc: 'A lone astronaut.',
    },
  ],
  'details without a date': [
    DetailsRecord,
    { bookId: '54493401', savedAt, genres: [], year: 0, desc: '' },
  ],
  pin: [PinRecord, { asin: 'B08G9PRS1K', lastSeen: savedAt }],
  'the last purge': [HousekeepingRecord, { name: 'lastPurge', at: savedAt }],
} as const

describe('cache records', () => {
  test.each(Object.entries(records))(
    '%s round-trips',
    (_, [schema, record]) => {
      const codec = schema as Schema.Codec<unknown>
      const encoded = Schema.encodeSync(codec)(record)
      expect(Schema.decodeUnknownSync(codec)(encoded)).toEqual(record)
    }
  )

  test('a rating record of an unknown kind fails', () => {
    expect(() =>
      Schema.decodeUnknownSync(RatingRecord)({ ...found, _tag: 'Maybe' })
    ).toThrow()
  })

  test('a book first published before year 1 has a negative year', () => {
    const iliad = {
      bookId: '1371',
      savedAt,
      genres: ['Classics'],
      year: -750,
      desc: 'The war at Troy.',
    }
    expect(Schema.decodeSync(DetailsRecord)(iliad)).toEqual(iliad)
  })

  test('a rating record is keyed by the ASIN it was stored for', () => {
    const decoded = Schema.decodeSync(RatingRecord)(found)
    expect(decoded.asin).toBe('B08G9PRS1K')
  })

  test.each([
    ['a rating above 5', RatingRecord, { ...found, r: 5.1 }, 'r'],
    ['a fractional count', RatingRecord, { ...found, n: 1.5 }, 'n'],
    [
      'a link that is not Goodreads',
      RatingRecord,
      { ...found, url: 'https://example.com/book/show/1' },
      'url',
    ],
    [
      'a Goodreads link with a query string',
      RatingRecord,
      { ...found, url: `${found.url}?from=search` },
      'url',
    ],
    ['a malformed ASIN', RatingRecord, { ...found, asin: 'B08G9' }, 'asin'],
    [
      'a missing time',
      RatingRecord,
      { ...found, savedAt: undefined },
      'savedAt',
    ],
    [
      'an overview over the cap',
      DetailsRecord,
      { ...records.details[1], desc: 'x'.repeat(DESCRIPTION_MAX + 1) },
      'desc',
    ],
    [
      'more than 10 genres',
      DetailsRecord,
      { ...records.details[1], genres: Array(11).fill('Fiction') },
      'genres',
    ],
    [
      'a meta record without a title',
      MetaRecord,
      { ...records.meta[1], title: '' },
      'title',
    ],
  ])('%s fails and the error names the field', (_, schema, record, field) => {
    expect(() =>
      Schema.decodeUnknownSync(schema as Schema.Codec<unknown>)(
        record as unknown
      )
    ).toThrow(`["${field}"]`)
  })
})
