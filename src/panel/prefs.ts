/**
 * The panel's hold on the `filters` pref: the filter settings and the pill both read it, and both
 * save through `updateFilters`, so every Audible tab follows (ARCHITECTURE.md §8).
 */
import { Debouncer } from '@tanstack/pacer/debouncer'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_FILTERS,
  type Filters as FilterPrefs,
  readPrefs,
  updateFilters,
  watchPrefs,
} from '@/storage/prefs'

const SAVE_WAIT_MS = 300

export type FilterChange =
  | Partial<FilterPrefs>
  | ((current: FilterPrefs) => Partial<FilterPrefs>)

/** The filters pref, kept in step with storage; `change` shows the change now and saves it. */
export function useFilterPrefs() {
  const [filters, setFilters] = useState<FilterPrefs>()
  useEffect(() => {
    let current = true
    readPrefs().then(
      prefs => current && setFilters(known => known ?? prefs.filters),
      error => {
        console.error('audible-ex: could not read the filters', error)
        if (current) setFilters(known => known ?? DEFAULT_FILTERS)
      }
    )
    const stop = watchPrefs(prefs => setFilters(prefs.filters))
    return () => {
      current = false
      stop()
    }
  }, [])
  const change = useMemo(
    () => (patch: FilterChange) => {
      setFilters(
        known =>
          known && {
            ...known,
            ...(typeof patch === 'function' ? patch(known) : patch),
          }
      )
      updateFilters(patch).catch(error =>
        console.error('audible-ex: could not save the filters', error)
      )
    },
    []
  )
  return { filters, change }
}

/**
 * A value the user changes continuously (the slider, a number being typed): it shows at once and is
 * saved once the user pauses, and still saved if the panel goes away first. `outside` is the saved
 * value, which replaces the shown one when another tab changes it.
 */
export function useDebouncedValue<T>(outside: T, save: (value: T) => void) {
  const [value, setValue] = useState(outside)
  const saver = useRef(save)
  saver.current = save
  const debouncer = useMemo(
    () => new Debouncer((v: T) => saver.current(v), { wait: SAVE_WAIT_MS }),
    []
  )
  useEffect(() => {
    // The echo of an earlier save must not pull the thumb back while the user is still moving it.
    if (!debouncer.store.state.isPending) setValue(outside)
  }, [outside, debouncer])
  useEffect(() => () => debouncer.flush(), [debouncer])
  return [
    value,
    (next: T) => {
      setValue(next)
      debouncer.maybeExecute(next)
    },
  ] as const
}
