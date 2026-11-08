import { useForm } from '@tanstack/react-form'
import {
  ArchiveRestore,
  Check,
  Database,
  Download,
  Funnel,
  Github,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Tag,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { type Dimension, labelKey } from '@/core/filter'
import { REGIONS, type RegionCode } from '@/core/regions'
import { currencySymbol } from '@/lib/format'
import { Logo } from '@/lib/Logo'
import { PRIVACY_URL, SOURCE_URL, STORE_URL } from '@/lib/links'
import { CacheInspector } from '@/options/CacheInspector'
import { CacheSummary } from '@/options/CacheSummary'
import { type CacheBackend, cacheBackend } from '@/options/cache-backend'
import {
  LabelChips,
  LabelPicker,
  NumberField,
  Segmented,
  SliderField,
} from '@/options/controls'
import { Preview } from '@/options/Preview'
import {
  describeYears,
  draftFromPrefs,
  exportPrefs,
  importPrefs,
  prefsFromDraft,
  saveSettings,
} from '@/options/settings'
import { GENRES_MAX } from '@/schema/common'
import {
  DEFAULT_PREFS,
  type Prefs,
  readPrefs,
  updatePrefs,
  watchPrefs,
} from '@/storage/prefs'

const base =
  'inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50'
const button = `${base} border-slate-300 bg-white hover:bg-slate-100`
const primary = `${base} border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700`
const link =
  'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100'
const icon = 'h-4 w-4 shrink-0'
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export function downloadPrefs(text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/json' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = 'book-ratings-prefs.json'
  link.click()
  // Keep the URL alive until the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type NumberKey =
  | 'labels'
  | 'minRating'
  | 'minRatings'
  | 'highlightRating'
  | `prices.${RegionCode}`
  | `highlightPrices.${RegionCode}`
type BooleanKey = 'enabled' | 'filtering' | 'priceOnDeals' | 'year' | 'overview'
type PolicyKey = 'notFound' | `modes.${Dimension}`

const HIDE_OR_DIM = [
  { value: 'hide', text: 'Hide' },
  { value: 'dim', text: 'Dim' },
] as const
const SHOW_DIM_OR_HIDE = [
  { value: 'show', text: 'Show' },
  { value: 'dim', text: 'Dim' },
  { value: 'hide', text: 'Hide' },
] as const

/** Each filter with its own hide-or-dim choice, as the options page names it. */
const MODE_FIELDS: ReadonlyArray<readonly [Dimension, string]> = [
  ['rating', 'Below the minimum rating'],
  ['count', 'Too few ratings'],
  ['labels', 'Carrying a hidden label'],
  ['price', 'Above the maximum price'],
  ['year', 'Outside the year range'],
]

const without = (labels: readonly string[], label: string) =>
  labels.filter(l => labelKey(l) !== labelKey(label))

function Settings({
  initial,
  download,
  backend,
  children,
}: {
  initial: Prefs
  download(text: string): void
  backend: CacheBackend
  /** The cache section, which sits between the settings and the backup. */
  children?: ReactNode
}) {
  const baseline = useRef(initial)
  const latest = useRef(initial)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [external, setExternal] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [seen, setSeen] = useState<readonly string[]>([])
  const [pending, setPending] = useState<{
    kind: 'import' | 'reset'
    prefs: Prefs
  }>()
  const form = useForm({
    defaultValues: draftFromPrefs(initial),
    validators: {
      onSubmit: ({ value }) => {
        try {
          prefsFromDraft(value)
        } catch (e) {
          return errorText(e)
        }
        return undefined
      },
    },
    onSubmit: async ({ value }) => {
      await write(
        async () => saveSettings(baseline.current, value),
        'Settings saved.'
      )
    },
  })

  const showSaved = useCallback(
    (prefs: Prefs) => {
      latest.current = prefs
      baseline.current = prefs
      form.reset(draftFromPrefs(prefs))
      setExternal(false)
    },
    [form]
  )

  useEffect(
    () =>
      watchPrefs(prefs => {
        latest.current = prefs
        if (busyRef.current) return
        if (form.state.isDefaultValue) showSaved(prefs)
        else setExternal(true)
      }),
    [form, showSaved]
  )

  // The genres of the cached books suggest labels; without them the field still takes any text.
  useEffect(() => {
    let current = true
    backend.genres().then(
      genres => current && setSeen(genres),
      () => {}
    )
    return () => {
      current = false
    }
  }, [backend])

  // A confirmation fades from the bar after a few seconds; an error stays until the next action.
  useEffect(() => {
    if (!message) return undefined
    const timer = setTimeout(() => setMessage(''), 5000)
    return () => clearTimeout(timer)
  }, [message])

  async function write(action: () => Promise<void>, success: string) {
    busyRef.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      showSaved(await readPrefs())
      setPending(undefined)
      setMessage(success)
    } catch (e) {
      setError(`Could not save settings: ${errorText(e)}`)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function number(
    name: NumberKey,
    label: string,
    options: {
      help?: string
      step?: number
      min?: number
      max?: number
      start?: number
      width?: string
      placeholder?: string
      decimal?: boolean
    } = {}
  ) {
    const { help, width, ...rest } = options
    return (
      <form.Field key={name} name={name}>
        {f => (
          <div>
            <label htmlFor={name} className='text-sm font-medium'>
              {label}
            </label>
            <div className='mt-1'>
              <NumberField
                id={name}
                label={label}
                value={f.state.value}
                onChange={f.handleChange}
                onBlur={f.handleBlur}
                describedBy={help ? `${name}-help` : undefined}
                className={width}
                {...rest}
              />
            </div>
            {help && (
              <p id={`${name}-help`} className='options-hint mt-1'>
                {help}
              </p>
            )}
          </div>
        )}
      </form.Field>
    )
  }
  function toggle(name: BooleanKey, label: string) {
    return (
      <form.Field key={name} name={name}>
        {f => (
          <label className='flex items-center gap-3 text-sm'>
            <input
              type='checkbox'
              checked={f.state.value}
              onBlur={f.handleBlur}
              onChange={e => f.handleChange(e.target.checked)}
              className='h-4 w-4 accent-indigo-600'
            />
            {label}
          </label>
        )}
      </form.Field>
    )
  }
  function modeRow(
    name: PolicyKey,
    label: string,
    options: typeof HIDE_OR_DIM | typeof SHOW_DIM_OR_HIDE
  ) {
    return (
      <form.Field key={name} name={name}>
        {f => (
          <li className='flex items-center justify-between gap-4 px-3 py-1.5'>
            <span aria-hidden='true' className='text-sm'>
              {label}
            </span>
            <Segmented<string>
              name={name}
              label={label}
              value={f.state.value}
              options={options}
              onChange={mode => f.handleChange(mode as typeof f.state.value)}
            />
          </li>
        )}
      </form.Field>
    )
  }
  function priceCell(
    name: `prices.${RegionCode}` | `highlightPrices.${RegionCode}`,
    label: string,
    currency: string
  ) {
    return (
      <form.Field name={name}>
        {f => (
          <NumberField
            id={name}
            label={label}
            value={f.state.value}
            onChange={f.handleChange}
            onBlur={f.handleBlur}
            placeholder='Off'
            prefix={currencySymbol(currency)}
            className='w-20'
          />
        )}
      </form.Field>
    )
  }

  return (
    <>
      <div className='space-y-8'>
        <div className='space-y-8'>
          <form
            id='settings-form'
            onSubmit={e => {
              e.preventDefault()
              void form.handleSubmit()
            }}
            noValidate
          >
            {/* Enter in a field saves; the visible Save button is in the bar below. */}
            <button type='submit' tabIndex={-1} aria-hidden='true' hidden />
            <fieldset
              disabled={busy || pending !== undefined}
              className='m-0 space-y-8 border-0 p-0'
            >
              <section
                aria-labelledby='display-heading'
                className='options-section'
              >
                <h2 id='display-heading'>
                  <SlidersHorizontal aria-hidden='true' />
                  Display
                </h2>
                {toggle('enabled', 'Show ratings on Audible')}
                <p className='options-hint'>
                  These choices update badges in every open Audible tab.
                </p>
                <form.Field name='labels'>
                  {f => (
                    <div>
                      <label htmlFor='labels' className='text-sm font-medium'>
                        Labels per book
                      </label>
                      <div className='mt-1 flex flex-wrap items-center gap-4'>
                        <SliderField
                          label='Labels per book'
                          value={f.state.value}
                          onChange={f.handleChange}
                          min={0}
                          max={GENRES_MAX}
                        />
                        <NumberField
                          id='labels'
                          label='Labels per book'
                          value={f.state.value}
                          onChange={f.handleChange}
                          onBlur={f.handleBlur}
                          step={1}
                          min={0}
                          max={GENRES_MAX}
                          decimal={false}
                          describedBy='labels-help'
                          className='w-10'
                        />
                      </div>
                      <p id='labels-help' className='options-hint mt-1'>
                        A whole number from 0 to {GENRES_MAX}; 0 hides labels.
                      </p>
                    </div>
                  )}
                </form.Field>
                {toggle('year', 'Show first-published year')}
                {toggle('overview', 'Show overview on hover')}
                <form.Subscribe selector={s => s.values}>
                  {values => <Preview draft={values} />}
                </form.Subscribe>
              </section>
              <section
                aria-labelledby='filters-heading'
                className='options-section'
              >
                <h2 id='filters-heading'>
                  <Funnel aria-hidden='true' />
                  Filters
                </h2>
                {toggle('filtering', 'Filter books')}
                <div className='grid gap-4 sm:grid-cols-3'>
                  {number('minRating', 'Minimum rating', {
                    help: '1.0–5.0',
                    step: 0.1,
                    min: 1,
                    max: 5,
                    start: 4,
                  })}
                  {number('minRatings', 'Minimum ratings', {
                    help: '0 is off',
                    step: 10,
                    min: 0,
                    start: 50,
                    decimal: false,
                    width: 'w-12',
                  })}
                  {number('highlightRating', 'Highlight rating', {
                    help: '1.0–5.0, blank is off',
                    step: 0.1,
                    min: 1,
                    max: 5,
                    start: 4.5,
                    placeholder: 'Off',
                  })}
                </div>
                <p className='options-hint'>
                  Books below the minimum rating, or with fewer ratings than the
                  minimum, fail the filter. Books rated at least the highlight
                  rating get an outline, even with filtering off; highlighting
                  never hides a book. The panel's slider offers 3.0–5.0.
                </p>
                <form.Subscribe
                  selector={s =>
                    [s.values.hiddenLabels, s.values.highlightLabels] as const
                  }
                >
                  {([hidden, highlighted]) => (
                    <div className='grid gap-x-6 gap-y-3 border-t border-slate-200 pt-4 sm:grid-cols-2'>
                      <LabelPicker
                        id='hiddenLabels'
                        title='Hidden labels'
                        noun='hidden labels'
                        help='Books carrying any of these fail the label filter.'
                        labels={hidden}
                        taken={[...hidden, ...highlighted]}
                        seen={seen}
                        onAdd={label => {
                          form.setFieldValue('hiddenLabels', [...hidden, label])
                          form.setFieldValue(
                            'highlightLabels',
                            without(highlighted, label)
                          )
                        }}
                      />
                      <LabelPicker
                        id='highlightLabels'
                        title='Highlighted labels'
                        noun='highlighted labels'
                        help='Books carrying any of these get an outline, even with filtering off.'
                        labels={highlighted}
                        taken={[...hidden, ...highlighted]}
                        seen={seen}
                        onAdd={label => {
                          form.setFieldValue('highlightLabels', [
                            ...highlighted,
                            label,
                          ])
                          form.setFieldValue(
                            'hiddenLabels',
                            without(hidden, label)
                          )
                        }}
                      />
                      <LabelChips
                        noun='hidden labels'
                        tone='hide'
                        labels={hidden}
                        onRemove={label =>
                          form.setFieldValue(
                            'hiddenLabels',
                            without(hidden, label)
                          )
                        }
                      />
                      <LabelChips
                        noun='highlighted labels'
                        tone='highlight'
                        labels={highlighted}
                        onRemove={label =>
                          form.setFieldValue(
                            'highlightLabels',
                            without(highlighted, label)
                          )
                        }
                      />
                    </div>
                  )}
                </form.Subscribe>
                <div className='space-y-4 border-t border-slate-200 pt-4'>
                  <fieldset className='mx-0 mt-0 border-0 p-0'>
                    <legend className='text-sm font-medium'>
                      What happens to a book that fails each filter
                    </legend>
                    <ul className='mt-2 divide-y divide-slate-200 rounded-md border border-slate-200'>
                      {MODE_FIELDS.map(([dimension, label]) =>
                        modeRow(`modes.${dimension}`, label, HIDE_OR_DIM)
                      )}
                      {modeRow(
                        'notFound',
                        'Not on Goodreads',
                        SHOW_DIM_OR_HIDE
                      )}
                    </ul>
                  </fieldset>
                  <p className='options-hint'>
                    A book that fails several filters is hidden if any of them
                    hides. Cards in carousels are always dimmed. Books stay
                    visible until their ratings arrive; missing years and prices
                    do not fail those filters.
                  </p>
                </div>
                <fieldset className='m-0 space-y-2 border-0 border-t border-slate-200 p-0 pt-4'>
                  <legend className='sr-only'>First-published year</legend>
                  <p aria-hidden='true' className='text-sm font-medium'>
                    First-published year
                  </p>
                  <form.Subscribe
                    selector={s =>
                      [s.values.minYear, s.values.maxYear] as const
                    }
                  >
                    {([from, to]) => {
                      const text = describeYears(from, to)
                      const reversed =
                        text === undefined &&
                        from.trim() !== '' &&
                        to.trim() !== '' &&
                        Number(from) > Number(to)
                      return (
                        <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
                          <div
                            className={`inline-flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-1.5 text-sm text-slate-600 focus-within:outline-2 focus-within:outline-indigo-500 ${reversed ? 'border-red-400' : 'border-slate-300'}`}
                          >
                            <span aria-hidden='true'>From</span>
                            <form.Field name='minYear'>
                              {f => (
                                <input
                                  id='minYear'
                                  type='text'
                                  aria-label='From year'
                                  aria-describedby='years-help'
                                  value={f.state.value}
                                  placeholder='Any'
                                  onBlur={f.handleBlur}
                                  onChange={e => f.handleChange(e.target.value)}
                                  className='w-16 rounded border border-slate-300 bg-white px-1.5 py-1 text-center tabular-nums outline-none placeholder:text-slate-400'
                                />
                              )}
                            </form.Field>
                            <span aria-hidden='true'>to</span>
                            <form.Field name='maxYear'>
                              {f => (
                                <input
                                  id='maxYear'
                                  type='text'
                                  aria-label='To year'
                                  aria-describedby='years-help'
                                  value={f.state.value}
                                  placeholder='Any'
                                  onBlur={f.handleBlur}
                                  onChange={e => f.handleChange(e.target.value)}
                                  className='w-16 rounded border border-slate-300 bg-white px-1.5 py-1 text-center tabular-nums outline-none placeholder:text-slate-400'
                                />
                              )}
                            </form.Field>
                          </div>
                          <p
                            aria-live='polite'
                            className={`text-sm ${reversed ? 'text-red-700' : 'text-slate-500'}`}
                          >
                            {reversed
                              ? '“From” is later than “To”.'
                              : (text ?? '')}
                          </p>
                        </div>
                      )
                    }}
                  </form.Subscribe>
                  <p id='years-help' className='options-hint'>
                    Books first published outside this range fail the year
                    filter. Leave a side blank for no limit; negative years are
                    BCE and year 0 is not a publication year.
                  </p>
                </fieldset>
              </section>
              <section
                aria-labelledby='prices-heading'
                className='options-section'
              >
                <h2 id='prices-heading'>
                  <Tag aria-hidden='true' />
                  Prices
                </h2>
                <dl className='space-y-1 text-xs leading-relaxed text-slate-500'>
                  <div>
                    <dt className='inline font-medium text-slate-700'>
                      Maximum price:{' '}
                    </dt>
                    <dd className='inline'>
                      books above it fail the price filter. Public catalogue
                      prices may differ from member offers.
                    </dd>
                  </div>
                  <div>
                    <dt className='inline font-medium text-slate-700'>
                      Highlight price:{' '}
                    </dt>
                    <dd className='inline'>
                      books at or under it show their price in amber beside the
                      rating, whatever the filters do and on every page.
                    </dd>
                  </div>
                  <p>
                    Each marketplace has its own limits, in its own currency.
                    Blank is off; 0 is free only.
                  </p>
                </dl>
                <div>
                  <table className='w-full text-sm'>
                    <thead>
                      <tr className='text-left text-xs text-slate-500'>
                        <th scope='col' className='py-1 pr-4 font-medium'>
                          Marketplace
                        </th>
                        <th scope='col' className='py-1 pr-4 font-medium'>
                          Maximum price
                        </th>
                        <th scope='col' className='py-1 font-medium'>
                          Highlight price
                        </th>
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-slate-100'>
                      {REGIONS.map(r => (
                        <tr key={r.code}>
                          <th
                            scope='row'
                            className='py-1.5 pr-4 text-left font-normal'
                          >
                            <a
                              href={`https://${r.siteHost}/`}
                              target='_blank'
                              rel='noreferrer'
                              title={`Open ${r.siteHost}`}
                              // The fields are the keyboard's way through the table; the links are for the pointer.
                              tabIndex={-1}
                              className='text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-700'
                            >
                              audible.{r.tld}
                            </a>{' '}
                            <span className='text-xs text-slate-500'>
                              {r.currency}
                            </span>
                          </th>
                          <td className='py-1.5 pr-4'>
                            {priceCell(
                              `prices.${r.code}`,
                              `audible.${r.tld} (${r.currency})`,
                              r.currency
                            )}
                          </td>
                          <td className='py-1.5'>
                            {priceCell(
                              `highlightPrices.${r.code}`,
                              `Highlight price on audible.${r.tld} (${r.currency})`,
                              r.currency
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {toggle(
                  'priceOnDeals',
                  'Apply the maximum price on deals pages only'
                )}
                <p className='options-hint'>
                  A page is a deals page when its address has “deals” in it,
                  such as /ep/audiobook-deals. Elsewhere books are not filtered
                  by price.
                </p>
              </section>
            </fieldset>
          </form>

          {children}

          <section aria-labelledby='backup-heading' className='options-section'>
            <h2 id='backup-heading'>
              <ArchiveRestore aria-hidden='true' />
              Backup and reset
            </h2>
            <p className='options-hint'>
              Exports contain saved preferences only. Cached books and panel
              placement stay on this device.
            </p>
            <div className='flex flex-wrap items-center gap-3'>
              <button
                type='button'
                disabled={busy}
                className={button}
                onClick={async () => {
                  try {
                    download(exportPrefs(await readPrefs()))
                    setError('')
                    setMessage('Saved preferences exported.')
                  } catch (e) {
                    setError(`Could not export settings: ${errorText(e)}`)
                  }
                }}
              >
                <Download aria-hidden='true' className={icon} />
                Export prefs as JSON
              </button>
              <label className={`${button} cursor-pointer`}>
                <Upload aria-hidden='true' className={icon} />
                Import prefs from JSON
                <input
                  aria-label='Import prefs from JSON'
                  type='file'
                  accept='.json,application/json'
                  disabled={busy}
                  className='sr-only'
                  onChange={async e => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    setPending(undefined)
                    setError('')
                    setMessage('')
                    try {
                      if (file.size > 100_000)
                        throw new Error(
                          'The preferences file is too large (maximum 100 KB).'
                        )
                      const prefs = importPrefs(await file.text())
                      setPending({ kind: 'import', prefs })
                    } catch (error) {
                      setError(
                        `Could not import: ${errorText(error)}. No settings were changed.`
                      )
                    }
                  }}
                />
              </label>
              <button
                type='button'
                className={button}
                disabled={busy}
                onClick={() => {
                  setPending({ kind: 'reset', prefs: DEFAULT_PREFS })
                  setError('')
                  setMessage('')
                }}
              >
                <RotateCcw aria-hidden='true' className={icon} />
                Reset to defaults…
              </button>
            </div>
            {pending && (
              <fieldset
                aria-label='Confirm replacement'
                className='space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm'
              >
                <p>
                  {pending.kind === 'reset'
                    ? 'Reset every preference to its default?'
                    : 'Replace all saved preferences with this backup?'}{' '}
                  This replaces your draft too. Cached books and panel placement
                  are kept.
                </p>
                {pending.kind === 'import' && (
                  <p>
                    Ratings {pending.prefs.enabled ? 'on' : 'off'} · Filters{' '}
                    {pending.prefs.filters.enabled ? 'on' : 'off'} · Minimum
                    rating {pending.prefs.filters.minRating} ·{' '}
                    {pending.prefs.display.labels} labels per book.
                  </p>
                )}
                {pending.kind === 'import' && (
                  <details className='text-xs'>
                    <summary className='cursor-pointer font-medium'>
                      Review imported preferences
                    </summary>
                    <pre className='mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white p-3'>
                      {JSON.stringify(pending.prefs, null, 2)}
                    </pre>
                  </details>
                )}
                <div className='flex gap-3'>
                  <button
                    type='button'
                    disabled={busy}
                    className={primary}
                    onClick={() =>
                      write(
                        () => updatePrefs(pending.prefs),
                        pending.kind === 'reset'
                          ? 'Preferences reset to defaults.'
                          : 'Preferences imported.'
                      )
                    }
                  >
                    {pending.kind === 'reset'
                      ? 'Reset preferences'
                      : 'Import preferences'}
                  </button>
                  <button
                    type='button'
                    disabled={busy}
                    className={button}
                    onClick={() => setPending(undefined)}
                  >
                    Cancel
                  </button>
                </div>
              </fieldset>
            )}
          </section>
        </div>
      </div>

      {/* The bar stays at the bottom of the window while the page scrolls, so changes are never out of sight. */}
      <form.Subscribe
        selector={s => [s.isDefaultValue, s.isSubmitting, s.errors] as const}
      >
        {([clean, submitting, errors]) => {
          if (clean && !error && !message) return null
          return (
            <div className='sticky bottom-4 z-20 mx-auto w-full max-w-2xl'>
              {clean ? (
                <div
                  className={`flex items-start gap-2 rounded-xl border bg-white p-3 text-sm shadow-lg ${error ? 'border-red-300' : 'border-emerald-300'}`}
                >
                  {error ? (
                    <p role='alert' className='flex-1 text-red-700'>
                      {error}
                    </p>
                  ) : (
                    <p
                      role='status'
                      className='flex flex-1 items-center gap-2 text-emerald-800'
                    >
                      <Check aria-hidden='true' className={icon} />
                      {message}
                    </p>
                  )}
                  <button
                    type='button'
                    aria-label='Dismiss'
                    className='rounded p-0.5 text-slate-500 hover:bg-slate-100'
                    onClick={() => {
                      setError('')
                      setMessage('')
                    }}
                  >
                    <X aria-hidden='true' className={icon} />
                  </button>
                </div>
              ) : (
                <div className='space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-lg'>
                  {external && (
                    <p role='status' className='text-sm'>
                      Settings changed in another tab. Your draft is kept; Save
                      applies only your edits.
                      <button
                        type='button'
                        className={`${button} ml-3 py-1`}
                        disabled={busy}
                        onClick={() => showSaved(latest.current)}
                      >
                        Reload saved settings
                      </button>
                    </p>
                  )}
                  {errors.length > 0 && (
                    <p
                      role='alert'
                      className='whitespace-pre-wrap text-sm text-red-700'
                    >
                      Check the settings: {errors.join('\n')}
                    </p>
                  )}
                  {error && (
                    <p role='alert' className='text-sm text-red-700'>
                      {error}
                    </p>
                  )}
                  {message && (
                    <p role='status' className='text-sm text-emerald-800'>
                      {message}
                    </p>
                  )}
                  <div className='flex flex-wrap items-center gap-3'>
                    <span className='flex items-center gap-2 text-sm font-medium text-amber-900'>
                      <span
                        aria-hidden='true'
                        className='h-2 w-2 rounded-full bg-amber-500'
                      />
                      Unsaved changes
                    </span>
                    <div className='ml-auto flex gap-2'>
                      <button
                        type='button'
                        className={button}
                        disabled={busy}
                        onClick={() => showSaved(latest.current)}
                      >
                        <Undo2 aria-hidden='true' className={icon} />
                        Discard changes
                      </button>
                      <button
                        type='button'
                        disabled={busy || submitting}
                        className={primary}
                        onClick={() => void form.handleSubmit()}
                      >
                        <Save aria-hidden='true' className={icon} />
                        Save settings
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        }}
      </form.Subscribe>
    </>
  )
}

export function App({
  download = downloadPrefs,
  backend = cacheBackend,
}: {
  download?: (text: string) => void
  backend?: CacheBackend
}) {
  const [inspect, setInspect] = useState(false)
  const [version, setVersion] = useState(0)
  const [initial, setInitial] = useState<Prefs>()
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    let changed = false
    // Watch first: a change arriving during the initial read wins.
    const stop = watchPrefs(prefs => {
      changed = true
      if (current) {
        setError('')
        setInitial(prefs)
      }
    })
    readPrefs().then(
      prefs => {
        if (current) setInitial(known => known ?? prefs)
      },
      e => {
        if (current && !changed) setError(errorText(e))
      }
    )
    return () => {
      current = false
      stop()
    }
  }, [])
  // The popup links to `#cache`; the section is only where it belongs once the settings above it are drawn.
  const loaded = initial !== undefined
  useEffect(() => {
    if (loaded && location.hash === '#cache')
      document.getElementById('cache')?.scrollIntoView()
  }, [loaded])
  const cache = (
    <>
      <CacheSummary backend={backend} version={version}>
        {!inspect && (
          <button
            type='button'
            className={button}
            onClick={() => setInspect(true)}
          >
            <Database aria-hidden='true' className={icon} />
            Open cache inspector
          </button>
        )}
      </CacheSummary>
      {inspect && (
        <CacheInspector
          backend={backend}
          onChange={() => setVersion(v => v + 1)}
        />
      )}
    </>
  )
  const footer = (
    <footer className='space-y-2 border-t border-slate-200 pt-6 text-xs text-slate-500'>
      <h2 className='text-sm font-semibold text-slate-800'>About</h2>
      <p>
        No server, account, analytics or telemetry. Settings sync through the
        browser; cached books stay on this device.
      </p>
      <p>Not affiliated with Audible, Amazon or Goodreads.</p>
      <nav aria-label='Project links' className='flex flex-wrap gap-2 pt-1'>
        <a className={link} href={PRIVACY_URL} target='_blank' rel='noreferrer'>
          <ShieldCheck aria-hidden='true' className={icon} />
          Privacy statement
        </a>
        <a className={link} href={SOURCE_URL} target='_blank' rel='noreferrer'>
          <Github aria-hidden='true' className={icon} />
          GitHub repository
        </a>
        {!import.meta.env.FIREFOX && (
          <a className={link} href={STORE_URL} target='_blank' rel='noreferrer'>
            <Store aria-hidden='true' className={icon} />
            Chrome Web Store page
          </a>
        )}
      </nav>
    </footer>
  )
  return (
    <main className='mx-auto max-w-3xl space-y-8 px-5 py-10 text-slate-800'>
      <header className='border-b border-slate-200 pb-6'>
        <div className='flex items-center gap-4'>
          <Logo size={56} />
          <div>
            <p className='text-xs font-semibold uppercase tracking-widest text-indigo-600'>
              Book Ratings for Audible
            </p>
            <h1 className='mt-1 text-3xl font-semibold tracking-tight'>
              Settings
            </h1>
          </div>
        </div>
        <p className='mt-3 text-sm text-slate-500'>
          Your preferences follow your browser profile across devices and
          Audible marketplaces.
        </p>
      </header>
      {!initial && !error && <p role='status'>Loading settings…</p>}
      {error && (
        <p role='alert'>
          Could not read settings: {error}. Reload this page to try again.
        </p>
      )}
      {initial ? (
        <Settings initial={initial} download={download} backend={backend}>
          {cache}
        </Settings>
      ) : (
        cache
      )}
      {footer}
    </main>
  )
}
