import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Schema from 'effect/Schema'
import { renameKey } from '../../test/rename-key'
import { CatalogResponse } from './audible'

const FIXTURES = join(import.meta.dir, '../../test/fixtures/audible')
const fixture = (region: 'uk' | 'com'): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, region, 'catalog.json'), 'utf8'))
const decode = Schema.decodeUnknownSync(CatalogResponse)

describe('catalog products response', () => {
  test.each(['uk', 'com'] as const)('the %s fixture decodes', region => {
    const { products } = decode(fixture(region))
    expect(products.length).toBeGreaterThan(0)
    expect(products.some(p => p.title && p.authors?.[0]?.name)).toBe(true)
  })

  test('a product the marketplace does not carry is a bare ASIN', () => {
    const bare = decode(fixture('uk')).products.find(
      p => p.asin === 'B08G9PRS1K'
    )
    expect(bare).toEqual({ asin: 'B08G9PRS1K' })
  })

  test('title and first author come out as the service reads them', () => {
    const [artemis] = decode(fixture('uk')).products
    expect(artemis?.title).toBe('Artemis')
    expect(artemis?.authors?.[0]?.name).toBe('Andy Weir')
  })

  test.each(['products', 'asin', 'name'])(
    'a renamed %s fails and the error names it',
    field => {
      const renamed = renameKey(fixture('uk'), field, `${field}Renamed`)
      expect(() => decode(renamed)).toThrow(`["${field}"]`)
    }
  )

  test('a renamed title fails and the error names it', () => {
    const renamed = renameKey(fixture('uk'), 'title', 'titleRenamed')
    expect(() => decode(renamed)).toThrow('["title"]')
  })

  test('a product with a title and no authors decodes, as the userscript reads it', () => {
    const response = { products: [{ asin: 'B08G9PRS1K', title: 'Anonymous' }] }
    expect(decode(response).products[0]?.authors).toBeUndefined()
  })

  test('an ASIN that is not 10 letters or digits fails', () => {
    expect(() => decode({ products: [{ asin: 'nope' }] })).toThrow('["asin"]')
  })
})
