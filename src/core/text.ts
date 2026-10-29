/**
 * Title and author normalisation for matching Audible books to Goodreads books, ported from the
 * userscript (`norm`, `shortTitle`, `lastName`, v2.4.0). Pure TS, no DOM, no Effect. The userscript
 * is the reference: change these only with a fixture for the book that motivated it.
 */

/**
 * Comparable form of a title or name: lower case, accents removed, bracketed text (series markers
 * such as `(Dune, #1)`) dropped, everything but `a-z`, `0-9` and single spaces gone. Missing input
 * is the empty string. Letters without a decomposition (`ø`, `ß`, `æ`) and non-Latin scripts are
 * dropped, as in the userscript.
 */
export function norm(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The normalised title before its subtitle (the first `:`, en dash, em dash or ` - `), with
 * `unabridged`, `abridged` and `dramatized`/`dramatised` removed as whole words. Goodreads lists
 * `Dune` where Audible says `Dune: Book One in the Dune Chronicles`; this is what the two are
 * compared on.
 */
export function shortTitle(title: string): string {
  return norm(
    (title.split(/[:–—]| - /)[0] ?? '').replace(
      /\b(unabridged|abridged|dramati[sz]ed)\b/gi,
      ''
    )
  )
}

/**
 * The last word of the normalised author name, or `''` when nothing usable is left (which turns the
 * author check off). `J.R.R. Tolkien` gives `tolkien`; `Tolkien, J.R.R.` gives `r`, as in the
 * userscript.
 */
export function lastName(author: string | null | undefined): string {
  return norm(author).split(' ').pop() || ''
}
