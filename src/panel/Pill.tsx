import { useStore } from '@tanstack/react-store'
import { Funnel, FunnelX } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PanelHandle } from '@/content/shared'
import type { Drag } from './drag'
import { useFilterPrefs } from './prefs'
import { filteredText } from './summary'

/**
 * The collapsed panel: the lookups' progress, which expands the panel, and the filters' switch with
 * how many cards they take out of view. Either half can be dragged to move the pill.
 */
export function Pill({
  handle,
  text,
  avatar,
  drag,
  onExpand,
}: {
  handle: PanelHandle
  /** `34/60`, from `pillText`. */
  text: string
  avatar: ReactNode
  drag: Drag
  onExpand(): void
}) {
  const { filters, change } = useFilterPrefs()
  const hidden = useStore(handle.filter, s => s.hidden)
  const dimmed = useStore(handle.filter, s => s.dimmed)
  const cursor = drag.at ? 'cursor-grabbing' : 'cursor-grab'
  const on = filters?.enabled === true
  const counts = on ? filteredText(hidden, dimmed) : ''
  return (
    <div className='flex items-center rounded-full border border-slate-300 bg-white text-xs font-semibold shadow-lg select-none'>
      <button
        type='button'
        aria-label={`Goodreads ratings ${text}, expand`}
        title='Click to expand, drag to move'
        onClick={() => {
          if (!drag.wasDrag()) onExpand()
        }}
        {...drag.handlers}
        className={`flex touch-none items-center gap-1.5 rounded-full py-1 pr-3 pl-1 hover:bg-slate-100 ${cursor}`}
      >
        {avatar}
        {text}
      </button>
      {filters && (
        <button
          type='button'
          aria-pressed={on}
          aria-label={counts ? `Filter books, ${counts}` : 'Filter books'}
          title={`${on ? `Filtering is on${counts ? `: ${counts}` : ''}. Click to turn it off` : 'Filtering is off. Click to turn it on'}; drag to move`}
          onClick={() => {
            if (!drag.wasDrag()) change({ enabled: !on })
          }}
          {...drag.handlers}
          className={`flex touch-none items-center gap-1 rounded-r-full border-l border-slate-200 py-1 pr-2.5 pl-2 hover:bg-slate-100 ${cursor} ${on ? 'text-indigo-700' : 'text-slate-400'}`}
        >
          {on ? (
            <Funnel aria-hidden='true' className='h-3.5 w-3.5' />
          ) : (
            <FunnelX aria-hidden='true' className='h-3.5 w-3.5' />
          )}
          {on && hidden + dimmed > 0 && <span>{hidden + dimmed}</span>}
        </button>
      )}
    </div>
  )
}
