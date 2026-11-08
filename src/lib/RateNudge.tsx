import { REVIEW_STORE, REVIEW_URL } from './links'

const STYLES = {
  // The panel draws in its own shadow root, on white, in plain slate and indigo.
  panel: {
    box: 'mt-3 space-y-1.5 border-t border-slate-200 pt-2 text-xs text-slate-700',
    link: 'font-medium text-indigo-700 underline hover:text-indigo-900',
    dismiss: 'text-slate-600 underline hover:text-slate-900',
  },
  // The popup uses the theme's tokens.
  popup: {
    box: 'space-y-1.5 rounded-md border border-border p-3 text-sm',
    link: 'font-medium underline',
    dismiss: 'text-muted-foreground underline',
  },
} as const

/**
 * The one request to rate the extension (DECISIONS.md D32): a sentence, a link to the store's
 * reviews, and a way to say "not now". Either one ends it; it is not shown again. It asks for a
 * rating, not a good one, and offers nothing in return.
 */
export function RateNudge({
  variant,
  close,
}: {
  variant: keyof typeof STYLES
  close: () => void
}) {
  const style = STYLES[variant]
  return (
    <section aria-label='Rate this extension' className={style.box}>
      <p>
        Finding Book Ratings for Audible useful? A rating helps other listeners
        find it.
      </p>
      <p className='flex gap-3'>
        <a
          href={REVIEW_URL}
          target='_blank'
          rel='noreferrer'
          aria-label={`Rate it on ${REVIEW_STORE}`}
          onClick={close}
          className={style.link}
        >
          Rate it
        </a>
        <button type='button' onClick={close} className={style.dismiss}>
          Not now
        </button>
      </p>
    </section>
  )
}
