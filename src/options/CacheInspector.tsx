import {
  type ColumnDef,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { goodreadsBookId } from '@/core/goodreads-url'
import type { CachedBook } from '@/schema/inspector'
import { type CacheBackend, cacheBackend } from './cache-backend'

const button =
  'rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50'
const columns: ColumnDef<CachedBook>[] = [
  { accessorKey: 'title' },
  { id: 'rating', accessorFn: book => book.rating?.r, sortUndefined: 'last' },
  { accessorKey: 'savedAt' },
]
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function CacheInspector({
  backend = cacheBackend,
  onChange,
}: {
  backend?: CacheBackend
  /** Called after a book was deleted or corrected, so a summary of the cache can read it again. */
  onChange?: () => void
}) {
  const [books, setBooks] = useState<readonly CachedBook[]>([])
  const [query, setQuery] = useState('')
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'savedAt', desc: true },
  ])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<CachedBook>()
  const [url, setUrl] = useState('')
  const scroll = useRef<HTMLElement>(null)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    setError('')
    try {
      const next = await backend.list()
      if (current === generation.current) setBooks(next)
    } catch (e) {
      if (current === generation.current)
        setError(`Could not read cached books: ${messageOf(e)}`)
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [backend])
  useEffect(() => {
    void refresh()
    return () => {
      generation.current++
    }
  }, [refresh])
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return books.filter(b =>
      `${b.title} ${b.author} ${b.asin}`.toLocaleLowerCase().includes(term)
    )
  }, [books, query])
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: b => b.asin,
  })
  const rows = table.getRowModel().rows
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 100,
    overscan: 5,
    getItemKey: index => rows[index]?.id ?? index,
  })

  async function change(action: () => Promise<void>, success: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setSelected(undefined)
      setMessage(success)
      onChange?.()
      await refresh()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-labelledby='cache-heading' className='options-section'>
      <h2 id='cache-heading'>Cached books</h2>
      <p className='options-hint'>
        Stored on this device, including expired entries. Manual matches survive
        automatic cleanup and clearing unpinned books. Reload Audible after a
        change. A lookup already in progress can cache a deleted book again.
      </p>
      <div className='flex flex-wrap items-end gap-3'>
        <label className='min-w-48 flex-1 text-sm'>
          Search title, author or ASIN
          <input
            type='search'
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              if (scroll.current) scroll.current.scrollTop = 0
            }}
            className='mt-1 w-full rounded-md border border-slate-300 px-3 py-2'
          />
        </label>
        <label className='text-sm'>
          Sort cached books
          <select
            className='ml-2 rounded-md border border-slate-300 p-2'
            value={`${sorting[0]?.id}:${sorting[0]?.desc}`}
            onChange={e => {
              if (scroll.current) scroll.current.scrollTop = 0
              const [id, desc] = e.target.value.split(':')
              setSorting([{ id: id ?? 'savedAt', desc: desc === 'true' }])
            }}
          >
            <option value='savedAt:true'>Newest saved</option>
            <option value='savedAt:false'>Oldest saved</option>
            <option value='rating:true'>Highest rating</option>
            <option value='rating:false'>Lowest rating</option>
            <option value='title:false'>Title A–Z</option>
          </select>
        </label>
        <button
          type='button'
          className={button}
          disabled={busy || loading}
          onClick={() => {
            void refresh()
          }}
        >
          Refresh cache
        </button>
      </div>
      {loading && <p role='status'>Loading cached books…</p>}
      {!loading && (
        <p className='options-hint'>
          {rows.length} of {books.length} cached books
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <p>
          {books.length
            ? 'No cached books match your search.'
            : 'No cached books yet. Browse Audible to look up books.'}
        </p>
      )}
      <section
        ref={scroll}
        className='cache-scroll'
        hidden={rows.length === 0}
        aria-label='Cached book results'
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll through virtualized results.
        tabIndex={0}
      >
        <ul
          aria-label='Cached books'
          style={{ height: virtual.getTotalSize(), position: 'relative' }}
        >
          {virtual.getVirtualItems().map(item => {
            const book = rows[item.index]?.original
            if (!book) return null
            return (
              <li
                key={book.asin}
                className='cache-row'
                style={{
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <div className='min-w-0 flex-1'>
                  <p
                    className='truncate text-sm font-medium'
                    title={book.title}
                  >
                    {book.title}
                  </p>
                  <p className='truncate text-xs text-slate-500'>
                    {book.author} · {book.asin}
                  </p>
                  <p className='text-xs text-slate-500'>
                    {book.rating
                      ? `★ ${book.rating.r.toFixed(2)} (${book.rating.n.toLocaleString()} ratings)`
                      : 'No cached rating'}
                    {book.manual && ' · Manual match'}
                    {book.pinned && ' · Library / Wish List'}
                  </p>
                  <p className='text-xs text-slate-500'>
                    Saved {new Date(book.savedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className='flex shrink-0 items-center gap-2'>
                  {book.bookId && (
                    <a
                      className='text-xs text-indigo-700 underline'
                      href={`https://www.goodreads.com/book/show/${book.bookId}`}
                      target='_blank'
                      rel='noreferrer'
                    >
                      Goodreads
                    </a>
                  )}
                  <button
                    type='button'
                    className={button}
                    disabled={busy}
                    aria-label={`Manage ${book.title}`}
                    onClick={() => {
                      setSelected(book)
                      setUrl(
                        book.bookId
                          ? `https://www.goodreads.com/book/show/${book.bookId}`
                          : ''
                      )
                      setError('')
                      setMessage('')
                    }}
                  >
                    Manage
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
      {selected && (
        <form
          onSubmit={e => {
            e.preventDefault()
            try {
              goodreadsBookId(url)
            } catch (e) {
              setError(messageOf(e))
              return
            }
            void change(
              () => backend.correct(selected.asin, url),
              'Manual match saved. Reload Audible to see it.'
            )
          }}
          className='space-y-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4'
        >
          <p className='text-sm font-medium'>Manage {selected.title}</p>
          <label className='block text-sm'>
            Correct Goodreads URL
            <input
              type='url'
              maxLength={2048}
              required
              value={url}
              disabled={busy}
              onChange={e => setUrl(e.target.value)}
              className='mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2'
            />
          </label>
          <p className='options-hint'>
            Paste the correct book page. Saving waits for Goodreads verification
            through the shared lookup queue. Deleting also removes this book’s
            manual match and Library / Wish List pin.
          </p>
          <div className='flex flex-wrap gap-3'>
            <button type='submit' disabled={busy} className={button}>
              {busy ? 'Working…' : 'Save manual match'}
            </button>
            <button
              type='button'
              disabled={busy}
              className={`${button} text-red-700`}
              onClick={() => {
                void change(
                  () => backend.deleteBook(selected.asin),
                  'Cached book deleted.'
                )
              }}
            >
              Delete cached book
            </button>
            <button
              type='button'
              disabled={busy}
              className={button}
              onClick={() => setSelected(undefined)}
            >
              Cancel
            </button>
          </div>
        </form>
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
    </section>
  )
}
