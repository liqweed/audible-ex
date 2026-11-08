import { Database } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { CacheBar } from '@/lib/CacheBar'
import { books, formatBytes } from '@/lib/format'
import type { Stats } from '@/schema/popup'
import type { CacheBackend } from './cache-backend'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; stats: Stats }
  | { kind: 'error'; message: string }

/** How much the cache holds and how it splits, read again whenever `version` changes. */
export function CacheSummary({
  backend,
  version,
  children,
}: {
  backend: Pick<CacheBackend, 'stats'>
  version: number
  /** What goes under the summary, such as the button that opens the inspector. */
  children?: ReactNode
}) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` only asks for a new read.
  useEffect(() => {
    let current = true
    backend.stats().then(
      stats => current && setState({ kind: 'ready', stats }),
      e =>
        current &&
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : String(e),
        })
    )
    return () => {
      current = false
    }
  }, [backend, version])
  return (
    <section
      id='cache'
      aria-labelledby='cache-summary-heading'
      className='options-section'
    >
      <h2 id='cache-summary-heading'>
        <Database aria-hidden='true' />
        Cache
      </h2>
      <p className='text-sm' aria-live='polite'>
        {state.kind === 'loading' && 'Reading the cache…'}
        {state.kind === 'error' && `Could not read the cache: ${state.message}`}
        {state.kind === 'ready' &&
          (state.stats.books === 0
            ? 'The cache is empty.'
            : `${books(state.stats.books)} cached (${formatBytes(state.stats.bytes)}), ${state.stats.pinned} from Library and Wish List.`)}
      </p>
      {state.kind === 'ready' && <CacheBar {...state.stats} />}
      <p className='options-hint'>
        Books from your Library and Wish List are kept for months, all others
        for a month. The cache stays on this device.
      </p>
      {children}
    </section>
  )
}
