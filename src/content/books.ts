/**
 * What the content script knows about this tab, in a TanStack Store (ARCHITECTURE.md §6): each
 * book by ASIN (`BookView`) and the background's latest progress counters. The panel reads the
 * store with selectors; the badges and the hover overview keep to `get` and `subscribe`, which tell
 * them which book changed, so they redraw one book's cards and not the page. Cards (DOM elements)
 * are not in here; they stay in the scanner.
 */
import { createStore, type Store } from '@tanstack/store'
import type { BackgroundMessage } from '../schema/messages'

export interface BookView {
  /** `queued` exists here only: the card asked, the background has not answered yet. */
  readonly status: 'queued' | 'loading' | 'ready' | 'notFound' | 'failed'
  readonly rating?: { r: number; n: number; url: string; loose: boolean }
  readonly details?: {
    readonly genres: readonly string[]
    /** First-published year; 0 when Goodreads has none, negative before year 1. */
    readonly year: number
    /** Plain text, 600 characters at most. Shown by the hover overview. */
    readonly desc: string
  }
  readonly price?: { readonly amount: number; readonly currency: string }
  readonly error?: { reason: string; message: string }
}

/** A `ready` book that has a rating and an overview text. */
export type WithOverview = BookView & {
  readonly rating: NonNullable<BookView['rating']>
  readonly details: NonNullable<BookView['details']>
}

/** True for a book with a rating and an overview to show; the others get the plain tooltip. */
export const hasOverview = (view: BookView | undefined): view is WithOverview =>
  view?.status === 'ready' && !!view.rating && !!view.details?.desc

export type BookListener = (asin: string, view: BookView) => void

/** The background's counters for this tab (a `Progress` message without its tag). */
export type ProgressView = Omit<
  Extract<BackgroundMessage, { _tag: 'Progress' }>,
  '_tag'
>

export interface ContentState {
  readonly books: ReadonlyMap<string, BookView>
  /** The latest counters; undefined until the background has sent any. */
  readonly progress: ProgressView | undefined
}

export interface BookStore {
  /** The state the panel selects from. Change it through the methods below only. */
  readonly state: Store<ContentState>
  get(asin: string): BookView | undefined
  /** Replaces the view and tells every listener. */
  set(asin: string, view: BookView): void
  /** Every ASIN with its view, for the reconnect and for tests. */
  entries(): IterableIterator<[string, BookView]>
  /** Returns the function that stops listening. */
  subscribe(listener: BookListener): () => void
  /** Keeps the background's latest counters; they replace the earlier ones. */
  setProgress(progress: ProgressView): void
}

export function createBookStore(): BookStore {
  const state = createStore<ContentState>({
    books: new Map(),
    progress: undefined,
  })
  const listeners = new Set<BookListener>()
  return {
    state,
    get: asin => state.get().books.get(asin),
    set(asin, view) {
      state.setState(prev => ({
        ...prev,
        books: new Map(prev.books).set(asin, view),
      }))
      // A copy, so a listener that unsubscribes while being called cannot skip another one.
      for (const listener of [...listeners]) listener(asin, view)
    },
    entries: () => state.get().books.entries(),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setProgress(progress) {
      state.setState(prev => ({ ...prev, progress }))
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
