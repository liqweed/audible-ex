import * as Slider from '@radix-ui/react-slider'
import * as Switch from '@radix-ui/react-switch'
import { useStore } from '@tanstack/react-store'
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { PanelHandle } from '@/content/shared'
import { type Dimension, labelKey, type MissMode } from '@/core/filter'
import { type Region, regionFromHost } from '@/core/regions'
import type { Filters as FilterPrefs } from '@/storage/prefs'
import { Choice, InfoTip } from './controls'
import { genresSeen, suggestions } from './genres'
import { type FilterChange, useDebouncedValue, useFilterPrefs } from './prefs'

const field =
  'rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900'
const quiet = 'text-xs text-slate-600'
const row = 'flex items-center gap-1.5 whitespace-nowrap'

const MISS_MODES = [
  { value: 'hide', text: 'Hide' },
  { value: 'dim', text: 'Dim' },
] as const

const without = (labels: readonly string[], label: string) =>
  labels.filter(l => labelKey(l) !== labelKey(label))

/** Hide or dim, for the books that fail one filter. */
function ModeChoice({
  dimension,
  label,
  filters,
  change,
}: {
  dimension: Dimension
  /** What the books fail, after "Books that fail", such as "the minimum rating". */
  label: string
  filters: FilterPrefs
  change(patch: FilterChange): void
}) {
  return (
    <Choice<MissMode>
      name={`agx-mode-${dimension}`}
      label={`Books that fail ${label}`}
      value={filters.modes[dimension]}
      options={MISS_MODES}
      onChange={mode =>
        change(current => ({
          modes: { ...current.modes, [dimension]: mode },
        }))
      }
    />
  )
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
  change(patch: FilterChange): void
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
    <fieldset
      aria-labelledby='agx-year-label'
      className='mx-0 min-w-0 border-0 p-0'
    >
      <div className={row}>
        <span id='agx-year-label' className={quiet}>
          Published
        </span>
        <InfoTip label='About the first-published year'>
          Inclusive years. Blank is any year; negative years are BCE. Books with
          no known year stay visible unless another filter applies.
        </InfoTip>
        <span className='ml-auto flex items-center gap-0.5'>
          {(['minYear', 'maxYear'] as const).map((bound, i) => (
            <span key={bound} className='flex items-center gap-0.5'>
              {i > 0 && (
                <span aria-hidden='true' className='text-slate-400'>
                  –
                </span>
              )}
              <input
                id={`agx-${bound}`}
                type='text'
                aria-label={bound === 'minYear' ? 'From year' : 'To year'}
                value={draft[bound]}
                placeholder={bound === 'minYear' ? 'From' : 'To'}
                aria-invalid={!!error}
                aria-describedby={error ? 'agx-year-error' : undefined}
                onChange={e => setDraft({ ...draft, [bound]: e.target.value })}
                className={`${field} w-11 px-1 text-right`}
              />
            </span>
          ))}
        </span>
        <ModeChoice
          dimension='year'
          label='the year range'
          filters={filters}
          change={change}
        />
      </div>
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

/** A cash ceiling for this marketplace; other marketplaces' limits are preserved atomically. */
function PriceLimit({
  filters,
  change,
  region,
}: {
  filters: FilterPrefs
  change(patch: FilterChange): void
  region: Region
}) {
  const outside = filters.maxPrice[region.code]?.toString() ?? ''
  const [draft, setDraft] = useDebouncedValue(outside, text => {
    const amount = text.trim() === '' ? undefined : Number(text)
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) return
    change(current => {
      const maxPrice = { ...current.maxPrice }
      if (amount === undefined) delete maxPrice[region.code]
      else maxPrice[region.code] = amount
      return { maxPrice }
    })
  })
  const invalid =
    draft.trim() !== '' &&
    (!Number.isFinite(Number(draft)) || Number(draft) < 0)
  return (
    <div>
      <div className={row}>
        <label htmlFor='agx-max-price' className={quiet}>
          Max price ({region.currency})
        </label>
        <InfoTip label='About the maximum price'>
          Public catalogue prices on this marketplace; member offers may differ.
          Blank is any price; 0 is free only. Books with no price stay visible
          unless another filter applies.
        </InfoTip>
        <input
          id='agx-max-price'
          type='text'
          inputMode='decimal'
          value={draft}
          placeholder='Any'
          aria-invalid={invalid}
          onChange={e => setDraft(e.target.value)}
          className={`${field} ml-auto w-14 text-right`}
        />
        <ModeChoice
          dimension='price'
          label='the price limit'
          filters={filters}
          change={change}
        />
      </div>
      {invalid && (
        <p role='alert' className='mt-1 text-xs text-red-700'>
          Use a price of 0 or more.
        </p>
      )}
    </div>
  )
}

