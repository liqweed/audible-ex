# Product requirements — audible-ex

Status: 2026-10-29. How it is built: [ARCHITECTURE.md](ARCHITECTURE.md). When:
[PLAN.md](PLAN.md). Terms: [GLOSSARY.md](../GLOSSARY.md).

## Summary

audible-ex is a browser extension for Audible. On every book card it shows the
book's Goodreads rating, number of ratings, first-published year and top genres,
with the Goodreads overview on hover. A floating panel shows how far the lookups
have got and holds personal filters (minimum rating, minimum number of ratings,
hidden genres, first-published year, maximum public price) that hide or dim the books that don't
qualify. Filters persist and follow the user across devices and Audible
regions.

It grows out of a userscript (`reference/audible-goodreads-ratings.user.js`)
that already does the rating part and is in daily use.

## Problem

Audible's own star ratings are inflated and say little about the book itself
(narration, production and the book are mixed together). Goodreads has larger,
book-focused rating counts, but checking it means leaving Audible for every
title. On a deals page with 60 books, that's an evening's work, so most of the
catalogue goes unchecked.

## Users

- **The discerning listener** (primary). Has a subscription, listens to 2–4
  books a month, wants to skip the weak ones quickly. Browses deals, search
  results and the wish list.
- **The library curator.** Has hundreds of books in Library and Wish List and
  wants to see which to listen to next.
- **The international user.** Uses more than one Audible marketplace, or one
  outside the US, and wants the same experience everywhere.

## Requirements

### R1 — Ratings on cards (phase 1)

- Every book card on search, category, deals, home (daily deal), library,
  collections and wish list pages gets a badge: `★ 4.21 (12k)`.
- The badge links to the matched Goodreads book. An approximate match (author
  matched, title only roughly) is marked `?`.
- Colour: high (≥ 4.2), neutral, low (< 3.7), matching the userscript.
- After the badge: first-published year and up to 3 genres (labels).
- Hover shows the Goodreads overview (up to 600 characters) with genres, year
  and rating count.
- A book Goodreads doesn't have shows "GR: not found", linking to a Goodreads
  search. A book it has but nobody has rated yet shows "GR: no ratings yet",
  linking to the book. A lookup that failed shows "GR: retry".
- Cards load as they scroll near the viewport; nothing is looked up for cards
  the user never sees.
- All 10 marketplaces: `.com .co.uk .ca .com.au .in .de .fr .it .es .co.jp`.
  Matching is best for English titles; other languages are best effort.

### R2 — Floating panel and progress (phase 2)

- A panel on Audible pages, isolated from the page's styles.
- Progress for the current tab: a bar and counts (looked up / total, from
  cache, not found, failed), a "paused — Goodreads is rate limiting (12 s)"
  state, "Retry" for the failed lookups, and a distinct "Goodreads changed its page format"
  error.
- The panel can be dragged to a corner, collapsed to a small pill (`34/60`) or
  hidden on a site; its placement survives reloads. A hidden panel comes back
  from the toolbar popup.
- The pill also shows whether filtering is on, turns it on or off, and says how
  many books the filters hide or dim on the page.
- The panel opens the options page (a settings button in its header).
- Explanations of the filter settings sit behind an `i` button, shown on hover
  or focus, so the panel stays short.

### R3 — Filters (phase 3)

- Minimum rating slider, default **4.0**, 3.0–5.0 in steps of 0.1.
- Minimum number of ratings, default **50** (0 turns it off).
- Hidden labels: hide books carrying any of the chosen Goodreads genres, picked
  with autocomplete from genres already seen.
- What happens to a book that fails a filter, chosen for each filter (rating,
  number of ratings, labels, year, price): hidden (default) or dimmed. A book
  failing several filters is hidden if any of them hides. Books in carousels
  are always dimmed, never removed.
- Highlighted labels (areas of interest): books carrying any of the chosen
  Goodreads genres get a soft glow around their cover and their label is marked. Highlighting
  never hides a book and works with filtering off. A label is hidden or
  highlighted, not both; the label popover offers either.
- Books not found on Goodreads: shown (default), dimmed or hidden.
- A book is never hidden for data that hasn't loaded. Each filter applies as
  soon as its data has: the price (from Audible) before the rating, the rating
  before the genres and year.
- Eager filtering: no more is fetched for a book a hiding filter already
  hides (no Goodreads lookup for a book over the price limit, no book page for
  one under the minimum rating). If it would be seen again (the filter is
  turned off or set to dim, the filters are switched off, or the user peeks),
  the rest of its lookup follows. Dimmed books and books in carousels are
  looked up in full.
- A counter, `12 hidden · Show`, reveals hidden books (dimmed) without changing
  the filters. It counts the books that are hidden, not those dimmed in carousels.
