/**
 * When the one request to rate the extension may be shown (DECISIONS.md D32). Pure: the stored
 * counters and whether the user changed a setting come in; a yes or no goes out. Nothing here leaves the device.
 *
 * Someone has used the extension enough when they have seen ratings on at least `MIN_DAYS` different
 * days, and either changed a setting (a filter, a highlight, the display) or seen at least
 * `MIN_RATINGS` ratings, which is use without any need to change a setting.
 */
/** Days on which ratings were shown before the request is considered. */
export const MIN_DAYS = 3
/** Ratings shown, in all, that stand in for a changed setting. */
export const MIN_RATINGS = 200

/** What the panel counts as it works; kept in `storage.local`. */
export interface Engagement {
  /** Distinct local dates (`2026-11-08`) with a rating shown, the first `MIN_DAYS` of them. */
  readonly days: readonly string[]
  /** Ratings shown in all, on any Audible page. */
  readonly ratings: number
}

export const NO_ENGAGEMENT: Engagement = { days: [], ratings: 0 }

/** The local calendar date of `ms`: a day of use is the user's day, not UTC's. */
export function dayOf(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** `engagement` after `count` more ratings were shown on `today`. */
export function addRatings(
  engagement: Engagement,
  count: number,
  today: string
): Engagement {
  if (count <= 0) return engagement
  const known =
    engagement.days.includes(today) || engagement.days.length >= MIN_DAYS
  return {
    days: known ? engagement.days : [...engagement.days, today],
    ratings: engagement.ratings + count,
  }
}

/** May the request be shown? `customized`: the user changed a setting (`isCustomized`, src/lib/nudge.ts). */
export function isEligible(
  engagement: Engagement,
  customized: boolean
): boolean {
  if (engagement.days.length < MIN_DAYS) return false
  return customized || engagement.ratings >= MIN_RATINGS
}
