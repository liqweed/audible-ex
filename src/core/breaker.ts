/**
 * The circuit breaker of the lookup queue (DECISIONS.md D9), as pure transitions over a small state
 * value; the queue owns the clock and the state. After `BREAKER_THRESHOLD` failures in a row it
 * opens and Goodreads sees no traffic for `BREAKER_COOLDOWN_MS`. Then it is half-open: one job, the
 * probe, goes through while the others wait. A probe that succeeds closes the breaker; one that
 * fails opens it for another cooldown. Any success closes a closed breaker's failure count again.
 */

/** Failures in a row that open the breaker. */
export const BREAKER_THRESHOLD = 5

/** How long an open breaker keeps Goodreads traffic stopped. */
export const BREAKER_COOLDOWN_MS = 300_000

export interface BreakerState {
  /** Failures since the last success. */
  readonly failures: number
  /** When the cooldown ends; undefined while closed. Past it, the breaker is half-open. */
  readonly openUntil: number | undefined
  /** A probe is in flight (half-open only). */
  readonly probing: boolean
}

export const BREAKER_CLOSED: BreakerState = {
  failures: 0,
  openUntil: undefined,
  probing: false,
}

/**
 * What a job arriving at `now` may do: `allow` (closed), `reject` (open: fail it fast), `probe` (the
 * cooldown is over and nobody is probing: this job is the probe) or `wait` (a probe is in flight:
 * hold until it settles, then ask again).
 */
export type Admission = 'allow' | 'reject' | 'probe' | 'wait'

export function admission(state: BreakerState, now: number): Admission {
  if (state.openUntil === undefined) return 'allow'
  if (now < state.openUntil) return 'reject'
  return state.probing ? 'wait' : 'probe'
}

/** The job that got `probe` is on its way. */
export const startProbe = (state: BreakerState): BreakerState => ({
  ...state,
  probing: true,
})

/** The probe ended without telling us anything (a rate-limit another job already accounted for). */
export const releaseProbe = (state: BreakerState): BreakerState => ({
  ...state,
  probing: false,
})

/** A job succeeded: the breaker is closed and the count starts again. */
export const onSuccess = (): BreakerState => BREAKER_CLOSED

/**
 * A job failed at `now`. A closed breaker counts it and opens at the threshold; a half-open one
 * (the probe failed) opens for another cooldown; one that is already open stays as it is, since the
 * failure belongs to a job that started before it opened.
 */
export function onFailure(state: BreakerState, now: number): BreakerState {
  if (state.openUntil !== undefined) {
    return now < state.openUntil
      ? state
      : {
          failures: state.failures + 1,
          openUntil: now + BREAKER_COOLDOWN_MS,
          probing: false,
        }
  }
  const failures = state.failures + 1
  return failures >= BREAKER_THRESHOLD
    ? { failures, openUntil: now + BREAKER_COOLDOWN_MS, probing: false }
    : { failures, openUntil: undefined, probing: false }
}
