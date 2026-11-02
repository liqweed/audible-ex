/** `812 B`, `34 KB`, `1.3 MB`: the cache size the way the popup writes it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** `1 book`, `12 books`. */
export const books = (n: number): string => `${n} ${n === 1 ? 'book' : 'books'}`