/** Parses the highlight rating: blank is off (`null`), else a rating from 1 to 5; `undefined` is invalid. */
function ratingBound(text: string): number | null | undefined {
  if (text.trim() === '') return null
  const n = Number(text)
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : undefined
}

/** The rating from which books are highlighted. Not a filter, so no hide-or-dim choice. */
function HighlightRating({
  filters,
  change,
}: {
  filters: FilterPrefs
  change(patch: FilterChange): void
}) {
  const outside = filters.highlightRating?.toString() ?? ''
  const [draft, setDraft] = useDebouncedValue(outside, text => {
    const value = ratingBound(text)
    if (value !== undefined) change({ highlightRating: value })
  })
  const invalid = ratingBound(draft) === undefined
  return (
    <div>
      <div className={row}>
        <label htmlFor='agx-highlight-rating' className={quiet}>
          Highlight rating
        </label>
        <InfoTip label='About the highlight rating'>
          Books rated at least this get an outline, like the highlighted labels.
          Blank is off. Highlighting never hides a book, and it works with the
          filters off.
        </InfoTip>
        <input
          id='agx-highlight-rating'
          type='text'
          inputMode='decimal'
          value={draft}
          placeholder='Off'
          aria-invalid={invalid}
          onChange={e => setDraft(e.target.value)}
          className={`${field} ml-auto w-14 text-right`}
        />
      </div>
      {invalid && (
        <p role='alert' className='mt-1 text-xs text-red-700'>
          Use a rating from 1 to 5.
        </p>
      )}
    </div>
  )
}

