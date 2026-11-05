import { useForm } from '@tanstack/react-form'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dimension, MissMode, Verdict } from '@/core/filter'
import { REGIONS, type RegionCode } from '@/core/regions'
import { PRIVACY_URL, SOURCE_URL } from '@/lib/links'
import { CacheInspector } from '@/options/CacheInspector'
import {
  draftFromPrefs,
  exportPrefs,
  importPrefs,
  prefsFromDraft,
  saveSettings,
} from '@/options/settings'
import {
  DEFAULT_PREFS,
  type Prefs,
  readPrefs,
  updatePrefs,
  watchPrefs,
} from '@/storage/prefs'

const field =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-indigo-500'
const button =
  'rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50'
const primary = `${button} border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700`
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

type TextKey =
  | 'minRating'
  | 'minRatings'
  | 'highlightRating'
  | 'minYear'
  | 'maxYear'
  | 'labels'
  | `prices.${RegionCode}`
  | `highlightPrices.${RegionCode}`
type BooleanKey = 'enabled' | 'filtering' | 'priceOnDeals' | 'year' | 'overview'
type PolicyKey = 'notFound' | `modes.${Dimension}`

/** Each filter with its own hide-or-dim choice, as the options page names it. */
const MODE_FIELDS: ReadonlyArray<readonly [Dimension, string]> = [
  ['rating', 'Below the minimum rating'],
  ['count', 'Too few ratings'],
  ['year', 'Outside the year range'],
  ['price', 'Above the maximum price'],
  ['labels', 'Carrying a hidden label'],
]

