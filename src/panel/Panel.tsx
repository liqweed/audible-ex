import { useStore } from '@tanstack/react-store'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PanelHandle } from '@/content/shared'
import { SOURCE_URL } from '@/lib/links'
import {
  type Corner,
  DEFAULT_PANEL,
  type PanelState,
  type PanelStorage,
  panelStorage,
} from '@/storage/panel'
import { useDrag } from './drag'
import { Filters } from './Filters'
import {
  counts,
  detailsProgress,
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

const CORNERS: readonly Corner[] = [
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
]

/** Six dots: the mark of something that can be dragged. */
function Grip() {
  return (
    <svg
      aria-hidden='true'
      viewBox='0 0 8 14'
      className='h-3.5 w-2 shrink-0 fill-current'
    >
      <circle cx='2' cy='2' r='1.2' />
      <circle cx='6' cy='2' r='1.2' />
      <circle cx='2' cy='7' r='1.2' />
      <circle cx='6' cy='7' r='1.2' />
      <circle cx='2' cy='12' r='1.2' />
      <circle cx='6' cy='12' r='1.2' />
    </svg>
  )
}

/** The extension's mark, so a visitor can tell whose panel this is. */
const Avatar = ({ src }: { src: string }) => (
  <img
    src={src}
    alt=''
    className='h-5 w-5 shrink-0 rounded-full bg-white ring-1 ring-slate-300'
  />
)

/** The four places the panel can dock, shown while it is dragged; the nearest one is lit. */
function DropTargets({ target }: { target: Corner }) {
  return (
    <div aria-hidden='true' className='pointer-events-none'>
      {CORNERS.map(corner => (
        <div
          key={corner}
          className={`fixed z-[2147483646] h-12 w-12 rounded-lg border-2 border-dashed ${CORNER_CLASS[corner]} ${corner === target ? 'border-indigo-600 bg-indigo-600/20' : 'border-slate-400 bg-slate-400/10'}`}
        />
      ))}
    </div>
  )
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
  logoSrc,
}: {
  handle: PanelHandle
  clock?: () => number
  storage?: PanelStorage
  host?: string
  /** The logo as an image URL; without it the panel has no avatar and no link to the project. */
  logoSrc?: string
}) {
  const progress = useStore(handle.state, s => s.progress)
  const formatChanged = useStore(handle.state, s => hasFormatChange(s.books))
  const detailsDone = useStore(handle.state, s => detailsProgress(s.books).done)
  const detailsTotal = useStore(
    handle.state,
    s => detailsProgress(s.books).total
  )
  const details = { done: detailsDone, total: detailsTotal }
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

  const pill = pillText(view, details)
  const dragging = drag.at !== undefined

  return (
    <>
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
            aria-label={`Goodreads ratings ${pill}, expand`}
            title='Click to expand, drag to move'
            onClick={() => {
              if (!drag.wasDrag()) change(() => ({ collapsed: false }))
            }}
            {...drag.handlers}
            className={`flex touch-none items-center gap-1.5 rounded-full border border-slate-300 bg-white py-1 pr-3 pl-1 text-xs font-semibold shadow-lg select-none hover:bg-slate-100 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          >
            {logoSrc ? <Avatar src={logoSrc} /> : <span className='w-2' />}
            {pill}
          </button>
        ) : (
          <section
            aria-label='Goodreads ratings'
            className='max-h-[calc(100vh-2rem)] w-72 overflow-y-auto rounded-lg border border-slate-300 bg-white p-3 shadow-lg'
          >
            <div className='mb-2 flex items-center gap-1.5'>
              {logoSrc && (
                <a
                  href={SOURCE_URL}
                  target='_blank'
                  rel='noreferrer'
                  title='Book Ratings for Audible — open the project page'
                  aria-label='Book Ratings for Audible — open the project page'
                  className='shrink-0 rounded-full'
                >
                  <Avatar src={logoSrc} />
                </a>
              )}
              <span
                {...drag.handlers}
                title='Drag to move to another corner'
                className={`group -my-1 flex flex-1 touch-none items-center gap-1 rounded py-1 pl-1 select-none hover:bg-slate-100 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              >
                <span className='font-semibold'>Goodreads ratings</span>
                <span className='ml-auto pr-1 text-slate-400 group-hover:text-slate-700'>
                  <Grip />
                </span>
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
                title='Collapse to a pill'
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
                Goodreads changed its page format — the extension needs an
                update.
              </p>
            ) : (
              <>
                <p className='mb-0.5 text-xs font-medium text-slate-700'>
                  Ratings
                </p>
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
                {details.total > 0 && (
                  <div
                    className='mt-2'
                    title="Genres, first-published year and the overview come from each book's Goodreads page, which is read after the ratings."
                  >
                    <p className='mb-0.5 flex justify-between text-xs font-medium text-slate-700'>
                      <span>Genres, year &amp; overview</span>
                      <span className='font-normal text-slate-600'>
                        {details.done}/{details.total}
                      </span>
                    </p>
                    <div
                      role='progressbar'
                      aria-label='Genres and details read'
                      aria-valuemin={0}
                      aria-valuemax={details.total}
                      aria-valuenow={details.done}
                      className='h-1.5 overflow-hidden rounded bg-slate-200'
                    >
                      <div
                        className={`h-full ${details.done === details.total ? 'bg-emerald-600' : 'bg-sky-500'}`}
                        style={{
                          width: `${(details.done / details.total) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                <Filters handle={handle} panelRef={box} />
              </>
            )}
          </section>
        )}
      </div>
      {drag.at && <DropTargets target={drag.at.target} />}
    </>
  )
}