/** A list of labels: chips, and an input that suggests the genres the page's books carry. */
function LabelPicker({
  id,
  title,
  help,
  aside,
  labels,
  other,
  seen,
  tone,
  removeText,
  onAdd,
  onRemove,
}: {
  id: string
  title: string
  help: ReactNode
  /** What goes at the end of the title row. */
  aside?: ReactNode
  labels: readonly string[]
  /** The labels of the other list, which are not suggested here either. */
  other: readonly string[]
  seen: readonly string[]
  tone: 'hide' | 'highlight'
  removeText(label: string): string
  onAdd(label: string): void
  onRemove(label: string): void
}) {
  const [typed, setTyped] = useState('')
  const [focused, setFocused] = useState(false)
  const options = suggestions(seen, [...labels, ...other], typed)

  function add(label: string) {
    const clean = label.trim()
    setTyped('')
    if (!clean || labels.some(l => labelKey(l) === labelKey(clean))) return
    onAdd(clean)
  }

  return (
    <div>
      <div className={row}>
        <label htmlFor={id} className={quiet}>
          {title}
        </label>
        <InfoTip label={`About ${title.toLowerCase()}`}>{help}</InfoTip>
        {aside && <span className='ml-auto flex items-center'>{aside}</span>}
      </div>
      {labels.length > 0 && (
        <ul className='my-1 flex flex-wrap gap-1'>
          {labels.map(label => (
            <li
              key={label}
              className={`flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-xs ${tone === 'highlight' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'}`}
            >
              {label}
              <button
                type='button'
                aria-label={removeText(label)}
                onClick={() => onRemove(label)}
                className='rounded-full px-1 text-slate-500 hover:bg-slate-200'
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
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
 * one row per filter, each with its own hide-or-dim choice, then the hidden and highlighted labels
 * and the policy for books not on Goodreads. They are the `filters` pref, shared by every Audible
 * tab. The settings stay reachable with the filters off, because highlighting does not depend on
 * them.
 */
export function Filters({
  handle,
  panelRef,
  region = regionFromHost(location.hostname),
  openOptions,
}: {
  handle: PanelHandle
  /** The entire panel is inside the click boundary, including its header and progress. */
  panelRef?: RefObject<HTMLElement | null>
  region?: Region | undefined
  /** Opens the options page; without it the settings do not link there. */
  openOptions?: (() => void) | undefined
}) {
  const { filters, change } = useFilterPrefs()
  const hidden = useStore(handle.filter, s => s.hidden)
  const highlighted = useStore(handle.filter, s => s.highlighted)
  const peek = useStore(handle.filter, s => s.peek)
  const seen = useStore(handle.state, s => genresSeen(s.books))
  const [open, setOpen] = useState(false)
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    const boundary = panelRef?.current ?? section.current
    if (!boundary) return
    const outsideClick = (event: MouseEvent) => {
      // Clicks are retargeted to the host outside a shadow root; the composed path
      // still tells an interaction inside the panel from one on the Audible page.
      if (!event.composedPath().includes(boundary)) setOpen(false)
    }
    const doc = boundary.ownerDocument
    doc.addEventListener('click', outsideClick, true)
    return () => doc.removeEventListener('click', outsideClick, true)
  }, [open, panelRef])
  const [rating, setRating] = useDebouncedValue(filters?.minRating ?? 4, v =>
    change({ minRating: v })
  )
  const [count, setCount] = useDebouncedValue(filters?.minRatings ?? 50, v =>
    change({ minRatings: v })
  )
  if (!filters) return null

  return (
    <section
      ref={section}
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

      <button
        type='button'
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`${quiet} mt-1 underline`}
      >
        {open ? 'Hide filter settings' : 'Filter settings'}
      </button>
      {open && (
        <div className='mt-2 space-y-2.5'>
          <p className='flex items-center justify-end gap-1 text-[11px] text-slate-500'>
            Books that fail
            <InfoTip label='About hide and dim'>
              Each filter hides the books that fail it, or only dims them. A
              book failing several filters is hidden if any of them hides. In
              carousels books are always dimmed, and no book is hidden before
              its rating has loaded.
            </InfoTip>
          </p>

          <div>
            <div className={row}>
              <span id='agx-min-rating-label' className={quiet}>
                Minimum rating
              </span>
              <InfoTip label='About the minimum rating'>
                The Goodreads average a book needs. It applies as soon as the
                rating arrives.
              </InfoTip>
              <span className='ml-auto text-xs font-medium'>
                {rating.toFixed(1)}
              </span>
              <ModeChoice
                dimension='rating'
                label='the minimum rating'
                filters={filters}
                change={change}
              />
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
                aria-labelledby='agx-min-rating-label'
                className='block h-4 w-4 rounded-full border border-indigo-600 bg-white shadow focus:outline-2 focus:outline-indigo-400'
              />
            </Slider.Root>
          </div>

          <div className={row}>
            <label htmlFor='agx-min-ratings' className={quiet}>
              Minimum ratings
            </label>
            <InfoTip label='About the minimum number of ratings'>
              How many Goodreads ratings a book needs, so a few enthusiastic
              readers do not decide. 0 turns this off.
            </InfoTip>
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
              className={`${field} ml-auto w-14 text-right`}
            />
            <ModeChoice
              dimension='count'
              label='the minimum ratings'
              filters={filters}
              change={change}
            />
          </div>

          <YearRange filters={filters} change={change} />
          {region && (
            <PriceLimit
              key={region.code}
              filters={filters}
              change={change}
              region={region}
            />
          )}

          <LabelPicker
            id='agx-labels'
            title='Hide labels'
            help='Books carrying any of these Goodreads genres fail. Genres arrive after the rating, so this filter acts a moment later.'
            aside={
              <ModeChoice
                dimension='labels'
                label='the hidden labels'
                filters={filters}
                change={change}
              />
            }
            labels={filters.hiddenLabels}
            other={filters.highlightLabels}
            seen={seen}
            tone='hide'
            removeText={label => `Stop hiding ${label}`}
            onAdd={label =>
              change(current => ({
                hiddenLabels: [...current.hiddenLabels, label],
                highlightLabels: without(current.highlightLabels, label),
              }))
            }
            onRemove={label =>
              change(current => ({
                hiddenLabels: without(current.hiddenLabels, label),
              }))
            }
          />

          <LabelPicker
            id='agx-highlight-labels'
            title='Highlight labels'
            help='Your areas of interest: books carrying any of these genres get an outline. Highlighting never hides a book, and it works with the filters off.'
            aside={
              highlighted > 0 && (
                <span className='text-[11px] text-slate-500'>
                  {highlighted} on this page
                </span>
              )
            }
            labels={filters.highlightLabels}
            other={filters.hiddenLabels}
            seen={seen}
            tone='highlight'
            removeText={label => `Stop highlighting ${label}`}
            onAdd={label =>
              change(current => ({
                highlightLabels: [...current.highlightLabels, label],
                hiddenLabels: without(current.hiddenLabels, label),
              }))
            }
            onRemove={label =>
              change(current => ({
                highlightLabels: without(current.highlightLabels, label),
              }))
            }
          />

          <HighlightRating filters={filters} change={change} />

          <div className={row}>
            <span className={quiet}>Not on Goodreads</span>
            <InfoTip label='About books not on Goodreads'>
              Books Goodreads has no match for. They have no rating, so the
              other filters cannot judge them.
            </InfoTip>
            <span className='ml-auto'>
              <Choice<FilterPrefs['notFound']>
                name='agx-not-found'
                label='Books not on Goodreads'
                value={filters.notFound}
                options={[
                  { value: 'show', text: 'Show' },
                  { value: 'dim', text: 'Dim' },
                  { value: 'hide', text: 'Hide' },
                ]}
                onChange={notFound => change({ notFound })}
              />
            </span>
          </div>

          {openOptions && (
            <p className='text-right'>
              <button
                type='button'
                onClick={openOptions}
                className={`${quiet} underline`}
              >
                More settings
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  )
}
