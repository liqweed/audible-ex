import * as Switch from '@radix-ui/react-switch'
import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { PRIVACY_URL, SOURCE_URL } from '@/lib/links'
import type { ClearScope, Stats } from '@/schema/popup'
import { readPanel, updatePanel, watchPanel } from '@/storage/panel'
import { readPrefs, updatePrefs, watchPrefs } from '@/storage/prefs'
import { type Backend, extensionBackend } from './backend'
import { books, formatBytes } from './format'

const button =
  'rounded-md border border-border bg-secondary px-3 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50'

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/** The master switch, kept in step with the preference: other popups and the options page change it too. */
function useEnabled() {
  const [enabled, setEnabled] = useState<boolean>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let current = true
    readPrefs().then(
      prefs => current && setEnabled(prefs.enabled),
      e => current && setError(messageOf(e))
    )
    const stop = watchPrefs(prefs => setEnabled(prefs.enabled))
    return () => {
      current = false
      stop()
    }
  }, [])
  const change = useCallback((value: boolean) => {
    setEnabled(value)
    updatePrefs({ enabled: value }).catch(e => setError(messageOf(e)))
  }, [])
  return { enabled, change, error }
}

/** The Audible sites where the user hid the panel, kept in step with the panel's own storage. */
function useHiddenSites() {
  const [hosts, setHosts] = useState<readonly string[]>([])
  const [error, setError] = useState<string>()
  useEffect(() => {
    let current = true
    readPanel().then(
      panel => current && setHosts(panel.hiddenHosts),
      e => current && setError(messageOf(e))
    )
    const stop = watchPanel(panel => setHosts(panel.hiddenHosts))
    return () => {
      current = false
      stop()
    }
  }, [])
  const showAgain = useCallback(() => {
    setHosts([])
    updatePanel({ hiddenHosts: [] }).catch(e => setError(messageOf(e)))
  }, [])
  return { hosts, showAgain, error }
}

type CacheState =
  | { kind: 'loading' }
  | { kind: 'ready'; stats: Stats }
  | { kind: 'error'; message: string }

/** The cache's size and the two ways to empty it. */
function Cache({ backend }: { backend: Backend }) {
  const [cache, setCache] = useState<CacheState>({ kind: 'loading' })
  const [result, setResult] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      backend.stats().then(
        stats => setCache({ kind: 'ready', stats }),
        e => setCache({ kind: 'error', message: messageOf(e) })
      ),
    [backend]
  )
  useEffect(() => {
    load()
  }, [load])

  async function clear(scope: ClearScope) {
    setBusy(true)
    setConfirming(false)
    setResult(undefined)
    try {
      const deleted = await backend.clear(scope)
      setResult(
        `Cleared ${deleted} ${deleted === 1 ? 'entry' : 'entries'}.` +
          (scope === 'unpinned'
            ? ' Library, Wish List and manual matches were kept.'
            : '')
      )
    } catch (e) {
      setResult(`Could not clear the cache: ${messageOf(e)}`)
    }
    await load()
    setBusy(false)
  }

  return (
    <section aria-labelledby='cache-heading' className='space-y-2'>
      <h2 id='cache-heading' className='text-sm font-semibold'>
        Cache
      </h2>
      <p className='text-sm text-muted-foreground' aria-live='polite'>
        {cache.kind === 'loading' && 'Reading the cache…'}
        {cache.kind === 'error' && `Could not read the cache: ${cache.message}`}
        {cache.kind === 'ready' &&
          (cache.stats.books === 0
            ? 'The cache is empty.'
            : `${books(cache.stats.books)} cached (${formatBytes(cache.stats.bytes)}), ${cache.stats.pinned} from Library and Wish List.`)}
      </p>
      <div className='flex flex-col gap-2'>
        <button
          type='button'
          className={button}
          disabled={busy}
          onClick={() => clear('unpinned')}
        >
          Clear, keeping Library, Wish List and manual matches
        </button>
        {confirming ? (
          <div className='space-y-2 rounded-md border border-destructive p-2'>
            <p className='text-sm'>
              This also forgets manual matches and the books of your Library and
              Wish List.
            </p>
            <div className='flex gap-2'>
              <button
                type='button'
                className={button}
                disabled={busy}
                onClick={() => clear('all')}
              >
                Clear everything
              </button>
              <button
                type='button'
                className={button}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type='button'
            className={button}
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Clear everything…
          </button>
        )}
      </div>
      {result && (
        <p className='text-sm' role='status'>
          {result}
        </p>
      )}
    </section>
  )
}

export function App({ backend = extensionBackend }: { backend?: Backend }) {
  const { enabled, change, error } = useEnabled()
  const hidden = useHiddenSites()
  return (
    <main className='w-80 space-y-4 p-4'>
      <header>
        <h1 className='text-lg font-semibold'>Book Ratings for Audible</h1>
        <p className='text-sm text-muted-foreground'>
          Goodreads ratings on Audible.
        </p>
      </header>
      <div className='flex items-center justify-between gap-3'>
        <label htmlFor='enabled' className='text-sm'>
          Show ratings on Audible
        </label>
        <Switch.Root
          id='enabled'
          checked={enabled ?? true}
          disabled={enabled === undefined}
          onCheckedChange={change}
          className='relative h-5 w-9 shrink-0 rounded-full border border-border bg-secondary data-[state=checked]:bg-foreground'
        >
          <Switch.Thumb className='block h-4 w-4 translate-x-0.5 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-[18px]' />
        </Switch.Root>
      </div>
      {hidden.hosts.length > 0 && (
        <div className='space-y-1'>
          <button type='button' className={button} onClick={hidden.showAgain}>
            Show the panel again
          </button>
          <p className='text-xs text-muted-foreground'>
            Hidden on {hidden.hosts.join(', ')}.
          </p>
        </div>
      )}
      {(error ?? hidden.error) && (
        <p className='text-sm text-destructive' role='alert'>
          Could not use the settings: {error ?? hidden.error}
        </p>
      )}
      <button
        type='button'
        className={button}
        onClick={() => browser.runtime.openOptionsPage()}
      >
        Settings
      </button>
      <Cache backend={backend} />
      <footer className='space-y-1 border-t border-border pt-3 text-xs text-muted-foreground'>
        <p>Not affiliated with Audible, Amazon or Goodreads.</p>
        <p className='flex gap-3'>
          <a
            href={PRIVACY_URL}
            target='_blank'
            rel='noreferrer'
            className='underline'
          >
            Privacy
          </a>
          <a
            href={SOURCE_URL}
            target='_blank'
            rel='noreferrer'
            className='underline'
          >
            Source
          </a>
        </p>
      </footer>
    </main>
  )
}
