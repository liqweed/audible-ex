/**
 * A fake network for the service tests: the real `FetchHttpClient` over a `fetch` that answers from
 * a function and records every request. Faking `fetch` rather than `HttpClient` means the tests see
 * what the browser would be given: the URL, the `Accept` header and the `credentials` option. Test
 * code only; the extension never imports this.
 */

// @effect-diagnostics unstableApiUsage:off (effect/http is unstable by Effect's label; DECISIONS.md D16)

import { FetchHttpClient, type HttpClient } from 'effect/http'
import * as Layer from 'effect/Layer'

/** One request as the fake `fetch` received it. */
export interface SeenRequest {
  readonly url: string
  readonly credentials: RequestCredentials | undefined
  readonly accept: string | null
  /** Every header sent, names in lower case. */
  readonly headers: Readonly<Record<string, string>>
}

/** What the fake answers with; a rejected promise or a thrown error is a network failure. */
export type Reply = Response | Promise<Response>

export interface FakeHttp {
  /** Every request so far, in the order they arrived. */
  readonly requests: SeenRequest[]
  /** Provides `HttpClient` (and the fake `fetch` it calls). */
  readonly layer: Layer.Layer<HttpClient.HttpClient>
}

export const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), init)

export const html = (body: string, init?: ResponseInit): Response =>
  new Response(body, init)

export function fakeHttp(reply: (url: string) => Reply): FakeHttp {
  const requests: SeenRequest[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({
      url,
      credentials: init?.credentials,
      accept: new Headers(init?.headers).get('accept'),
      headers: Object.fromEntries(new Headers(init?.headers)),
    })
    return reply(url)
  }) as typeof globalThis.fetch
  return {
    requests,
    layer: Layer.merge(
      FetchHttpClient.layer,
      Layer.succeed(FetchHttpClient.Fetch, fetch)
    ),
  }
}
