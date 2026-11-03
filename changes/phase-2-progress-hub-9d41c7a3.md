---
release: patch
---

### Changed

- Internal: the background worker now tells each Audible tab how many of its
  lookups are waiting, running, done, cached, not found or failed, and when
  Goodreads has paused them. Nothing shows it yet; the floating panel will.
