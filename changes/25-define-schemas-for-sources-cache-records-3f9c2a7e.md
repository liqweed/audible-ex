---
release: patch
---

### Changed

- Internal: the extension now checks what it reads from Goodreads and Audible,
  and the messages between a page and the background, against written
  definitions, so a change in Goodreads' format is reported as such and not
  shown as a wrong rating. Nothing changes on Audible pages yet.
