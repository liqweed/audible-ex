/**
 * Counts the ratings the panel's page shows, for the request to rate the extension
 * (DECISIONS.md D32). Lives in the panel script because it already has the page's books; the
 * worker is not involved. The count goes to `local:engagement` in batches, since a page can show
 * dozens of ratings in a second.
 */
import { useStore } from '@tanstack/react-store'
import { useEffect, useRef } from 'react'
import type { BookView } from '@/content/books'
import type { PanelHandle } from '@/content/shared'
import { recordRatings } from '@/storage/nudge'

/** How long to gather ratings before writing them. */
export const FLUSH_MS = 2000

const rated = (books: ReadonlyMap<string, BookView>): number => {
  let count = 0
  for (const view of books.values()) {
    if (view.status === 'ready' && view.rating) count++
  }
  return count
}

export function useCountRatings(
  handle: PanelHandle,
  record: (count: number) => Promise<void> = count => recordRatings(count),
  flushMs = FLUSH_MS
): void {
  const shown = useStore(handle.state, s => rated(s.books))
  const counted = useRef(0)
  const pending = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const writer = useRef(record)
  writer.current = record

  const flush = useRef(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    const count = pending.current
    pending.current = 0
    if (count > 0)
      writer.current(count).catch(error => {
        console.error('audible-ex: could not save the usage counters', error)
      })
  })

  useEffect(() => {
    // The page can start over (a new search): fewer ratings than before are not negative ones.
    const more = shown - counted.current
    counted.current = shown
    if (more <= 0) return
    pending.current += more
    timer.current ??= setTimeout(flush.current, flushMs)
  }, [shown, flushMs])

  // Nothing waits in memory once the panel goes away.
  useEffect(() => flush.current, [])
}
