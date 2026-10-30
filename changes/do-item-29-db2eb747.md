---
release: minor
---

### Added

- Audible book cards now show a Goodreads badge after the title, such as
  `★ 4.21 (12k)`: green for 4.2 and above, red below 3.7, and a `?` after the
  rating when the Goodreads match is approximate. The badge links to the book on
  Goodreads and is followed by the year it was first published and up to three
  genre labels. It appears on search results, categories, deals, the home page
  (including the cards in hover popovers), the Library and the Wish List, and
  on books that load as you scroll. Books are looked up as they come within a
  screen of view.
- A book with no confident Goodreads match shows `GR: not found`, linking to a
  Goodreads search for its title. If a lookup fails, the badge shows `GR: retry`
  and clicking it tries again. Books in your Library and Wish List are kept
  longer in the local cache than books you only browse. The hover overview,
  filters and the progress panel are not there yet.
