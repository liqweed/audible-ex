import type { BookView } from '@/content/books'

/** The genres the books on this page carry, the most common first, for the label picker's suggestions. */
export function genresSeen(books: ReadonlyMap<string, BookView>): string[] {
  const counts = new Map<string, number>()
  for (const view of books.values()) {
    for (const genre of view.details?.genres ?? []) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1)
    }
  }
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([genre]) => genre)
}

/**
 * Suggestions for what the user has typed: seen genres that contain it, without regard to case,
 * leaving out the ones already hidden. With nothing typed, the most common ones.
 */
export function suggestions(
  seen: readonly string[],
  hidden: readonly string[],
  typed: string,
  limit = 6
): string[] {
  const taken = new Set(hidden.map(h => h.trim().toLowerCase()))
  const needle = typed.trim().toLowerCase()
  return seen
    .filter(
      genre =>
        !taken.has(genre.toLowerCase()) && genre.toLowerCase().includes(needle)
    )
    .slice(0, limit)
}
