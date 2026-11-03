---
release: minor
---

### Added

- A small panel at the bottom right of Audible pages shows how far the rating
  lookups are: a bar and counts such as `34/60 · 18 cached · 2 not found ·
  1 failed`. When Goodreads is rate limiting it says so with a countdown, a
  "Retry failed" button looks failed books up again, and a message tells you if
  Goodreads has changed its pages so that ratings cannot be read. The panel
  appears once a page has books to look up and is drawn apart from Audible's own
  styles.
