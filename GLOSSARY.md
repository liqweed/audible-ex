# Glossary

The words this repository uses, in code, docs, issues and UI text. Use the
term; avoid the listed aliases.

| Term                 | Meaning                                                                                                               | Avoid                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **ASIN**             | Amazon's 10-character product ID, read from `/pd/…/<ASIN>` links. The key for a book on Audible.                      | product id, SKU, ISBN (different thing)  |
| **Marketplace**      | One Audible site, such as `audible.co.uk`. Each has a **region** code (`UK`) in `src/core/regions.ts`.                | domain, store, locale                    |
| **Card**             | The page element that shows one book: the largest ancestor whose links all point to one ASIN.                         | tile, item, row (except library rows)    |
| **Carousel**         | A horizontally scrolling row of cards. Cards in a carousel are dimmed, never hidden.                                  | slider, shelf                            |
| **Badge**            | The `★ 4.21 (12k)` link we add to a card, pointing at the matched Goodreads book.                                     | chip, pill, tag                          |
| **Label**            | A Goodreads genre shown after the badge and used by the hidden-labels filter.                                         | tag, shelf, category                     |
| **Overview**         | The Goodreads book description, shown on hover, capped at 600 characters.                                             | summary, blurb, synopsis                 |
| **Lookup**           | Finding a book's Goodreads match and rating: Audible catalogue metadata, then Goodreads autocomplete.                 | scrape, fetch, query                     |
| **Details**          | Genres, overview and first-published year, from the Goodreads book page. Fetched after the rating, at lower priority. | metadata (that's Audible's title/author) |
| **Metadata**         | Title and first author of an ASIN, from Audible's catalogue API.                                                      | details                                  |
| **Match**            | The Goodreads book chosen for an ASIN. **Approximate match**: author matched, title only roughly; shown with `?`.     | hit (outside the cache)                  |
| **Miss** / not found | Goodreads has no acceptable match. A normal result, cached for 7 days; not an error.                                  | failure, error                           |
| **Failed**           | A lookup that errored (network, rate limit, format change). Never cached; can be retried.                             | miss, not found                          |
| **Pin**              | A book seen in Library or Wish List; its cache entries are kept 180 days after it was last seen.                      | favourite, bookmark                      |
| **Prefs**            | The user's settings, stored in `storage.sync` as `sync:prefs`.                                                        | config, options (the page is "options")  |
| **Filter**           | One rule in prefs that can hide or dim a card: minimum rating, minimum ratings, hidden labels, price, year.           | rule, criterion                          |
| **Highlight**        | A label the user is interested in, or a rating they count as good: the covers of books carrying either glow. Never hides or dims a card. | favourite, interest, tag                 |
| **Miss mode**        | What a book that fails one filter gets: `hide` or `dim`. Each filter has its own (`modes` in prefs).                  | filter mode, action                      |
| **Verdict**          | The filter result for one card: `show`, `dim` or `hide`.                                                              | status (that's the lookup's state)       |
| **Peek**             | Temporarily revealing hidden cards (dimmed) without changing prefs.                                                   | show all, reveal mode                    |
| **Eager filtering**  | Fetching no more for a book a `hide` filter already hides; such a book is **held** until it would be seen again.      | lazy loading, skipping                   |
| **Panel**            | The floating React UI on Audible pages, in a shadow root.                                                             | overlay, widget, sidebar                 |
| **Progress**         | Per-tab lookup counters the background sends to the panel.                                                            | status, stats                            |
| **Background**       | The MV3 service worker that owns network access, the queue and the cache.                                             | server, backend                          |
| **Port**             | The long-lived `runtime.Port` between a tab's content script and the background.                                      | channel, socket                          |
| **Fixture**          | A saved Audible page or Goodreads response under `test/fixtures/`, refreshed with `scripts/capture-fixtures.ts`.      | mock data, snapshot                      |
| **Userscript**       | `reference/audible-goodreads-ratings.user.js`, the behaviour reference this extension ports.                          | old version, prototype                   |
