/**
 * The progress of one tab's lookups (ARCHITECTURE.md §4, §5). The port server tells the tab's
 * tracker when a lookup begins and how its rating ended; the tracker turns that, with what the queue
 * knows (which searches are running, whether traffic is paused), into the `Progress` counters of
 * `src/core/progress.ts` and publishes them when they change.
 *
 * Publishing is coalesced: after a publish the tracker waits `PUBLISH_GAP` before it looks again, so
 * a burst of cached answers is one message, not sixty. While lookups are pending it also looks every
 * `POLL` even when nothing was reported, because the queue's pause and its running searches change
 * without the port server hearing of it. With nothing pending it sleeps until the next report.
 */

import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import type * as Scope from 'effect/Scope'
import {
  type Counters,
  counters,
  NO_PROGRESS,
  type Outcome,
  sameCounters,
} from '../core/progress'
import { LookupQueue } from './LookupQueue'

/** The least time between two `Progress` messages to one tab. */
export const PUBLISH_GAP = Duration.millis(100)

/** How often a tab with pending lookups checks the queue's pause and running searches. */
export const POLL = Duration.millis(500)

/** What the port server reports about one tab. Synchronous, so it can be called anywhere. */
export interface PortProgress {
  /** A lookup of `asin` started; a repeated lookup (a retry) takes back its earlier outcome. */
  readonly begin: (asin: string) => void
  /** The rating of `asin` is settled. */
  readonly end: (asin: string, outcome: Outcome) => void
}

export interface ProgressHubService {
  /**
   * Starts tracking a tab and calls `publish` with the counters whenever they change, but not for a
   * tab that has asked for nothing. The publisher stops with the caller's scope.
   */
  readonly track: (
    publish: (progress: Counters) => Effect.Effect<void>
  ) => Effect.Effect<PortProgress, never, Scope.Scope>
}

export class ProgressHub extends Context.Service<
  ProgressHub,
  ProgressHubService
>()('audible-ex/ProgressHub') {
  static layer: Layer.Layer<ProgressHub, never, LookupQueue> = Layer.effect(
    ProgressHub,
    Effect.gen(function* () {
      const queue = yield* LookupQueue

      return ProgressHub.of({
        track: publish =>
          Effect.gen(function* () {
            const pending = new Set<string>()
            const outcomes = new Map<string, Outcome>()
            /** One pending "something changed" is enough, however many came. */
            const changed = yield* Queue.sliding<void>(1)
            const poke = () => Queue.offerUnsafe(changed, undefined)

            const snapshot = Effect.gen(function* () {
              const running = yield* queue.running
              const paused = yield* queue.pausedUntil
              return counters(
                pending,
                running,
                outcomes,
                Option.getOrUndefined(paused)
              )
            })

            yield* Effect.gen(function* () {
              let last = NO_PROGRESS
              while (true) {
                const now = yield* snapshot
                if (!sameCounters(last, now)) {
                  last = now
                  yield* publish(now)
                }
                yield* pending.size > 0
                  ? Queue.take(changed).pipe(Effect.timeoutOption(POLL))
                  : Queue.take(changed)
                yield* Effect.sleep(PUBLISH_GAP)
              }
            }).pipe(Effect.forkScoped)

            return {
              begin: asin => {
                outcomes.delete(asin)
                pending.add(asin)
                poke()
              },
              end: (asin, outcome) => {
                pending.delete(asin)
                outcomes.set(asin, outcome)
                poke()
              },
            } satisfies PortProgress
          }),
      })
    })
  )
}
