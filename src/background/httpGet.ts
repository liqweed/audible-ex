/**
 * The one way the network services fetch (the userscript's `get`): a GET with an `Accept` header, a
 * time limit, no cookies, and the response status mapped to the typed errors of `errors.ts`.
 *
 * Requests carry `credentials: 'omit'`, so a lookup is never tied to the user's Goodreads or Audible
 * account. It is set on each request here and not left to the layer, so no wiring can lose it.
 */

// @effect-diagnostics unstableApiUsage:off (effect/http is unstable by Effect's label; DECISIONS.md D16)

import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { parseRetryAfter } from '../core/retryAfter'
import { HttpError, RateLimited } from './errors'

/** The userscript's limit for one request. */
export const REQUEST_TIMEOUT = Duration.seconds(15)

/** Statuses that mean "slow down": the queue backs off on these. */
const isRateLimit = (status: number) => status === 429 || status === 503

export interface TextResponse {
  readonly status: number
  readonly text: string
}

/**
 * GETs `url` and returns the body of a `2xx` answer. `429` and `503` fail with `RateLimited`
 * (carrying `Retry-After`), any other status outside `2xx` and any transport failure with `HttpError`.
 * Reading the body is part of the request, so a body that breaks off is an `HttpError` too.
 */
export const getText = (
  url: string,
  accept: 'application/json' | 'text/html'
): Effect.Effect<
  TextResponse,
  HttpError | RateLimited,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const transport = (cause: unknown) =>
      new HttpError({ status: 0, url, cause })
    const response = yield* client
      .execute(
        HttpClientRequest.get(url).pipe(HttpClientRequest.accept(accept))
      )
      .pipe(Effect.mapError(transport))
    const { status } = response
    if (isRateLimit(status)) {
      const now = yield* Clock.currentTimeMillis
      const waitMs = parseRetryAfter(response.headers['retry-after'], now)
      return yield* new RateLimited({
        status,
        url,
        retryAfter: waitMs === undefined ? undefined : Duration.millis(waitMs),
      })
    }
    if (status < 200 || status > 299) {
      return yield* new HttpError({ status, url, cause: undefined })
    }
    const text = yield* response.text.pipe(Effect.mapError(transport))
    return { status, text }
  }).pipe(
    Effect.timeoutOrElse({
      duration: REQUEST_TIMEOUT,
      orElse: () =>
        Effect.fail(new HttpError({ status: 0, url, cause: 'timed out' })),
    }),
    Effect.provideService(FetchHttpClient.RequestInit, { credentials: 'omit' }),
    // Effect adds `b3` and `traceparent` headers to every request; the sources get `Accept` only.
    Effect.provideService(HttpClient.TracerPropagationEnabled, false)
  )
