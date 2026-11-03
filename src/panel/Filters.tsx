import * as Slider from '@radix-ui/react-slider'
import * as Switch from '@radix-ui/react-switch'
import { Debouncer } from '@tanstack/pacer/debouncer'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PanelHandle } from '@/content/shared'
import {
  DEFAULT_FILTERS,
  type Filters as FilterPrefs,
  readPrefs,
  updateFilters,
  watchPrefs,
} from '@/storage/prefs'
import { genresSeen, suggestions } from './genres'

const SAVE_WAIT_MS = 300
const field =
  'rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900'
const quiet = 'text-xs text-slate-600'

/** The filters pref, kept in step with storage; `change` shows the change now and saves it. */
function useFilterPrefs() {
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
    () => (patch: Partial<FilterPrefs>) => {
      setFilters(known => known && { ...known, ...patch })
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
function useDebouncedValue<T>(outside: T, save: (value: T) => void) {
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

const tenth = (n: number) => Math.round(n * 10) / 10

type YearDraft = { minYear: string; maxYear: string }

function yearBound(text: string): number | null | undefined {
  if (text.trim() === '') return null
  const n = Number(text)
  return /^-?\d+$/.test(text.trim()) && Number.isSafeInteger(n) && n !== 0
    ? n
    : undefined
}

function yearRange(draft: YearDraft) {
  const minYear = yearBound(draft.minYear)
  const maxYear = yearBound(draft.maxYear)
  if (minYear === undefined || maxYear === undefined) {
    return { error: 'Use whole years other than 0.' } as const
  }
  if (minYear !== null && maxYear !== null && minYear > maxYear) {
    return { error: 'From year must be no later than to year.' } as const
  }
  return { value: { minYear, maxYear } } as const
}

/** Save the two bounds together, only when the entire range is valid. */
function YearRange({
  filters,
  change,
}: {
  filters: FilterPrefs
  change(patch: Partial<FilterPrefs>): void
}) {
  const outside = useMemo(
    () => ({
      minYear: filters.minYear?.toString() ?? '',
      maxYear: filters.maxYear?.toString() ?? '',
    }),
    [filters.minYear, filters.maxYear]
  )
  const [draft, setDraft] = useDebouncedValue(outside, next => {
    const range = yearRange(next)
    if (range.value) change(range.value)
  })
  const { error } = yearRange(draft)
  return (
    <fieldset className='m-0 min-w-0 border-0 p-0'>
      <legend className={quiet}>First-published year</legend>
      <div className='mt-1 flex gap-2'>
        {(['minYear', 'maxYear'] as const).map(bound => (
          <div key={bound} className='min-w-0 flex-1'>
            <label htmlFor={`agx-${bound}`} className={quiet}>
              {bound === 'minYear' ? 'From year' : 'To year'}
            </label>
            <input
              id={`agx-${bound}`}
              type='text'
              value={draft[bound]}
              placeholder='Any'
              aria-invalid={!!error}
              aria-describedby={`agx-year-help${error ? ' agx-year-error' : ''}`}
              onChange={e => setDraft({ ...draft, [bound]: e.target.value })}
              className={`${field} mt-0.5 w-full`}
            />
          </div>
        ))}
      </div>
      <p id='agx-year-help' className='mt-1 text-[11px] text-slate-500'>
        Blank is any year; negative years are BCE. Books with no year stay
        visible unless another filter applies.
      </p>
      {error && (
        <p
          id='agx-year-error'
          role='alert'
          className='mt-1 text-xs text-red-700'
        >
          {error}
        </p>
      )}
    </fieldset>
  )
}

/** Hidden labels: chips, and an input that suggests the genres the page's books carry. */
function LabelPicker({
  hidden,
  seen,
  onChange,
}: {
  hidden: readonly string[]
  seen: readonly string[]
  onChange(labels: string[]): void
}) {
  const [typed, setTyped] = useState('')
  const [focused, setFocused] = useState(false)
  const options = suggestions(seen, hidden, typed)

  function add(label: string) {
    const clean = label.trim()
    setTyped('')
    if (!clean || hidden.some(h => h.toLowerCase() === clean.toLowerCase()))
      return
    onChange([...hidden, clean])
  }

  return (
    <div>
      <label htmlFor='agx-labels' className={`${quiet} block`}>
        Hide books labelled
      </label>
      {hidden.length > 0 && (
        <ul className='my-1 flex flex-wrap gap-1'>
          {hidden.map(label => (
            <li
              key={label}
              className='flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-1 pl-2 text-xs'
            >
              {label}
              <button
                type='button'
                aria-label={`Stop hiding ${label}`}
                onClick={() => onChange(hidden.filter(h => h !== label))}
                className='rounded-full px-1 text-slate-500 hover:bg-slate-200'
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id='agx-labels'
        type='text'
        value={typed}
        placeholder='Type a genre, e.g. Romance'
        autoComplete='off'
        onChange={e => setTyped(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            // A seen genre that fits wins, so "rom" adds "Romance"; with nothing typed, nothing is added.
            if (typed.trim() !== '') add(options[0] ?? typed)
          }
        }}
        className={`${field} mt-0.5 w-full`}
      />
      {(focused || typed) && options.length > 0 && (
        <fieldset
          aria-label='Suggestions'
          className='m-0 mt-1 flex min-w-0 flex-wrap gap-1 border-0 p-0'
        >
          {options.map(option => (
            <button
              key={option}
              type='button'
              // Before the input loses focus: otherwise the suggestions vanish under the click.
              onMouseDown={e => e.preventDefault()}
              onClick={() => add(option)}
              className='rounded-full border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100'
            >
              {option}
            </button>
          ))}
        </fieldset>
      )}
    </div>
  )
}

/**
 * The filters (PRD R3): the master switch, `12 hidden · Show`, and below them a settings area with
 * the rating slider, the minimum number of ratings, hidden labels and what to do with the rest.
 * They are the `filters` pref, shared by every Audible tab.
 */
export function Filters({ handle }: { handle: PanelHandle }) {
  const { filters, change } = useFilterPrefs()
  const hidden = useStore(handle.filter, s => s.hidden)
  const peek = useStore(handle.filter, s => s.peek)
  const seen = useStore(handle.state, s => genresSeen(s.books))
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useDebouncedValue(filters?.minRating ?? 4, v =>
    change({ minRating: v })
  )
  const [count, setCount] = useDebouncedValue(filters?.minRatings ?? 50, v =>
    change({ minRatings: v })
  )
  if (!filters) return null

  return (
    <section
      aria-label='Filters'
      className='mt-3 border-t border-slate-200 pt-2'
    >
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2 text-xs font-medium text-slate-700'>
          <Switch.Root
            id='agx-filter-switch'
            checked={filters.enabled}
            onCheckedChange={enabled => change({ enabled })}
            className='relative h-4 w-7 shrink-0 rounded-full border border-slate-300 bg-slate-200 data-[state=checked]:bg-indigo-600'
          >
            <Switch.Thumb className='block h-3 w-3 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-3.5' />
          </Switch.Root>
          <label htmlFor='agx-filter-switch'>Filter books</label>
        </div>
        {filters.enabled && hidden > 0 && (
          <span className={quiet}>
            {hidden} hidden ·{' '}
            <button
              type='button'
              onClick={() => handle.setPeek(!peek)}
              className='underline'
            >
              {peek ? 'Hide again' : 'Show'}
            </button>
          </span>
        )}
      </div>

      {filters.enabled && (
        <>
          <button
            type='button'
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className={`${quiet} mt-1 underline`}
          >
            {open ? 'Hide filter settings' : 'Filter settings'}
          </button>
          {open && (
            <div className='mt-2 space-y-3'>
              <div>
                <div className='flex justify-between text-xs'>
                  <span className={quiet}>Minimum rating</span>
                  <span className='font-medium'>{rating.toFixed(1)}</span>
                </div>
                <Slider.Root
                  min={3}
                  max={5}
                  step={0.1}
                  value={[rating]}
                  onValueChange={([v]) => setRating(tenth(v ?? rating))}
                  className='relative mt-1 flex h-4 w-full touch-none items-center select-none'
                >
                  <Slider.Track className='relative h-1.5 grow rounded-full bg-slate-200'>
                    <Slider.Range className='absolute h-full rounded-full bg-indigo-600' />
                  </Slider.Track>
                  <Slider.Thumb
                    aria-label='Minimum rating'
                    className='block h-4 w-4 rounded-full border border-indigo-600 bg-white shadow focus:outline-2 focus:outline-indigo-400'
                  />
                </Slider.Root>
              </div>

              <div className='flex items-center justify-between gap-2'>
                <label htmlFor='agx-min-ratings' className={quiet}>
                  Minimum number of ratings (0 is off)
                </label>
                <input
                  id='agx-min-ratings'
                  type='number'
                  min={0}
                  step={10}
                  value={count}
                  onChange={e => {
                    const n = Math.floor(Number(e.target.value))
                    if (Number.isFinite(n) && n >= 0) setCount(n)
                  }}
                  className={`${field} w-16 text-right`}
                />
              </div>

              <LabelPicker
                hidden={filters.hiddenLabels}
                seen={seen}
                onChange={hiddenLabels => change({ hiddenLabels })}
              />

              <YearRange filters={filters} change={change} />

              <div className='flex items-center justify-between gap-2'>
                <label htmlFor='agx-not-found' className={quiet}>
                  Books not on Goodreads
                </label>
                <select
                  id='agx-not-found'
                  value={filters.notFound}
                  onChange={e =>
                    change({
                      notFound: e.target.value as FilterPrefs['notFound'],
                    })
                  }
                  className={field}
                >
                  <option value='show'>Show</option>
                  <option value='dim'>Dim</option>
                  <option value='hide'>Hide</option>
                </select>
              </div>

              <div>
                <div className='flex items-center justify-between gap-2'>
                  <label htmlFor='agx-mode' className={quiet}>
                    Books that fail a filter
                  </label>
                  <select
                    id='agx-mode'
                    value={filters.mode}
                    onChange={e =>
                      change({ mode: e.target.value as FilterPrefs['mode'] })
                    }
                    className={field}
                  >
                    <option value='hide'>Hide</option>
                    <option value='dim'>Dim</option>
                  </select>
                </div>
                <p className='mt-0.5 text-[11px] text-slate-500'>
                  In carousels they are always dimmed. A book is never hidden
                  before its rating has loaded.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
