import { describe, expect, test } from 'bun:test'
import { lastName, norm, shortTitle } from '@/core/text'

// Every expected value below was produced by running the userscript's own `norm`, `shortTitle` and
// `lastName` (reference/audible-goodreads-ratings.user.js v2.4.0, L242-245, copied verbatim into a
// throwaway script) on the input beside it. They pin the userscript's behaviour, quirks included;
// none comes from this module.

describe('norm', () => {
  const cases: readonly (readonly [input: string, expected: string])[] = [
    ['1984', '1984'],
    ['Thinking, Fast and Slow', 'thinking fast and slow'],
    ['  Spaced   out \t title ', 'spaced out title'],
    [
      'Rich Dad Poor Dad: 20th Anniversary Edition',
      'rich dad poor dad 20th anniversary edition',
    ],
    // Punctuation becomes a space, so `F*ck` is two tokens on both sides of a comparison.
    [
      'The Subtle Art of Not Giving a F*ck',
      'the subtle art of not giving a f ck',
    ],
    [
      "Harry Potter and the Sorcerer's Stone, Book 1",
      'harry potter and the sorcerer s stone book 1',
    ],
    // Series markers in brackets are dropped, non-greedy: `(b (c) d)` ends at the first `)`.
    ['Dune (Dune, #1)', 'dune'],
    ['Fantine [Les Misérables, #1]', 'fantine'],
    ['A (b) c [d] e', 'a c e'],
    ['A (b (c) d) e', 'a d e'],
    ['a(b', 'a b'],
    ['(only parenthetical)', ''],
    // Diacritics: NFKD splits them off and the combining marks are removed.
    ['Les Misérables', 'les miserables'],
    ['LES MISÉRABLES', 'les miserables'],
    ['Les Misérables', 'les miserables'], // already decomposed
    ['Naïve café', 'naive cafe'],
    ['Ångström', 'angstrom'],
    // Compatibility forms fold to ASCII; letters with no decomposition are dropped, not folded.
    ['ﬁne ﬂow', 'fine flow'],
    ['Ⅳ', 'iv'],
    ['①②', '12'],
    ['Æsop & Sons', 'sop sons'],
    ['Ørsted', 'rsted'],
    ['ß', ''],
    ['İstanbul', 'istanbul'],
    // Anything outside a-z and 0-9 is gone, so a non-Latin title normalises to nothing.
    ['日本語', ''],
    ['!!!', ''],
    ['', ''],
    ['   ', ''],
  ]
  test.each(cases)('norm(%j) is %j', (input, expected) => {
    expect(norm(input)).toBe(expected)
  })

  test('treats missing input as the empty string (the userscript\'s `s || ""`)', () => {
    expect(norm(undefined)).toBe('')
    expect(norm(null)).toBe('')
  })

  test('is idempotent', () => {
    for (const [input] of cases) expect(norm(norm(input))).toBe(norm(input))
  })
})

describe('shortTitle', () => {
  const cases: readonly (readonly [input: string, expected: string])[] = [
    // The subtitle is everything after the first `:`, en dash, em dash or spaced hyphen.
    ['Dune: Book One in the Dune Chronicles', 'dune'],
    ['Sapiens: A Brief History of Humankind', 'sapiens'],
    ['Title: A: B', 'title'],
    ['The Hobbit – Or There and Back Again', 'the hobbit'], // en dash
    ['Title — Subtitle', 'title'], // em dash
    ['Title - Subtitle', 'title'], // spaced hyphen
    ['Title – a – b', 'title'],
    ['A  -  B', 'a'],
    // A hyphen without a space on both sides is not a subtitle separator.
    ['Title-with-hyphen', 'title with hyphen'],
    ['A -B', 'a b'],
    ['A- B', 'a b'],
    // No separator: the whole title, normalised. A comma is not a separator.
    ['Thinking, Fast and Slow', 'thinking fast and slow'],
    ['1984', '1984'],
    ['Les Misérables', 'les miserables'],
    [
      "Harry Potter and the Sorcerer's Stone, Book 1",
      'harry potter and the sorcerer s stone book 1',
    ],
    ['Rich Dad Poor Dad: 20th Anniversary Edition', 'rich dad poor dad'],
    [
      'The Subtle Art of Not Giving a F*ck: A Counterintuitive Approach to Living a Good Life',
      'the subtle art of not giving a f ck',
    ],
    // Narration labels are removed as whole words, in any case, wherever they sit before the split.
    ['The Stand (Unabridged)', 'the stand'],
    ['The Stand (ABRIDGED)', 'the stand'],
    ['Foundation unabridged', 'foundation'],
    ['Foundation Unabridged - Part 1', 'foundation'],
    ['dRaMaTiZeD Hobbit', 'hobbit'],
    ['Dramatised Edition', 'edition'],
    ['The War of the Worlds [Dramatised]', 'the war of the worlds'],
    ['Title (Unabridged): Sub', 'title'],
    ['Abridged Classics: Vol 1', 'classics'],
    // Only whole words: longer words that merely start with a label stay.
    ['Unabridgedness', 'unabridgedness'],
    ['Abridgement', 'abridgement'],
    // Quirks: a label before the first separator can empty the title, as can a leading separator.
    ['Unabridged', ''],
    ['Dramatized', ''],
    ['Dramatized: The War of the Worlds', ''],
    [': leading colon', ''],
    ['', ''],
  ]
  test.each(cases)('shortTitle(%j) is %j', (input, expected) => {
    expect(shortTitle(input)).toBe(expected)
  })

  test('a title is its own short title once the subtitle and labels are gone', () => {
    expect(shortTitle('Atomic Habits: Tiny Changes, Remarkable Results')).toBe(
      shortTitle('Atomic Habits (Unabridged)')
    )
  })
})

describe('lastName', () => {
  const cases: readonly (readonly [input: string, expected: string])[] = [
    ['Andy Weir', 'weir'],
    ['Yuval Noah Harari', 'harari'],
    ['J.K. Rowling', 'rowling'],
    // Initials: the dots become spaces and the last token is still the surname.
    ['J.R.R. Tolkien', 'tolkien'],
    ['Robert T. Kiyosaki', 'kiyosaki'],
    ['Ursula K. Le Guin', 'guin'],
    ['Cher', 'cher'],
    ['Tara Westover ', 'westover'],
    ['Annie  Hartnett', 'hartnett'],
    ['Madonna.', 'madonna'],
    ['Hugo (Victor)', 'hugo'],
    ['Gabriel García Márquez', 'marquez'],
    ['Jean-Paul Sartre', 'sartre'],
    ["O'Brien", 'brien'],
    // Quirks kept as they are: a suffix is the last token, and "Surname, Initials" ends on an initial.
    ['Martin Luther King Jr.', 'jr'],
    ['Tolkien, J.R.R.', 'r'],
    // Nothing usable in the name gives the empty string, which turns the author check off.
    ['', ''],
    ['   ', ''],
    ['...', ''],
    ['村上春樹', ''],
  ]
  test.each(cases)('lastName(%j) is %j', (input, expected) => {
    expect(lastName(input)).toBe(expected)
  })

  test('treats missing input as no author', () => {
    expect(lastName(undefined)).toBe('')
    expect(lastName(null)).toBe('')
  })
})
