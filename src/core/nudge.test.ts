import { describe, expect, test } from 'bun:test'
import {
  addRatings,
  dayOf,
  isEligible,
  MIN_DAYS,
  MIN_RATINGS,
  NO_ENGAGEMENT,
} from './nudge'

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => `2026-11-0${i + 1}`)

describe('addRatings', () => {
  test('counts the ratings and the day', () => {
    expect(addRatings(NO_ENGAGEMENT, 5, '2026-11-01')).toEqual({
      days: ['2026-11-01'],
      ratings: 5,
    })
  })

  test('counts a day once', () => {
    const first = addRatings(NO_ENGAGEMENT, 5, '2026-11-01')
    expect(addRatings(first, 7, '2026-11-01')).toEqual({
      days: ['2026-11-01'],
      ratings: 12,
    })
  })

  test('stops listing days once there are enough, but keeps counting ratings', () => {
    const enough = { days: days(MIN_DAYS), ratings: 10 }
    expect(addRatings(enough, 4, '2026-12-31')).toEqual({
      days: days(MIN_DAYS),
      ratings: 14,
    })
  })

  test('ignores nothing-to-add, so a day without ratings is not a day of use', () => {
    expect(addRatings(NO_ENGAGEMENT, 0, '2026-11-01')).toBe(NO_ENGAGEMENT)
  })
})

describe('dayOf', () => {
  test('is the local calendar date, padded', () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
    expect(dayOf(new Date(2026, 10, 8, 0, 1).getTime())).toBe('2026-11-08')
  })
})

describe('isEligible', () => {
  const used = (daysOfUse: number, ratings: number) => ({
    days: days(daysOfUse),
    ratings,
  })

  test('needs the days, whatever else the user did', () => {
    expect(isEligible(used(MIN_DAYS - 1, 5000), true)).toBe(false)
  })

  test('is met by a changed setting after the days', () => {
    expect(isEligible(used(MIN_DAYS, 3), true)).toBe(true)
  })

  test('is met by enough ratings without a changed setting', () => {
    expect(isEligible(used(MIN_DAYS, MIN_RATINGS), false)).toBe(true)
  })

  test('is not met by a few days of little use', () => {
    expect(isEligible(used(MIN_DAYS, MIN_RATINGS - 1), false)).toBe(false)
  })
})