function Settings({
  initial,
  download,
}: {
  initial: Prefs
  download(text: string): void
}) {
  const baseline = useRef(initial)
  const latest = useRef(initial)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [external, setExternal] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
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

  function text(name: TextKey, label: string, help?: string) {
    return (
      <form.Field key={name} name={name}>
        {f => (
          <div>
            <label htmlFor={name} className='text-sm font-medium'>
              {label}
            </label>
            <input
              id={name}
              type='text'
              inputMode={name.includes('Year') ? 'text' : 'decimal'}
              value={f.state.value}
              onBlur={f.handleBlur}
              onChange={e => f.handleChange(e.target.value)}
              aria-describedby={help ? `${name}-help` : undefined}
              className={field}
            />
            {help && (
              <p id={`${name}-help`} className='mt-1 text-xs text-slate-500'>
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
  function policy(
    name: PolicyKey,
    label: string,
    options: readonly (Verdict | MissMode)[]
  ) {
    return (
      <form.Field key={name} name={name}>
        {f => (
          <div>
            <label htmlFor={name} className='text-sm font-medium'>
              {label}
            </label>
            <select
              id={name}
              value={f.state.value}
              className={field}
              onBlur={f.handleBlur}
              onChange={e =>
                f.handleChange(e.target.value as typeof f.state.value)
              }
            >
              {options.map(option => (
                <option key={option} value={option}>
                  {option[0]?.toUpperCase()}
                  {option.slice(1)}
                </option>
              ))}
            </select>
          </div>
        )}
      </form.Field>
    )
  }

  function labelList(
    name: 'hiddenLabels' | 'highlightLabels',
    label: string,
    help: string
  ) {
    return (
      <form.Field key={name} name={name}>
        {f => (
          <div>
            <label htmlFor={name} className='text-sm font-medium'>
              {label}
            </label>
            <textarea
              id={name}
              rows={3}
              value={f.state.value}
              onBlur={f.handleBlur}
              onChange={e => f.handleChange(e.target.value)}
              aria-describedby={`${name}-help`}
              className={field}
            />
            <p id={`${name}-help`} className='options-hint'>
              One Goodreads genre per line, compared without regard to case.{' '}
              {help}
            </p>
          </div>
        )}
      </form.Field>
    )
  }

  return (
    <>
      {external && (
        <div
          role='status'
          className='rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm'
        >
          Settings changed in another tab. Your draft is kept; Save applies only
          your edits.
          <button
            type='button'
            className={`${button} ml-3`}
            disabled={busy}
            onClick={() => showSaved(latest.current)}
          >
            Reload saved settings
          </button>
        </div>
      )}
      <form
        onSubmit={e => {
          e.preventDefault()
          void form.handleSubmit()
        }}
        noValidate
      >
        <fieldset
          disabled={busy || pending !== undefined}
          className='m-0 space-y-8 border-0 p-0'
        >
          <section
            aria-labelledby='general-heading'
            className='options-section'
          >
            <h2 id='general-heading'>General</h2>
            {toggle('enabled', 'Show ratings on Audible')}
          </section>
          <section
            aria-labelledby='display-heading'
            className='options-section'
          >
            <h2 id='display-heading'>Display</h2>
            <p className='options-hint'>
              These choices update badges in every open Audible tab.
            </p>
            <div className='max-w-xs'>
              {text(
                'labels',
                'Labels per book',
                'A whole number from 0 to 10; 0 hides labels.'
              )}
            </div>
            {toggle('year', 'Show first-published year')}
            {toggle('overview', 'Show overview on hover')}
          </section>
          <section
            aria-labelledby='filters-heading'
            className='options-section'
          >
            <h2 id='filters-heading'>Filters</h2>
            {toggle('filtering', 'Filter books')}
            <div className='grid gap-5 sm:grid-cols-2'>
              {text(
                'minRating',
                'Minimum rating',
                '1.0–5.0. The panel slider offers 3.0–5.0.'
              )}
              {text(
                'minRatings',
                'Minimum number of ratings',
                'A whole number; 0 turns this off.'
              )}
              {text(
                'highlightRating',
                'Highlight rating',
                'Books rated at least this get an outline, even with filtering off. 1.0–5.0; blank is off. Highlighting never hides a book.'
              )}
              {text(
                'minYear',
                'From year',
                'Blank is no lower bound; negative years are BCE.'
              )}
              {text(
                'maxYear',
                'To year',
                'Blank is no upper bound; year 0 is not a publication year.'
              )}
            </div>
            <div className='grid gap-5 sm:grid-cols-2'>
              {labelList(
                'hiddenLabels',
                'Hidden labels',
                'Books carrying any of these fail the label filter.'
              )}
              {labelList(
                'highlightLabels',
                'Highlighted labels',
                'Books carrying any of these get an outline, even with filtering off. Highlighting never hides a book.'
              )}
            </div>
            <fieldset className='m-0 border-0 p-0'>
              <legend className='text-sm font-medium'>
                What happens to a book that fails each filter
              </legend>
              <div className='mt-2 grid gap-5 sm:grid-cols-3'>
                {MODE_FIELDS.map(([dimension, label]) =>
                  policy(`modes.${dimension}`, label, ['hide', 'dim'])
                )}
                {policy('notFound', 'Not on Goodreads', [
                  'show',
                  'dim',
                  'hide',
                ])}
              </div>
            </fieldset>
            <p className='options-hint'>
              A book that fails several filters is hidden if any of them hides.
              Cards in carousels are always dimmed. Books stay visible until
              their ratings arrive; missing years and prices do not fail those
              filters.
            </p>
          </section>
          <section aria-labelledby='prices-heading' className='options-section'>
            <h2 id='prices-heading'>Maximum public price</h2>
            <p className='options-hint'>
              A separate limit for each marketplace in its own currency. Blank
              is off; 0 is free only. Public catalogue prices may differ from
              member offers.
            </p>
            <div className='grid gap-5 sm:grid-cols-2'>
              {REGIONS.map(r =>
                text(`prices.${r.code}`, `audible.${r.tld} (${r.currency})`)
              )}
            </div>
            {toggle(
              'priceOnDeals',
              'Apply the price limit on deals pages only'
            )}
            <p className='options-hint'>
              A page is a deals page when its address has “deals” in it, such as
              /ep/audiobook-deals. Elsewhere books are not filtered by price.
            </p>
          </section>
          <section
            aria-labelledby='highlight-price-heading'
            className='options-section'
          >
            <h2 id='highlight-price-heading'>Highlight price</h2>
            <p className='options-hint'>
              Books priced at or under this show their price in amber beside the
              rating, whatever the filters do and on every page. One per
              marketplace, in its own currency; blank is off, 0 is free only.
            </p>
            <div className='grid gap-5 sm:grid-cols-2'>
              {REGIONS.map(r =>
                text(
                  `highlightPrices.${r.code}`,
                  `Highlight price on audible.${r.tld} (${r.currency})`
                )
              )}
            </div>
          </section>
          <form.Subscribe selector={s => [s.isSubmitting, s.errors] as const}>
            {([submitting, errors]) => (
              <div className='space-y-3'>
                {errors.length > 0 && (
                  <p
                    role='alert'
                    className='whitespace-pre-wrap text-sm text-red-700'
                  >
                    Check the settings: {errors.join('\n')}
                  </p>
                )}
                <div className='flex flex-wrap gap-3'>
                  <button
                    type='submit'
                    disabled={submitting}
                    className={primary}
                  >
                    Save settings
                  </button>
                  <button
                    type='button'
                    className={button}
                    onClick={() => showSaved(latest.current)}
                  >
                    Discard changes
                  </button>
                </div>
              </div>
            )}
          </form.Subscribe>
        </fieldset>
      </form>

      <section aria-labelledby='backup-heading' className='options-section'>
        <h2 id='backup-heading'>Backup and reset</h2>
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
            Export prefs as JSON
          </button>
          <label className={`${button} cursor-pointer`}>
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
              This replaces your draft too. Cached books and panel placement are
              kept.
            </p>
            {pending.kind === 'import' && (
              <p>
                Ratings {pending.prefs.enabled ? 'on' : 'off'} · Filters{' '}
                {pending.prefs.filters.enabled ? 'on' : 'off'} · Minimum rating{' '}
                {pending.prefs.filters.minRating} ·{' '}
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
    </>
  )
}

export function App({
  download = downloadPrefs,
}: {
  download?: (text: string) => void
}) {
  const [inspect, setInspect] = useState(false)
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
  return (
    <main className='mx-auto max-w-3xl space-y-8 px-5 py-10 text-slate-800'>
      <header className='border-b border-slate-200 pb-6'>
        <p className='text-xs font-semibold uppercase tracking-widest text-indigo-600'>
          Book Ratings for Audible
        </p>
        <h1 className='mt-2 text-3xl font-semibold tracking-tight'>Settings</h1>
        <p className='mt-2 text-sm text-slate-500'>
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
      {initial && <Settings initial={initial} download={download} />}
      {inspect ? (
        <CacheInspector />
      ) : (
        <button
          type='button'
          className={button}
          onClick={() => setInspect(true)}
        >
          Open cache inspector
        </button>
      )}
      <footer className='space-y-2 border-t border-slate-200 pt-6 text-xs text-slate-500'>
        <h2 className='text-sm font-semibold text-slate-800'>About</h2>
        <p>
          No server, account, analytics or telemetry. Settings sync through the
          browser; cached books stay on this device.
        </p>
        <p>Not affiliated with Audible, Amazon or Goodreads.</p>
        <p className='flex gap-4'>
          <a
            className='underline'
            href={PRIVACY_URL}
            target='_blank'
            rel='noreferrer'
          >
            Privacy statement
          </a>
          <a
            className='underline'
            href={SOURCE_URL}
            target='_blank'
            rel='noreferrer'
          >
            Source code
          </a>
        </p>
      </footer>
    </main>
  )
}
