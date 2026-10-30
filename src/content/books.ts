/**
 * What the content script knows about each book on the page, by ASIN. The shape is ARCHITECTURE.md
 * §6's `BookView`, so phase 2 can swap this module for the TanStack Store without touching the
 * badges: they only `get` a view and `subscribe` to changes. Until then a `Map` and a listener set
 * are all that is needed. Cards (DOM elements) are not in here; they stay in the scanner.
 */
import type { BackgroundMessage } from '../schema/messages'

export interface BookView {
  /** `queued` exists here only: the card asked, the background has not answered yet. */
  readonly status: 'queued' | 'loading' | 'ready' | 'notFound' | 'failed'
  readonly rating?: { r: number; n: number; url: string; loose: boolean }
  readonly details?: {
    readonly genres: readonly string[]
    /** First-published year; 0 when Goodreads has none, negative before year 1. */
    readonly year: number
    /** Plain text, 600 characters at most. Kept for the hover overview (#30). */
    readonly desc: string
  }
  readonly error?: { reason: string; message: string }
}

export type BookListener = (asin: string, view: BookView) => void

export interface BookStore {
  get(asin: string): BookView | undefined
  /** Replaces the view and tells every listener. */
  set(asin: string, view: BookView): void
  /** Every ASIN with its view, for the reconnect and for tests. */
  entries(): IterableIterator<[string, BookView]>
  /** Returns the function that stops listening. */
  subscribe(listener: BookListener): () => void
}

export function createBookStore(): BookStore {
  const books = new Map<string, BookView>()
  const listeners = new Set<BookListener>()
  return {
    get: asin => books.get(asin),
    set(asin, view) {
      books.set(asin, view)
      // A copy, so a listener that unsubscribes while being called cannot skip another one.
      for (const listener of [...listeners]) listener(asin, view)
    },
    entries: () => books.entries(),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The view a `BookUpdate` describes; the background's latest word replaces the earlier one. */
export function viewOf(update: BookUpdateMessage): BookView {
  return {
    status: update.status,
    ...(update.rating && { rating: update.rating }),
    ...(update.details && { details: update.details }),
    ...(update.error && { error: update.error }),
  }
}

type BookUpdateMessage = Extract<BackgroundMessage, { _tag: 'BookUpdate' }>

/**
 * True while the background has given this book no answer: queued or loading. After a worker
 * restart these are the ASINs to ask for again. A `ready` book with a rating is resolved even if
 * its details never came: a details failure is not cached, so asking again would fetch the Goodreads
 * book page again on every reconnect. Its details arrive with the next page load, through the
 * cache. `notFound` and `failed` are final too (a failure is retried by the user).
 */
export function isUnresolved(view: BookView | undefined): boolean {
  return view?.status === 'queued' || view?.status === 'loading'
}