- A master switch turns filtering off.
- Filters are saved in browser sync storage: they persist across restarts,
  follow the user's Chrome profile to other devices, apply on every
  marketplace, and update open tabs at once.
- First-published year range: optional, inclusive lower and upper bounds; blank
  means no bound. Negative years represent BCE. Missing years stay visible
  unless another filter applies, including while details are still loading.
  Invalid years or reversed ranges are not saved.
- Maximum public cash price per marketplace, in its own currency: an optional
  inclusive ceiling. Blank turns it off; 0 means free only. Unknown prices or
  currencies other than the marketplace currency do not fail this filter.
  Public catalogue prices can differ from signed-in member offers; the panel
  explains this. A book not on Goodreads over the limit gets the stricter of
  the price filter and the not-found policy.

### R4 — Popup and options (phases 1 and 4)

- Popup: turn the extension on or off, show the panel, cache size, clear the
  cache (keeping or including Library/Wish List books).
- Options page: every setting; display controls for label count (0–10), year
  and overview; reset to defaults; export and import settings as versioned JSON.
  Save validates the draft and preserves unrelated edits from other tabs.
  Import and reset are confirmed before replacement; backups contain prefs only,
  never cached book data or device-local panel placement. Display changes apply
  to open Audible tabs without another lookup.
- Cache inspector: search cached books by title, author or ASIN, sort by rating or
  saved time, delete individual books and correct a wrong match with an HTTPS
  Goodreads book URL. Corrections are verified through the shared queue and kept
  across expiry and cleanup; delete-book or clear-all removes them. Reload Audible
  to see a change. No cached ratings are exported.

### R5 — Respectful data use (all phases)

- Lookups are cached: found books for 30 days, not-found for 7 days. Books
  seen in Library or Wish List are kept for 180 days after last seen.
- At most 3 Goodreads requests at a time with a pause between them, one queue
  shared by every open Audible tab. When Goodreads answers "too many
  requests", all lookups pause and back off.
- Every rating links back to Goodreads.
- No rating data is exported or shared.

## Privacy

- No server, no account, no analytics, no telemetry.
- The extension reads Audible pages, including Library and Wish List, to find
  the books on them. It sends each book's title and author to Goodreads to
  look the book up, and book IDs to Audible's catalogue API to get the title
  and author. Nothing else leaves the browser.
- Settings sync through the browser's own sync storage; the cache stays on
  the device.

## Out of scope for v1

- Other rating sources (Hardcover is next; see PLAN.md "Later").
- Series detection and order.
- Duration and narrator filters.
- Rating distribution histograms.
- Recommendations, AI features, cross-region price comparison.

## Constraints

- **Terms of service.** Goodreads has no public API for new developers; the
  extension reads its public search and book pages. Audible's catalogue API is
  undocumented. Both belong to Amazon, which could object. The extension is
  therefore free, has no server, rate-limits itself, links back, and stores
  nothing beyond the cache. If asked to stop, we comply.
- **Trademarks.** The name and icon don't use Audible, Amazon or Goodreads
  logos or trade dress; the listing and the options page say the extension is
  not affiliated with them.
- **Store policy.** Chrome Web Store: one clear purpose, narrow permissions
  with a justification for each, a privacy policy, no remote code.

## Success measures

There is no analytics, so these are checked by hand.

- On the six fixture page types, every card gets a badge, and badges never
  break Audible's layout.
- On a sample of 100 books from deals and search, at least 95 match the right
  Goodreads book and no more than 2 match a wrong one.
- A 60-book deals page with an empty cache finishes its lookups in under a
  minute; with a warm cache, badges appear as cards scroll into view.
- Filtering never hides a book whose data hasn't loaded, and never breaks a
  carousel.
- Store rating of 4.5 or more once published; reported breakages fixed within
  a week.

## Releases

| Release | Contents                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------- |
| 0.1     | R1 and the popup (parity with the userscript); Chrome Web Store, unlisted, public after a week |
| 0.2     | R2 floating panel and progress                                                                 |
| 0.3     | R3 rating, count and label filters                                                             |
| 0.4     | R3 price and year; R4 options page                                                             |
| 1.0     | Everything above, stable                                                                       |
| Later   | Hardcover, series, duration and narrator filters                                               |

## Risks

| Risk                                               | Impact | Response                                                                                    |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Amazon/Goodreads object to the extension           | High   | Constraints above; comply if asked; the userscript remains for personal use                 |
| Goodreads changes or blocks its search or pages    | High   | Visible "format changed" error, fixture tests for a quick fix, Hardcover as a second source |
| Audible changes its markup                         | Medium | Card detection by structure (links to one book), fixture tests per page type                |
| Wrong matches (summaries, editions, common titles) | Medium | Matching rules from the userscript, approximate-match marker, manual correction in options  |
| Non-English titles match poorly                    | Low    | Labelled best effort; improve with fixtures from those marketplaces                         |
