import { useStore } from '@tanstack/react-store'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PanelHandle } from '@/content/shared'
import {
  type Corner,
  DEFAULT_PANEL,
  type PanelState,
  type PanelStorage,
  panelStorage,
} from '@/storage/panel'
import { useDrag } from './drag'
import {
  counts,
  hasFormatChange,
  panelView,
  pillText,
  secondsLeft,
} from './summary'

const CORNER_CLASS: Record<Corner, string> = {
  topLeft: 'top-4 left-4',
  topRight: 'top-4 right-4',
  bottomLeft: 'bottom-4 left-4',
  bottomRight: 'right-4 bottom-4',
}

const iconButton =
  'flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:bg-slate-100'

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
 * The panel's stored state, undefined until it has been read (the panel draws nothing before, so it
 * never flashes at the wrong corner). `change` applies at once and is saved; the watcher brings in
 * what another tab changed.
 */
function usePanelState(storage: PanelStorage) {
  const [state, setState] = useState<PanelState>()
  useEffect(() => {
    let current = true
    storage.read().then(
      read => current && setState(known => known ?? read),
      error => {
        console.error('audible-ex: could not read the panel placement', error)
        if (current) setState(known => known ?? DEFAULT_PANEL)
      }
    )
    const stop = storage.watch(setState)
    return () => {
      current = false
      stop()
    }
  }, [storage])
  const change = useCallback(
    (patch: (current: PanelState) => Partial<PanelState>) => {
      setState(known => known && { ...known, ...patch(known) })
      storage
        .update(patch)
        .catch(error =>
          console.error('audible-ex: could not save the panel placement', error)
        )
    },
    [storage]
  )
  return { state, change }
}

/**
 * The floating panel: progress of this tab's lookups. It shows nothing until the tab has
 * asked for a book. The shell around it (drag, collapse, hide) comes with the placement preferences.
 */
export function Panel({
  handle,
  clock = Date.now,
  storage = panelStorage,
  host = location.hostname,
}: {
  handle: PanelHandle
  clock?: () => number
  storage?: PanelStorage
  host?: string
}) {
  const progress = useStore(handle.state, s => s.progress)
  const formatChanged = useStore(handle.state, s => hasFormatChange(s.books))
  const now = useNow(progress?.pausedUntil !== undefined, clock)
  const view = panelView(progress, formatChanged, now)
  const { state, change } = usePanelState(storage)
  const box = useRef<HTMLDivElement>(null)
  const dock = useCallback(
    (corner: Corner) => change(() => ({ corner })),
    [change]
  )
  const drag = useDrag(box, dock)
  if (view.kind === 'hidden' || !state || state.hiddenHosts.includes(host))
    return null

  return (
    <div
      ref={box}
      className={`fixed z-[2147483647] font-sans text-sm text-slate-900 ${drag.at ? '' : CORNER_CLASS[state.corner]}`}
      style={
        drag.at && {
          left: drag.at.left,
          top: drag.at.top,
          right: 'auto',
          bottom: 'auto',
        }
      }
    >
      {state.collapsed ? (
        <button
          type='button'
          aria-label={`Goodreads ratings ${pillText(view)}, expand`}
          title='Expand'
          onClick={() => {
            if (!drag.wasDrag()) change(() => ({ collapsed: false }))
          }}
          {...drag.handlers}
          className='cursor-grab touch-none rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold shadow-lg select-none'
        >
          {pillText(view)}
        </button>
      ) : (
        <section
          aria-label='Goodreads ratings'
          className='w-72 rounded-lg border border-slate-300 bg-white p-3 shadow-lg'
        >
          <div className='mb-1 flex items-center justify-between gap-2'>
            <span
              {...drag.handlers}
              title='Drag to a corner'
              className='flex-1 cursor-grab touch-none font-semibold select-none'
            >
              Goodreads ratings
            </span>
            {view.kind === 'progress' && view.failed > 0 && (
              <button
                type='button'
                onClick={() => handle.retryFailed()}
                className='rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100'
              >
                Retry failed
              </button>
            )}
            <button
              type='button'
              aria-label='Collapse'
              title='Collapse'
              onClick={() => change(() => ({ collapsed: true }))}
              className={iconButton}
            >
              –
            </button>
            <button
              type='button'
              aria-label='Hide on this site'
              title='Hide on this site (show it again from the toolbar popup)'
              onClick={() =>
                change(current => ({
                  hiddenHosts: [...new Set([...current.hiddenHosts, host])],
                }))
              }
              className={iconButton}
            >
              ×
            </button>
          </div>
          {view.kind === 'formatChanged' ? (
            <p role='alert' className='text-red-700'>
              Goodreads changed its page format — the extension needs an update.
            </p>
          ) : (
            <>
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
      )}
    </div>
  )
}
