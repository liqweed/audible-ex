/**
 * The `Retry-After` response header (RFC 9110 §10.2.3): a number of seconds or an HTTP date. Pure
 * TS; the clock is passed in, so a test needs no fake timers.
 */

/**
 * How many milliseconds `Retry-After` asks to wait, or `undefined` when the header is absent or
 * unreadable. A date in the past is 0.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs: number
): number | undefined {
  const text = value?.trim()
  if (!text) return undefined
  if (/^\d+$/.test(text)) return Number(text) * 1000
  // `Date.parse` reads a bare "-5" as a year; an HTTP date always names its month.
  const at = /[a-z]/i.test(text) ? Date.parse(text) : Number.NaN
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs)
}
