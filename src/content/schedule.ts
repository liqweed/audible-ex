/**
 * The one timer the content script needs, as a parameter so tests can run it by hand: runs `fn`
 * after `ms` milliseconds and returns the function that cancels it.
 */
export type Schedule = (fn: () => void, ms: number) => () => void

export const timeout: Schedule = (fn, ms) => {
  const id = setTimeout(fn, ms)
  return () => clearTimeout(id)
}
