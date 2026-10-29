import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Schema from 'effect/Schema'
import { renameKey } from '../../test/rename-key'
import { scoreCandidates } from '../core/matching'
import { AutocompleteResponse, bookPageData } from './goodreads'

const FIXTURES = join(import.meta.dir, '../../test/fixtures/goodreads')
const files = (dir: string) => readdirSync(join(FIXTURES, dir)).sort()
const read = (path: string) => readFileSync(join(FIXTURES, path), 'utf8')

const required = <T>(value: T | null | undefined): T => {
  if (value == null) throw new Error('fixture lacks an expected entity')
  return value
}

interface Entity {
  __typename?: string
  legacyId?: number
  description?: string | null
  details?: { publicationTime?: number | null }
  [key: string]: unknown
}
interface BookPage {
  props: { pageProps: { apolloState: Record<string, Entity> } }
}
const entities = (page: BookPage) =>
  Object.values(page.props.pageProps.apolloState)

/** The `__NEXT_DATA__` JSON of a saved book page, which holds nothing else (fixtures README). */
const nextData = (file: string): BookPage =>
  JSON.parse(
    required(
      read(`book/${file}`).match(/<script[^>]*>([\s\S]*)<\/script>/)
    )[1] ?? ''
  )
const bookIdOf = (file: string) => required(file.split('-')[0])

const decodeAutocomplete = Schema.decodeUnknownSync(AutocompleteResponse)

describe('autocomplete response', () => {
  test.each(files('autocomplete'))('%s decodes', file => {
    expect(
      decodeAutocomplete(JSON.parse(read(`autocomplete/${file}`))).length
    ).toBeGreaterThan(0)
  })

  test('decoded results are what matching reads', () => {
    const results = decodeAutocomplete(
      JSON.parse(read('autocomplete/the-hobbit.title-author.json'))
    )
    const scored = scoreCandidates(results, {
      title: 'The Hobbit',
      author: 'J.R.R. Tolkien',
    })
    expect(scored[0]?.score).toBe(3)
  })

  test.each([
    'bookId',
    'bookUrl',
    'title',
    'author',
    'name',
    'avgRating',
    'ratingsCount',
  ])('a renamed %s fails and the error names it', field => {
    const renamed = renameKey(
      JSON.parse(read('autocomplete/dune.title.json')),
      field,
      `${field}Renamed`
    )
    expect(() => decodeAutocomplete(renamed)).toThrow(`["${field}"]`)
  })

  test('a response that is not a list fails', () => {
    expect(() => decodeAutocomplete({ error: 'rate limited' })).toThrow()
  })
})

describe('book page', () => {
  test.each(files('book'))('%s decodes', file => {
    const data = bookPageData(nextData(file), bookIdOf(file))
    expect(data.genres.length).toBeGreaterThan(0)
    expect(data.descriptionHtml.length).toBeGreaterThan(0)
    expect(data.firstPublished).toBeNumber()
  })

  test('Atomic Habits: genres, overview and the year the work was first published', () => {
    const data = bookPageData(
      nextData('40121378-atomic-habits.html'),
      '40121378'
    )
    expect(data.genres.slice(0, 2)).toEqual(['Self Help', 'Nonfiction'])
    expect(data.descriptionHtml).toContain('Atomic Habits')
    // The work says 2018; the edition (Kindle, 2018-10-16) is only the fallback.
    expect(new Date(required(data.firstPublished)).getUTCFullYear()).toBe(2018)
  })

  test("the first-published time is the work's, not the edition's", () => {
    const page = nextData('3-harry-potter-1.html')
    const book = required(
      entities(page).find(e => e.__typename === 'Book' && e.legacyId === 3)
    )
    const work = required(entities(page).find(e => e.__typename === 'Work'))
    expect(bookPageData(page, '3').firstPublished).toBe(
      work.details?.publicationTime ?? undefined
    )
    expect(work.details?.publicationTime).not.toBe(
      book.details?.publicationTime
    )
  })

  test('without a publication time there is no first-published time', () => {
    const page = nextData('40121378-atomic-habits.html')
    for (const entity of entities(page)) {
      if (entity.details?.publicationTime !== undefined) {
        entity.details.publicationTime = null
      }
    }
    expect(bookPageData(page, '40121378')).not.toHaveProperty('firstPublished')
  })

  test('falls back to the text-only overview', () => {
    const page = nextData('40121378-atomic-habits.html')
    const book = required(entities(page).find(e => e.legacyId === 40121378))
    book['description({"stripped":true})'] = 'Plain text'
    book.description = null
    expect(bookPageData(page, '40121378').descriptionHtml).toBe('Plain text')
  })

  test.each([
    'bookGenres',
    'genre',
    'name',
    'legacyId',
    'description',
    'details',
    'publicationTime',
    'props',
    'apolloState',
  ])('a renamed %s fails and the error names it', field => {
    const renamed = renameKey(
      nextData('40121378-atomic-habits.html'),
      field,
      `${field}Renamed`
    )
    expect(() => bookPageData(renamed, '40121378')).toThrow(`["${field}"]`)
  })

  test('a page without the book fails', () => {
    const page = nextData('40121378-atomic-habits.html')
    // The userscript's fallback: a page whose id differs still yields its own book.
    expect(() => bookPageData(page, '999')).not.toThrow()
    page.props.pageProps.apolloState = {}
    expect(() => bookPageData(page, '40121378')).toThrow('["apolloState"]')
  })
})
