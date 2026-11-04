/**
 * The content script's end of the `agx` port (ARCHITECTURE.md §5): connects, says `Hello` first,
 * sends `Lookup`, `DetailsLookup`, `Retry` and `PriceLookup`, and hands every `BackgroundMessage` that decodes to the caller. A
 * message that does not decode is dropped with a warning, as the server does.
 *
 * MV3 stops an idle background worker, which closes the port (ARCHITECTURE.md §4, "Service worker
 * lifetime"). When that happens while some book has had no answer (`unresolved()`), the client
 * reconnects, says `Hello` again and re-sends those ASINs; the cache makes that cheap. A book that
 * has its rating counts as answered even without details: a failed details read is not cached, so
 * asking for it again on every reconnect would hit Goodreads in a loop. The wait before a reconnect
 * doubles from 100 ms to 30 s, so a worker that never comes back is asked a few times a minute, not
 * in a loop. With nothing unresolved the client stays disconnected until the next lookup: a
 * reconnect only to wake the worker again would keep it running for as long as the tab is open.
 */
import * as Schema from 'effect/Schema'
import type { PageKind } from '../core/page'
import type { RegionCode } from '../core/regions'
import { BackgroundMessage } from '../schema/messages'
import type { Schedule } from './schedule'

/** The part of `runtime.Port` the client uses, so tests can use a fake. */
export interface ClientPort {
  postMessage(message: unknown): void
  readonly onMessage: {
    addListener(listener: (message: unknown) => void): void
  }
  readonly onDisconnect: { addListener(listener: () => void): void }
  disconnect?(): void
}

export interface LookupItem {
  readonly asin: string
  readonly pinned: boolean
  /** Stop after the rating: the filters may hide the book on it (eager filtering). */
  readonly ratingOnly?: boolean
  /** The rating only if the cache has it, nothing otherwise: the price may still hide the book. */
  readonly cacheOnly?: boolean
}

export interface PortClientOptions {
  /** Opens the port (named `PORT_NAME`, from `src/background/port.ts`); may throw (the extension was reloaded under the page). */
  connect(): ClientPort
  readonly region: RegionCode
  readonly page: PageKind
  /**
   * The books the background has not answered at all (queued or loading); asked for again after a
   * reconnect. A book with its rating is not here even without details, or a details failure,
   * which is never cached, would be fetched again on every reconnect.
   */
  unresolved(): ReadonlyArray<LookupItem>
  onMessage(message: BackgroundMessage): void
  schedule: Schedule
  /** Milliseconds, `Date.now` by default. */
  now?: () => number
}

export interface PortClient {
  lookup(items: ReadonlyArray<LookupItem>): void
  /** The rest of `ratingOnly` lookups that answered with a rating. */
  details(asins: ReadonlyArray<string>): void
  retry(asins: ReadonlyArray<string>): void
  prices(asins: ReadonlyArray<string>): void
  /** Ends the connection for good; nothing is sent or reconnected after this. */
  close(): void
}

const FIRST_DELAY_MS = 100
const MAX_DELAY_MS = 30_000
/** A connection that lasted this long counts as healthy: the next reconnect starts quick again. */
const STABLE_MS = 10_000

const decode = Schema.decodeUnknownSync(BackgroundMessage)

/** How much an item asks for: the cache only, the rating, or everything. */
const depthOf = (item: LookupItem) =>
  item.cacheOnly ? 0 : item.ratingOnly ? 1 : 2

