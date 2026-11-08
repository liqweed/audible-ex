/** How the cached books divide: Library, Wish List, pins not yet sorted into either, and the rest. */
export interface CacheCounts {
  readonly books: number
  readonly pinned: number
  readonly library: number
  readonly wishlist: number
}

/** The counts clamped so the parts never add up to more than the books there are. */
export function cacheSplit({ books, pinned, library, wishlist }: CacheCounts) {
  const kept = Math.min(Math.max(pinned, 0), books)
  const inLibrary = Math.min(Math.max(library, 0), kept)
  const onWishList = Math.min(Math.max(wishlist, 0), kept - inLibrary)
  return {
    library: inLibrary,
    wishlist: onWishList,
    unsorted: kept - inLibrary - onWishList,
    other: books - kept,
  }
}

const PARTS = [
  { key: 'library', text: 'Library', color: 'bg-indigo-600' },
  { key: 'wishlist', text: 'Wish List', color: 'bg-sky-500' },
  {
    key: 'unsorted',
    text: 'Library or Wish List, not told apart yet',
    color: 'bg-indigo-300',
  },
  { key: 'other', text: 'Everything else', color: 'bg-slate-200' },
] as const

/**
 * A single bar: the books kept for months (Library and Wish List) against all the others, kept for
 * a month. Drawn from divs, so it needs no chart library.
 */
export function CacheBar(counts: CacheCounts) {
  if (counts.books === 0) return null
  const split = cacheSplit(counts)
  const parts = PARTS.filter(part => split[part.key] > 0)
  return (
    <div className='space-y-1.5'>
      <div
        role='img'
        aria-label={`Cached books: ${parts.map(p => `${split[p.key]} ${p.text}`).join(', ')}`}
        className='flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200'
      >
        {parts.map(part => (
          <div
            key={part.key}
            className={`h-full ${part.color}`}
            style={{ width: `${(split[part.key] / counts.books) * 100}%` }}
          />
        ))}
      </div>
      <ul className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600'>
        {parts.map(part => (
          <li key={part.key} className='flex items-center gap-1.5'>
            <span
              aria-hidden='true'
              className={`h-2 w-2 rounded-full ${part.color} ${part.key === 'other' ? 'ring-1 ring-slate-300' : ''}`}
            />
            {part.text} {split[part.key]}
          </li>
        ))}
      </ul>
    </div>
  )
}
