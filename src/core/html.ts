/**
 * The overview text of a Goodreads book, from the HTML Goodreads sends (the userscript's
 * `htmlToText`). Pure TS, no DOM: the background worker has no `DOMParser`, so the tags are
 * stripped and the entities decoded by hand. Goodreads descriptions use `<br />`, `<p>`, `<i>`,
 * `<b>` and a handful of entities, nothing more.
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
}

/** One pass over the text, so `&amp;lt;` becomes `&lt;` and not `<`. Unknown entities stay as written. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g,
    (entity, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined) return NAMED_ENTITIES[name] ?? entity
      const code =
        decimal !== undefined ? Number(decimal) : parseInt(hex ?? '', 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    }
  )
}

/**
 * Plain text from `html`: `<br>` becomes a line break, `</p>` a blank line, every other tag is
 * dropped, entities are decoded, and runs of three or more line breaks shrink to two. Missing input
 * is the empty string.
 */
export function htmlToText(html: string | null | undefined): string {
  return decodeEntities(
    (html ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * `text` cut to at most `max` UTF-16 code units, the way the overview is capped, without leaving
 * half of a surrogate pair at the end.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}
