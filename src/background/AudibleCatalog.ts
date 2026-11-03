/**
 * What Audible says about an ASIN: its title and first author (ARCHITECTURE.md §4), from the
 * catalogue API of the marketplace the page is on. The userscript's `getMeta` and `flushMeta`.
 *
 * Lookups made close together are batched: one `catalog/products?asins=…` request per marketplace
 * API host carries up to 40 ASINs, however many fibres asked. The batch window is the userscript's
 * 120 ms. Only the ASINs of one batch are merged; a book is never looked up twice in it.
 */

// @effect-diagnostics unstableApiUsage:off (effect/http is unstable by Effect's label; DECISIONS.md D16)

import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import type { HttpClient } from 'effect/http'
import * as Layer from 'effect/Layer'
import * as Request from 'effect/Request'
import * as RequestResolver from 'effect/RequestResolver'
import * as Schema from 'effect/Schema'
import { type RegionCode, regionByCode } from '../core/regions'
import { CatalogPrice, CatalogResponse } from '../schema/audible'
import {
  FormatChanged,
  type HttpError,
  NoMetadata,
  type RateLimited,
} from './errors'
import { getText } from './httpGet'

/** What the badge lookup needs from Audible. `author` is empty when Audible lists none. */
export interface BookMeta {
  readonly title: string
  readonly author: string
  readonly price?: { readonly amount: number; readonly currency: string }
}

export type AudibleCatalogError =
  | HttpError
  | RateLimited
  | FormatChanged
  | NoMetadata

export interface AudibleCatalogService {
  /**
   * The title and first author of `asin` on `region`'s marketplace. Fails with `NoMetadata` when the
   * marketplace does not carry the ASIN (an ASIN from `.com` asked of `.ca`).
   */
  readonly lookup: (
    region: RegionCode,
    asin: string
  ) => Effect.Effect<BookMeta, AudibleCatalogError>
}

/** The API takes at most this many ASINs in one call. */
export const BATCH_MAX = 40

/** How long lookups are gathered before the request goes out. */
export const BATCH_WINDOW = '120 millis'

/** The `response_groups` the schema in `src/schema/audible.ts` is written for. */
const RESPONSE_GROUPS = 'contributors,product_desc,price'

class LookupMeta extends Request.Class<
  { readonly apiHost: string; readonly asin: string },
  BookMeta,
  AudibleCatalogError
> {}

export const catalogUrl = (apiHost: string, asins: readonly string[]) =>
  `https://${apiHost}/1.0/catalog/products?asins=${asins.join(',')}&response_groups=${RESPONSE_GROUPS}`

/** Catalogue amounts are floating-point cash values; compare at the currency's precision. */
const priceOf = (
  raw: unknown,
  apiHost: string,
  asin: string
): Effect.Effect<Pick<BookMeta, 'price'>> => {
  if (raw === undefined || raw === null) return Effect.succeed({})
  return Schema.decodeUnknownEffect(CatalogPrice)(raw).pipe(
    Effect.matchEffect({
      onFailure: error =>
        Effect.logWarning(
          'Malformed public catalogue price',
          { apiHost, asin },
          error
        ).pipe(Effect.as({})),
      onSuccess: decoded =>
        Effect.gen(function* () {
          const { base, currency_code: currency } = decoded.lowest_price
          const digits =
            new Intl.NumberFormat('en', {
              style: 'currency',
              currency,
            }).resolvedOptions().maximumFractionDigits ?? 2
          const scale = 10 ** digits
          const amount = Math.round(base * scale) / scale
          if (!Number.isFinite(amount)) {
            yield* Effect.logWarning(
              'Public price exceeds the supported amount',
              { apiHost, asin, base }
            )
            return {}
          }
          return { price: { amount, currency } }
        }),
    })
  )
}

const chunks = <A>(items: readonly A[], size: number): A[][] => {
  const out: A[][] = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

/** The products of one response by ASIN; a response that does not decode is `FormatChanged`. */
const products = (text: string) =>
  Schema.decodeEffect(Schema.fromJsonString(CatalogResponse))(text).pipe(
    Effect.mapError(
      error => new FormatChanged({ source: 'catalog', detail: error.message })
    ),
    Effect.map(
      response => new Map(response.products.map(p => [p.asin, p] as const))
    )
  )

export class AudibleCatalog extends Context.Service<
  AudibleCatalog,
  AudibleCatalogService
>()('audible-ex/AudibleCatalog') {
  /** The catalogue over the `HttpClient` in the environment (`FetchHttpClient` in the worker). */
  static layer: Layer.Layer<AudibleCatalog, never, HttpClient.HttpClient> =
    Layer.effect(
      AudibleCatalog,
      Effect.gen(function* () {
        const context = yield* Effect.context<HttpClient.HttpClient>()

        const resolver = RequestResolver.makeGrouped<LookupMeta, string>({
          key: entry => entry.request.apiHost,
          resolver: (entries, apiHost) =>
            Effect.gen(function* () {
              const asins = [...new Set(entries.map(e => e.request.asin))]
              for (const chunk of chunks(asins, BATCH_MAX)) {
                const url = catalogUrl(apiHost, chunk)
                const answer = yield* getText(url, 'application/json').pipe(
                  Effect.flatMap(({ text }) => products(text)),
                  Effect.exit
                )
                for (const entry of entries) {
                  if (!chunk.includes(entry.request.asin)) continue
                  if (Exit.isFailure(answer)) {
                    entry.completeUnsafe(Exit.failCause(answer.cause))
                    continue
                  }
                  const product = answer.value.get(entry.request.asin)
                  const price = product?.title
                    ? yield* priceOf(product.price, apiHost, entry.request.asin)
                    : {}
                  entry.completeUnsafe(
                    product?.title
                      ? Exit.succeed({
                          title: product.title,
                          author: product.authors?.[0]?.name ?? '',
                          ...price,
                        })
                      : Exit.fail(new NoMetadata({ asin: entry.request.asin }))
                  )
                }
              }
            }).pipe(Effect.provideContext(context)),
        }).pipe(RequestResolver.setDelay(BATCH_WINDOW))

        return AudibleCatalog.of({
          lookup: (region, asin) =>
            Effect.request(
              new LookupMeta({ apiHost: regionByCode(region).apiHost, asin }),
              resolver
            ),
        })
      })
    )
}
