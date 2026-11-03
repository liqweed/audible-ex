import { useStore } from '@tanstack/react-store'
import { useEffect, useState } from 'react'
import type { PanelHandle } from '@/content/shared'
import { counts, hasFormatChange, panelView, secondsLeft } from './summary'

/** The clock, ticking every second while `active`, for the countdown of a rate-limit pause. */
function useNow(active: boolean, clock: () => number): number {
  const [now, setNow] = useState(clock)
  useEffect(() => {
    if (!active) return
    setNow(clock())
    const timer = setInterval(() => setNow(clock()), 1000)
    return () => clearInterval(timer)
  }, [active, clock])
  return active ? now : clock()
}

/**
 * The floating panel's body: progress of this tab's lookups. It shows nothing until the tab has
 * asked for a book. The shell around it (drag, collapse, hide) comes with the placement preferences.
 */
export function Panel({
  handle,
  clock = Date.now,
}: {
  handle: PanelHandle
  clock?: () => number
}) {
  const progress = useStore(handle.state, s => s.progress)
  const formatChanged = useStore(handle.state, s => hasFormatChange(s.books))
  const now = useNow(progress?.pausedUntil !== undefined, clock)
  const view = panelView(progress, formatChanged, now)
  if (view.kind === 'hidden') return null

  return (
    <section
      aria-label='Goodreads ratings'
      className='fixed right-4 bottom-4 z-[2147483647] w-72 rounded-lg border border-slate-300 bg-white p-3 font-sans text-sm text-slate-900 shadow-lg'
    >
      {view.kind === 'formatChanged' ? (
        <p role='alert' className='text-red-700'>
          Goodreads changed its page format — the extension needs an update.
        </p>
      ) : (
        <>
          <div className='mb-1 flex items-center justify-between gap-2'>
            <span className='font-semibold'>Goodreads ratings</span>
            {view.failed > 0 && (
              <button
                type='button'
                onClick={() => handle.retryFailed()}
                className='rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100'
              >
                Retry failed
              </button>
            )}
          </div>
          <div
            role='progressbar'
            aria-label='Ratings looked up'
            aria-valuemin={0}
            aria-valuemax={view.total}
            aria-valuenow={view.done}
            className='h-2 overflow-hidden rounded bg-slate-200'
          >
            <div
              className={`h-full ${view.finished ? 'bg-emerald-600' : 'bg-indigo-600'}`}
              style={{ width: `${(view.done / view.total) * 100}%` }}
            />
          </div>
          <p role='status' className='mt-1 text-xs text-slate-600'>
            {counts(view)}
          </p>
          {view.pausedUntil !== undefined && (
            <p className='mt-1 text-xs text-amber-700'>
              Paused — Goodreads is rate limiting (
              {secondsLeft(view.pausedUntil, now)} s)
            </p>
          )}
        </>
      )}
    </section>
  )
}
