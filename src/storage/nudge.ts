/**
 * What the request to rate the extension needs to remember (DECISIONS.md D32, ARCHITECTURE.md §8):
 *
 * - `local:engagement`, in `storage.local`: how many days and ratings the panel has seen. It changes
 *   often and belongs to this device, so it does not sync.
 * - `sync:nudge`: whether the request has been shown. It is tiny and written once, so it follows the
 *   Chrome profile and a user with two computers is asked once, not twice.
 *
 * Both stay in the browser; nothing is sent anywhere. Change a shape → bump `version`, add a migration.
 */
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { storage } from 'wxt/utils/storage'
import {
  addRatings,
  dayOf,
  type Engagement,
  MIN_DAYS,
  NO_ENGAGEMENT,
} from '../core/nudge'
import { serial } from './serial'

const EngagementRecord = Schema.Struct({
  days: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed<readonly string[]>([]))
  ),
  ratings: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(0))
  ),
})

const NudgeRecord = Schema.Struct({
  /** The request has been put in front of the user, once; it is never shown again. */
  shown: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false))
  ),
})
export type Nudge = typeof NudgeRecord.Type

export const NOT_SHOWN: Nudge = { shown: false }

const decodeEngagement = Schema.decodeUnknownOption(EngagementRecord)
const decodeNudge = Schema.decodeUnknownOption(NudgeRecord)

/** The counters a stored value stands for; anything that is not a record of them starts from zero. */
export const decodeEngagementValue = (raw: unknown): Engagement =>
  Option.match(decodeEngagement(raw), {
    onNone: () => NO_ENGAGEMENT,
    onSome: ({ days, ratings }) => ({ days: days.slice(0, MIN_DAYS), ratings }),
  })

export const decodeNudgeValue = (raw: unknown): Nudge =>
  Option.getOrElse(decodeNudge(raw), () => NOT_SHOWN)

const engagementItem = storage.defineItem<unknown>('local:engagement', {
  fallback: NO_ENGAGEMENT,
  version: 1,
})
const nudgeItem = storage.defineItem<unknown>('sync:nudge', {
  fallback: NOT_SHOWN,
  version: 1,
})

const queue = serial()

export const readEngagement = async (): Promise<Engagement> =>
  decodeEngagementValue(await engagementItem.getValue())

/** Adds `count` ratings shown on `today` (default: now) to the counters. */
export const recordRatings = (
  count: number,
  today = dayOf(Date.now())
): Promise<void> =>
  queue(async () => {
    const current = await readEngagement()
    await engagementItem.setValue(addRatings(current, count, today))
  })

export const watchEngagement = (
  listener: (engagement: Engagement) => void
): (() => void) =>
  engagementItem.watch(value => listener(decodeEngagementValue(value)))

export const readNudge = async (): Promise<Nudge> =>
  decodeNudgeValue(await nudgeItem.getValue())

/** Records that the request was shown, for good. */
export const markNudgeShown = (): Promise<void> =>
  nudgeItem.setValue({ shown: true })

export const watchNudge = (listener: (nudge: Nudge) => void): (() => void) =>
  nudgeItem.watch(value => listener(decodeNudgeValue(value)))
