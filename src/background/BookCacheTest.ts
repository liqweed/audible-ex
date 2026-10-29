/**
 * `BookCache` for other services' tests: the live cache over a fresh in-memory IndexedDB
 * (`fake-indexeddb`), so rules, indexes and transactions behave as they do in the worker. Each build
 * of the layer gets its own database. Test code only; the extension never imports this.
 */

import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { IDBFactory } from 'fake-indexeddb'
import { BookCache } from './BookCache'

export const BookCacheTest = Layer.unwrap(
  Effect.sync(() => BookCache.layer(new IDBFactory()))
)
