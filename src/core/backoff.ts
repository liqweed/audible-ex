/**
 * How long the lookup queue pauses when Goodreads says "slow down" (DECISIONS.md D9): 5 s after the
 * first rate-limit, doubling each time up to 2 min, and at least what `Retry-After` asks. Pure TS
 * over milliseconds; the queue owns the clock and the state.
 */

/** The first pause. */
export const BACKOFF_BASE_MS = 5_000

/** The longest backoff the doubling reaches. */
export const BACKOFF_MAX_MS = 120_000

/**
 * The longest `Retry-After` honoured. A server that asks for an hour would otherwise stall the
 * queue, and every tab's badges with it, for an hour; past this the queue tries again and the
 * circuit breaker decides whether to keep going.
 */
export const RETRY_AFTER_MAX_MS = 300_000

/** The exponential backoff after `step` rate-limits in a row (1 is the first): 5 s, 10 s, 20 s, … 2 min. */
export function backoffMs(step: number): number {
  return Math.min(
    BACKOFF_BASE_MS * 2 ** (Math.max(1, step) - 1),
    BACKOFF_MAX_MS
  )
}

/**
 * The pause after the `step`-th rate-limit in a row: the backoff, raised to `retryAfterMs` (capped at
 * `RETRY_AFTER_MAX_MS`) when the response carried a `Retry-After`.
 */
export function pauseMs(step: number, retryAfterMs?: number): number {
  return Math.max(backoffMs(step), clampRetryAfter(retryAfterMs))
}

/** A `Retry-After` as the queue honours it: 0 when absent, never above `RETRY_AFTER_MAX_MS`. */
export function clampRetryAfter(retryAfterMs: number | undefined): number {
  return Math.min(Math.max(0, retryAfterMs ?? 0), RETRY_AFTER_MAX_MS)
}
