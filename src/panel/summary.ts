/**
 * What the panel shows for the tab's state, as a pure function of the progress counters, the books
 * and the clock (PRD R2). `done` counts every book whose rating is settled, so the bar is
 * `done / total` with `total = done + queued + active` (`src/core/progress.ts`).
 */
import type { BookView, ProgressView } from '@/content/books'

export type PanelView =
  | { readonly kind: 'hidden' }
  /** Goodreads' page no longer decodes: not a network problem, the extension needs an update. */
  | { readonly kind: 'formatChanged' }
  | {
      readonly kind: 'progress'
      readonly done: number
      readonly total: number
      readonly cached: number
      readonly notFound: number
      readonly failed: number
      /** Every book is settled. */
      readonly finished: boolean
      /** Epoch milliseconds the rate-limit pause ends; only while it is still ahead. */
      readonly pausedUntil: number | undefined
    }

/** Did any lookup fail because Goodreads' pages changed shape? */
export const hasFormatChange = (
  books: ReadonlyMap<string, BookView>
): boolean => {
  for (const view of books.values()) {
    if (view.status === 'failed' && view.error?.reason === 'formatChanged')
      return true
  }
  return false
}

export function panelView(
  progress: ProgressView | undefined,
  formatChanged: boolean,
  now: number
): PanelView {
  if (formatChanged) return { kind: 'formatChanged' }
  if (!progress) return { kind: 'hidden' }
  const total = progress.done + progress.queued + progress.active
  if (total === 0) return { kind: 'hidden' }
  const { pausedUntil } = progress
  return {
    kind: 'progress',
    done: progress.done,
    total,
    cached: progress.cached,
    notFound: progress.notFound,
    failed: progress.failed,
    finished: progress.queued + progress.active === 0,
    pausedUntil:
      pausedUntil !== undefined && pausedUntil > now ? pausedUntil : undefined,
  }
}

/** `34/60 · 18 cached · 2 not found · 1 failed`: the counts that are not zero. */
export function counts(view: Extract<PanelView, { kind: 'progress' }>): string {
  return [
    `${view.done}/${view.total}`,
    view.cached > 0 && `${view.cached} cached`,
    view.notFound > 0 && `${view.notFound} not found`,
    view.failed > 0 && `${view.failed} failed`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Whole seconds until `until`, at least 1 while the pause is still ahead. */
export const secondsLeft = (until: number, now: number): number =>
  Math.max(1, Math.ceil((until - now) / 1000))