export function createPortClient(options: PortClientOptions): PortClient {
  const now = options.now ?? Date.now
  const pendingPrices = new Set<string>()
  let port: ClientPort | undefined
  let closed = false
  let cancelReconnect: (() => void) | undefined
  let failures = 0
  let connectedAt = 0
  let heard = false

  /** One entry per ASIN, pinned if any of its entries is, and as deep as the deepest. */
  const dedupe = (items: ReadonlyArray<LookupItem>): LookupItem[] => {
    const byAsin = new Map<string, LookupItem>()
    for (const item of items) {
      const seen = byAsin.get(item.asin)
      const deeper = !seen || depthOf(item) > depthOf(seen) ? item : seen
      byAsin.set(item.asin, {
        ...deeper,
        pinned: item.pinned || seen?.pinned === true,
      })
    }
    return [...byAsin.values()]
  }

  /** Does the re-sent `r` ask for at least what `item` asks for? */
  const covers = (r: LookupItem, item: LookupItem) =>
    r.asin === item.asin &&
    (r.pinned || !item.pinned) &&
    depthOf(r) >= depthOf(item)

  const post = (message: unknown): boolean => {
    try {
      port?.postMessage(message)
      return port !== undefined
    } catch (error) {
      // The port went away before onDisconnect told us.
      console.warn('[audible-ex] the port is closed', error)
      lost(port)
      return false
    }
  }

  /** Connects if needed. Returns the items re-sent on a new connection, or undefined if none was made. */
  const ensure = (): ReadonlyArray<LookupItem> | 'open' | undefined => {
    if (closed) return undefined
    if (port) return 'open'
    cancelReconnect?.()
    cancelReconnect = undefined
    let opened: ClientPort
    try {
      opened = options.connect()
    } catch (error) {
      console.warn('[audible-ex] cannot reach the background', error)
      reconnectLater()
      return undefined
    }
    port = opened
    connectedAt = now()
    heard = false
    opened.onMessage.addListener(raw => {
      if (port !== opened) return
      heard = true
      let message: BackgroundMessage
      try {
        message = decode(raw)
      } catch (error) {
        console.warn(
          '[audible-ex] dropped a port message that does not decode',
          error
        )
        return
      }
      if (message._tag === 'PriceUpdate') pendingPrices.delete(message.asin)
      options.onMessage(message)
    })
    opened.onDisconnect.addListener(() => lost(opened))
    post({ _tag: 'Hello', region: options.region, page: options.page })
    const resumed = options.unresolved()
    if (resumed.length > 0) post({ _tag: 'Lookup', items: resumed })
    if (pendingPrices.size > 0)
      post({ _tag: 'PriceLookup', asins: [...pendingPrices] })
    return resumed
  }

  function lost(which: ClientPort | undefined) {
    if (!which || port !== which) return
    port = undefined
    if (heard || now() - connectedAt >= STABLE_MS) failures = 0
    if (options.unresolved().length > 0 || pendingPrices.size > 0)
      reconnectLater()
  }

  function reconnectLater() {
    if (closed || cancelReconnect) return
    const delay = Math.min(FIRST_DELAY_MS * 2 ** failures, MAX_DELAY_MS)
    failures++
    cancelReconnect = options.schedule(() => {
      cancelReconnect = undefined
      ensure()
    }, delay)
  }

  return {
    lookup(items) {
      // Nothing to ask for must not open a port: that would only wake the worker.
      if (items.length === 0) return
      const state = ensure()
      if (state === undefined) return
      // A new connection has just re-sent what was unresolved, which already holds these items.
      const resumed = state === 'open' ? [] : state
      const fresh = items.filter(item => !resumed.some(r => covers(r, item)))
      if (fresh.length > 0) post({ _tag: 'Lookup', items: dedupe(fresh) })
    },
    prices(asins) {
      if (closed || asins.length === 0) return
      for (const asin of asins) pendingPrices.add(asin)
      // A new connection re-sends all pending prices in ensure().
      if (ensure() === 'open')
        post({ _tag: 'PriceLookup', asins: [...new Set(asins)] })
    },
    details(asins) {
      if (asins.length === 0 || ensure() === undefined) return
      post({ _tag: 'DetailsLookup', asins: [...new Set(asins)] })
    },
    retry(asins) {
      if (asins.length === 0 || ensure() === undefined) return
      post({ _tag: 'Retry', asins: [...asins] })
    },
    close() {
      closed = true
      pendingPrices.clear()
      cancelReconnect?.()
      cancelReconnect = undefined
      const closing = port
      port = undefined
      try {
        closing?.disconnect?.()
      } catch {
        // Already gone.
      }
    },
  }
}
