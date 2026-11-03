/**
 * The Audible catalogue API response (`api.audible.<tld>/1.0/catalog/products`) as a Schema. The
 * `AudibleCatalog` service asks for `response_groups=contributors,product_desc,price` and reads each
 * product's `title` and first author.
 */
import * as Schema from 'effect/Schema'
import { Asin } from './common'

/**
 * One product. A marketplace that does not carry the ASIN answers a bare `{ "asin": … }`
 * (ARCHITECTURE.md §4, found in the phase 0 spike), which `AudibleCatalog` maps to `NoMetadata`.
 * Otherwise the product has a `title`, and `authors` unless Audible lists none (the userscript reads
 * a missing first author as ""). `authors` without a `title` is not a "not carried" product but a
 * renamed `title`, so it fails and the error names the key.
 */
export const CatalogProduct = Schema.Struct({
  asin: Asin,
  title: Schema.optional(Schema.String),
  // Kept unknown here: a missing or changed price must not break rating lookups.
  price: Schema.optional(Schema.Unknown),
  authors: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String }))
  ),
}).check(
  Schema.makeFilter(product =>
    product.title === undefined && product.authors !== undefined
      ? { path: ['title'], issue: 'Missing key' }
      : undefined
  )
)

export const CatalogResponse = Schema.Struct({
  products: Schema.Array(CatalogProduct),
})

/** Decode price separately, so malformed optional prices leave metadata usable. */
export const CatalogPrice = Schema.Struct({
  lowest_price: Schema.Struct({
    base: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    currency_code: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  }),
})
