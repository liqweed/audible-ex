---
release: patch
---

### Changed

- Internal: the background worker now looks books up for every open Audible tab
  through one shared queue (at most 3 Goodreads requests at a time, a pause
  between them, a longer pause when Goodreads asks to slow down, and a stop
  after repeated failures). Nothing changes on Audible pages yet.
