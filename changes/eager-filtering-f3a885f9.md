---
release: minor
---

### Changed

- Eager filtering: the extension no longer looks up what the filters already hide. A book over your price limit is hidden as soon as its price is known and is not looked up on Goodreads; a book under your minimum rating or number of ratings gets no Goodreads book page. This only applies to filters set to hide: dimmed books and books in carousels are looked up in full. If a held-back book would show again (you turn its filter off, set it to dim, or use Show), its lookup carries on.
- The price limit now also applies to books not found on Goodreads: such a book gets the stricter of the price limit and the not-found setting.
