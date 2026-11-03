/** Accept only Goodreads book pages; requests are rebuilt from the numeric id. */
export function goodreadsBookId(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Paste an HTTPS Goodreads book URL.')
  }
  const id = /^\/book\/show\/(\d+)(?:[.-][^/]*)?\/?$/.exec(url.pathname)?.[1]
  if (
    url.protocol !== 'https:' ||
    !['www.goodreads.com', 'goodreads.com'].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !id
  )
    throw new Error('Paste an HTTPS Goodreads book URL.')
  return id
}
