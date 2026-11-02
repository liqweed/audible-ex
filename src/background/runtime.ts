/**
 * The worker's layer graph (ARCHITECTURE.md §4): `PortServer` over `LookupQueue` over the cache, the
 * two network services and `fetch`. Kept out of the entrypoint so the entrypoint stays a few lines
 * and the wiring has a home a test can import.
 */

// @effect-diagnostics unstableApiUsage:off (the worker's HttpClient is effect/http's; DECISIONS.md D16)

import { FetchHttpClient, type HttpClient } from 'effect/http'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { AudibleCatalog } from './AudibleCatalog'
import { BookCache } from './BookCache'
import { Goodreads } from './Goodreads'
import { LookupQueue } from './LookupQueue'
import { PortServer } from './PortServer'

/**
 * Everything the worker runs on: the port server, and the cache the popup's requests read. They
 * share one cache (one database connection, one daily sweeper), because both layers are built from
 * the same `cache` value. `indexedDB` is `self.indexedDB` in the worker; `http` is `fetch` there,
 * and a fake network in the tests. The layer fails with `CacheError` when the database cannot be
 * opened.
 */
export const liveLayer = (
  indexedDB: IDBFactory,
  http: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer
) => {
  const network = Layer.mergeAll(AudibleCatalog.layer, Goodreads.layer).pipe(
    Layer.provide(http)
  )
  const cache = BookCache.layer(indexedDB)
  const server = PortServer.layer.pipe(
    Layer.provide(LookupQueue.layer),
    Layer.provide(Layer.mergeAll(network, cache))
  )
  return Layer.mergeAll(server, cache)
}

/** The runtime the worker serves ports on. It builds the layer on first use, not here. */
export const makeRuntime = (indexedDB: IDBFactory) =>
  ManagedRuntime.make(liveLayer(indexedDB))
