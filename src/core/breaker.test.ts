import { describe, expect, test } from 'bun:test'
import {
  admission,
  BREAKER_CLOSED,
  BREAKER_COOLDOWN_MS,
  BREAKER_THRESHOLD,
  type BreakerState,
  onFailure,
  onSuccess,
  releaseProbe,
  startProbe,
} from './breaker'

const failTimes = (state: BreakerState, n: number, now = 0) => {
  let next = state
  for (let i = 0; i < n; i++) next = onFailure(next, now)
  return next
}

describe('breaker', () => {
  test('allows everything while closed, below the threshold', () => {
    const state = failTimes(BREAKER_CLOSED, BREAKER_THRESHOLD - 1)
    expect(state.failures).toBe(BREAKER_THRESHOLD - 1)
    expect(admission(state, 0)).toBe('allow')
  })

  test('opens at the threshold and rejects until the cooldown is over', () => {
    const state = failTimes(BREAKER_CLOSED, BREAKER_THRESHOLD, 1_000)
    expect(state.openUntil).toBe(1_000 + BREAKER_COOLDOWN_MS)
    expect(admission(state, 1_000)).toBe('reject')
    expect(admission(state, 1_000 + BREAKER_COOLDOWN_MS - 1)).toBe('reject')
  })

  test('half-opens after the cooldown: one probe, the others wait', () => {
    const open = failTimes(BREAKER_CLOSED, BREAKER_THRESHOLD, 0)
    const at = BREAKER_COOLDOWN_MS
    expect(admission(open, at)).toBe('probe')
    const probing = startProbe(open)
    expect(admission(probing, at)).toBe('wait')
    expect(admission(releaseProbe(probing), at)).toBe('probe')
  })

  test('a probe that succeeds closes it and resets the count', () => {
    const open = failTimes(BREAKER_CLOSED, BREAKER_THRESHOLD, 0)
    const closed = onSuccess()
    expect(closed).toEqual(BREAKER_CLOSED)
    expect(admission(closed, BREAKER_COOLDOWN_MS)).toBe('allow')
    expect(open.openUntil).toBeDefined()
  })

  test('a probe that fails opens it for another full cooldown', () => {
    const open = failTimes(BREAKER_CLOSED, BREAKER_THRESHOLD, 0)
    const at = BREAKER_COOLDOWN_MS + 10
    const reopened = onFailure(startProbe(open), at)
    expect(reopened.openUntil).toBe(at + BREAKER_COOLDOWN_MS)
    expect(reopened.probing).toBe(false)
    expect(admission(reopened, at)).toBe('reject')
  })

  test('a failure that arrives while open changes nothing', () => {
    const open = failTimes(BREAKER_CLOSED, BREAKER_THRESHOLD, 0)
    expect(onFailure(open, 10)).toBe(open)
  })

  test('a success in the middle starts the count again', () => {
    const state = failTimes(BREAKER_CLOSED, BREAKER_THRESHOLD - 1)
    const next = failTimes(onSuccess(), BREAKER_THRESHOLD - 1)
    expect(admission(next, 0)).toBe('allow')
    expect(state.failures).toBe(next.failures)
  })
})
