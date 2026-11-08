/**
 * One made-up book drawn the way the extension draws it with the display settings as they are in the
 * form right now, saved or not: the rating, the year, as many labels as chosen, and the highlights
 * (an outlined cover, an amber label, a struck-through hidden label). Counts and labels come from the
 * badge code, so the preview cannot say something the page would not do; only the look is imitated.
 * Hovering the rating shows the overview box when that is switched on, else the plain tooltip.
 */
import { useState } from 'react'
import { fmtN, visibleGenres } from '@/content/badges'
import type { WithOverview } from '@/content/books'
import { OVERVIEW_GENRES, ratingLine } from '@/content/overview'
import { hasLabel } from '@/core/filter'
import { Logo } from '@/lib/Logo'
import { GENRES_MAX } from '@/schema/common'
import type { SettingsDraft } from './settings'

const BOOK = {
  title: 'Orbit of Glass',
  author: 'Ada Kerr',
  rating: { r: 4.52, n: 21_340 },
  year: 2021,
  desc: 'A lone engineer wakes aboard a stranded ship with no memory of why he is there, and a few days to understand it. Armed with a notebook, an unlikely friend and the science he half remembers, he must solve a problem that is bigger than one ship.',
  genres: [
    'Science Fiction',
    'Space Opera',
    'Adventure',
    'Fiction',
    'Humor',
    'Aliens',
    'Survival',
    'Technology',
    'Mystery',
    'Thriller',
    'Audiobook',
  ],
} as const

/** The book as the content script holds it, which the overview's own code reads. */
const VIEW: WithOverview = {
  status: 'ready',
  rating: { ...BOOK.rating, url: '', loose: false },
  details: { genres: BOOK.genres, year: BOOK.year, desc: BOOK.desc },
}

const pill =
  'rounded-[9px] border px-1.5 text-[11px] leading-[17px] whitespace-nowrap'

/** The label count as typed, kept to whole numbers 0..10; an unreadable text draws none. */
const labelCount = (text: string) => {
  const n = Number(text)
  return text.trim() !== '' && Number.isFinite(n)
    ? Math.min(GENRES_MAX, Math.max(0, Math.round(n)))
    : 0
}

export function Preview({ draft }: { draft: SettingsDraft }) {
  const [hover, setHover] = useState(false)
  const genres = visibleGenres(BOOK.genres, labelCount(draft.labels))
  const rating = Number(draft.highlightRating)
  const highlighted =
    (draft.highlightRating.trim() !== '' &&
      Number.isFinite(rating) &&
      BOOK.rating.r >= rating) ||
    BOOK.genres.some(g => hasLabel(draft.highlightLabels, g))
  return (
    <div>
      <p className='text-sm font-medium'>Preview</p>
      {draft.enabled ? (
        <div className='relative mt-1 flex gap-3 rounded-md border border-slate-200 bg-white p-2'>
          <div
            aria-hidden='true'
            className={`h-16 w-12 shrink-0 rounded bg-gradient-to-br from-indigo-500 to-sky-400 ${highlighted ? 'shadow-[0_0_10px_2px_rgba(251,191,36,0.5)] outline-2 -outline-offset-2 outline-amber-400' : ''}`}
          />
          <div className='min-w-0 flex-1'>
            <p className='truncate text-sm font-medium'>{BOOK.title}</p>
            <p className='truncate text-xs text-slate-500'>{BOOK.author}</p>
            <div className='mt-1 flex flex-wrap items-center gap-1'>
              <button
                type='button'
                // A pointer demonstration: a real badge is a link, and the preview is not a control.
                tabIndex={-1}
                title={
                  draft.overview
                    ? undefined
                    : `Goodreads: ${BOOK.rating.r.toFixed(2)} from ${BOOK.rating.n.toLocaleString()} ratings`
                }
                onPointerEnter={() => setHover(true)}
                onPointerLeave={() => setHover(false)}
                className='inline-flex cursor-pointer items-center gap-1 rounded-[10px] border border-[#a9d3a2] bg-[#e3f2e1] px-[7px] text-xs leading-[18px] font-semibold text-[#382110] hover:bg-[#d5ebd2]'
              >
                ★ {BOOK.rating.r.toFixed(2)}
                <span className='font-normal opacity-75'>
                  ({fmtN(BOOK.rating.n)})
                </span>
              </button>
              {draft.year && (
                <span className='px-0.5 text-[11px] leading-[17px] font-semibold text-[#7a6a58]'>
                  {BOOK.year}
                </span>
              )}
              {genres.map(genre => (
                <span
                  key={genre}
                  className={`${pill} ${
                    hasLabel(draft.hiddenLabels, genre)
                      ? 'border-[#e0b0a6] bg-[#f8e5e1] text-[#8a3b2c] line-through'
                      : hasLabel(draft.highlightLabels, genre)
                        ? 'border-[#fcd34d] bg-[#fef3c7] font-semibold text-[#78350f]'
                        : 'border-[#e2dacb] bg-white text-[#5c4a3a]'
                  }`}
                >
                  {genre}
                </span>
              ))}
            </div>
          </div>
          {hover && draft.overview && (
            <div
              role='tooltip'
              className='absolute top-full left-14 z-20 mt-1.5 w-[22rem] max-w-[calc(100%-3.5rem)] overflow-hidden rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[13px] leading-[1.45] text-slate-900 shadow-lg'
            >
              <div className='mb-1 flex items-start gap-2'>
                <Logo size={18} />
                <b className='font-semibold'>{ratingLine(VIEW, draft.year)}</b>
              </div>
              <span className='mb-1.5 block text-xs text-slate-600'>
                {BOOK.genres.slice(0, OVERVIEW_GENRES).join(' · ')}
              </span>
              <span className='block max-h-16 overflow-hidden'>
                {BOOK.desc}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className='mt-1 text-sm text-slate-500'>
          Ratings are off: Audible's pages are left as they are.
        </p>
      )}
      {draft.enabled && (
        <p className='options-hint mt-1'>
          Hover the rating to see{' '}
          {draft.overview
            ? 'the overview box.'
            : 'the plain tooltip: the overview is off.'}
        </p>
      )}
    </div>
  )
}
