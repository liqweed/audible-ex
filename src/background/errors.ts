/**
 * The typed failures of the two network services, `AudibleCatalog` and `Goodreads` (ARCHITECTURE.md
 * §4). "Not found on Goodreads" is a result, not one of these. `CacheError` is in `BookCache.ts`.
 * Failures are never cached; the content script can retry them.
 */

import * as Data from 'effect/Data'
import type * as Duration from 'effect/Duration'

/**
 * The server answered with a status the services do not handle, or did not answer. `status` is 0
 * when there was no response (network down, blocked, timed out); `cause` is what `fetch` threw.
 */
export class HttpError extends Data.TaggedError('HttpError')<{
  readonly status: number
  readonly url: string
  readonly cause: unknown
}> {
  override get message() {
    return this.status === 0
      ? `No response from ${this.url}`
      : `HTTP ${this.status} from ${this.url}`
  }
}

/**
 * The source asks us to slow down: `429` and `503`, and a Goodreads book page that answers `202` or
 * with an empty body (a bot or rate challenge, seen in the phase 0 spike). `retryAfter` is what its
 * `Retry-After` header asks for, when it sends one; the queue pauses at least that long.
 */
export class RateLimited extends Data.TaggedError('RateLimited')<{
  readonly status: number
  readonly url: string
  readonly retryAfter: Duration.Duration | undefined
}> {
  override get message() {
    return `Rate limited (HTTP ${this.status}) by ${this.url}`
  }
}

/** Where a response that did not have the expected shape came from. */
export type FormatSource = 'autocomplete' | 'bookPage' | 'catalog'

/**
 * A response arrived but is not in the format the extension reads: Goodreads or Audible changed it.
 * Reported separately from network trouble (the panel says the extension needs an update), and never
 * mistaken for a miss. `detail` names the field that failed to decode.
 */
export class FormatChanged extends Data.TaggedError('FormatChanged')<{
  readonly source: FormatSource
  readonly detail: string
}> {
  override get message() {
    return `The ${this.source} response changed format: ${this.detail}`
  }
}

/** Audible's catalogue has no title for the ASIN on the marketplace that was asked. */
export class NoMetadata extends Data.TaggedError('NoMetadata')<{
  readonly asin: string
}> {
  override get message() {
    return `Audible has no metadata for ${this.asin}`
  }
}

/**
 * The queue's circuit breaker is open: repeated Goodreads failures stopped all traffic, and this
 * lookup was failed at once instead of waiting (ARCHITECTURE.md §4). `lastFailure` is the failure
 * that tripped it, so the panel can say why; `reopensAt` is when the breaker allows a probe request
 * (epoch milliseconds). Like any failure it is not cached; a retry after `reopensAt` goes through.
 */
export class CircuitOpen extends Data.TaggedError('CircuitOpen')<{
  readonly lastFailure: HttpError | RateLimited | FormatChanged
  readonly reopensAt: number
}> {
  override get message() {
    return `Goodreads lookups are stopped after repeated failures (${this.lastFailure.message})`
  }
}
