/**
 * The request to rate the extension (DECISIONS.md D32): when to show it, and the hook that shows it
 * at most once. The panel and the popup both use it; whichever is ready first shows it and the other
 * sees that it was shown. The rules are in `src/core/nudge.ts`.
 */
import { useCallback, useEffect, useState } from 'react'
import { type Engagement, isEligible, NO_ENGAGEMENT } from '@/core/nudge'
import {
  markNudgeShown,
  type Nudge,
  readEngagement,
  readNudge,
  watchEngagement,
  watchNudge,
} from '@/storage/nudge'
import {
  DEFAULT_PREFS,
  type Prefs,
  readPrefs,
  watchPrefs,
} from '@/storage/prefs'

const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  )
    return false
  const left = Object.entries(a)
  if (left.length !== Object.keys(b).length) return false
  return left.every(([key, value]) =>
    same(value, (b as Record<string, unknown>)[key])
  )
}

/**
 * Has the user changed anything the options page or the panel offers? The master switch does not
 * count: turning the extension off and on is not making it one's own. A setting put back to its
 * default no longer counts, and then the ratings seen decide.
 */
export const isCustomized = (prefs: Prefs): boolean =>
  !same({ ...prefs, enabled: true }, DEFAULT_PREFS)

const log = (what: string) => (error: unknown) =>
  console.error(`audible-ex: could not ${what}`, error)

interface Known {
  engagement: Engagement
  nudge: Nudge
  customized: boolean
}

/**
 * Whether to show the request now. `ready` says the surface is calm enough for it (the panel waits
 * until its lookups are done). Once it shows, `visible` stays true until `close` or until the
 * surface goes away, even though the stored flag then says "shown": that flag only keeps other
 * tabs, the popup and later visits from showing it again.
 */
export function useRatingNudge(ready: boolean): {
  visible: boolean
  close: () => void
} {
  const [known, setKnown] = useState<Partial<Known>>({})
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let current = true
    const set = (patch: Partial<Known>) =>
      current && setKnown(before => ({ ...before, ...patch }))
    readEngagement().then(
      engagement => set({ engagement }),
      log('read the usage counters')
    )
    readNudge().then(nudge => set({ nudge }), log('read the rating request'))
    readPrefs().then(
      prefs => set({ customized: isCustomized(prefs) }),
      log('read the settings')
    )
    const stops = [
      watchEngagement(engagement => set({ engagement })),
      watchNudge(nudge => set({ nudge })),
      watchPrefs(prefs => set({ customized: isCustomized(prefs) })),
    ]
    return () => {
      current = false
      for (const stop of stops) stop()
    }
  }, [])

  const { engagement = NO_ENGAGEMENT, nudge, customized } = known
  const due =
    nudge !== undefined &&
    customized !== undefined &&
    !nudge.shown &&
    isEligible(engagement, customized)

  useEffect(() => {
    if (visible || !ready || !due) return
    setVisible(true)
    markNudgeShown().catch(log('save that the rating request was shown'))
  }, [visible, ready, due])

  const close = useCallback(() => setVisible(false), [])
  return { visible, close }
}
