/**
 * The counters of one tab's lookups (ARCHITECTURE.md §5, `Progress`), as a pure function of what the
 * port server knows. The server records, per ASIN, that a lookup began and how it ended; the
 * background asks the queue which of the pending ASINs a Goodreads request is out for.
 *
 * - `done` counts every ASIN whose rating is settled, so the panel's `done / (done + queued +
 *   active)` is the bar.
 * - `cached`, `notFound` and `failed` are counted inside `done` and may overlap: a miss answered from
 *   the cache is both `cached` and `notFound`.
 * - `queued` and `active` split the ASINs still pending: `active` have a Goodreads request running,
 *   `queued` are everything else (waiting for the catalogue, for a worker, or for a pause to end).
 */

/** How one ASIN's rating ended. */
export interface Outcome {
  readonly result: 'found' | 'notFound' | 'failed'
  /** Answered from the cache, with no network request. */
  readonly cached: boolean
}

export interface Counters {
  readonly queued: number
  readonly active: number
  readonly done: number
  readonly cached: number
  readonly notFound: number
  readonly failed: number
  /** Epoch milliseconds the queue's rate-limit pause ends; only set while lookups are pending. */
  readonly pausedUntil?: number
}

export const NO_PROGRESS: Counters = {
  queued: 0,
  active: 0,
  done: 0,
  cached: 0,
  notFound: 0,
  failed: 0,
}

export function counters(
  pending: ReadonlySet<string>,
  running: ReadonlySet<string>,
  outcomes: ReadonlyMap<string, Outcome>,
  pausedUntil: number | undefined
): Counters {
  let active = 0
  for (const asin of pending) if (running.has(asin)) active++
  let cached = 0
  let notFound = 0
  let failed = 0
  for (const { result, cached: fromCache } of outcomes.values()) {
    if (fromCache) cached++
    if (result === 'notFound') notFound++
    if (result === 'failed') failed++
  }
  return {
    queued: pending.size - active,
    active,
    done: outcomes.size,
    cached,
    notFound,
    failed,
    ...(pending.size > 0 && pausedUntil !== undefined ? { pausedUntil } : {}),
  }
}

export const sameCounters = (a: Counters, b: Counters): boolean =>
  a.queued === b.queued &&
  a.active === b.active &&
  a.done === b.done &&
  a.cached === b.cached &&
  a.notFound === b.notFound &&
  a.failed === b.failed &&
  a.pausedUntil === b.pausedUntil
