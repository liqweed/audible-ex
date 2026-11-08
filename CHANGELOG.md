# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-11-08

### Changed

- The settings page is redesigned. It has the logo and, in the Display settings, a preview of one book that follows your choices (labels per book, the year, highlighted and hidden labels, and the overview you see when hovering the rating) before you save. A bar at the bottom of the window with Save and Discard appears as soon as you change something. Labels per book has a slider, and the ratings have − and + buttons (and the arrow keys). Hidden and highlighted labels have a field that suggests the genres of the books you have looked at, with the labels as pills below that you click to remove. What happens to a book that fails each filter is a list of Hide or Dim switches. The first-published year range moved to the end of the filters and reads as one range. The maximum and highlight prices share one table with currency signs and links to each Audible marketplace. Tab goes from field to field. The links to the GitHub repository and the Chrome Web Store page are at the bottom.
- The settings page and the popup show how much is cached as a small bar: books from your Library, from your Wish List, and all the others. The popup has the logo too. Books already cached from your lists are sorted into Library or Wish List the next time you open those pages.
- The popup has a button below the clearing buttons that opens the settings page at its cache overview.

## [0.8.0] - 2026-11-05

### Added

- Highlight price: choose a price for your marketplace and every book that costs that much or less shows its price as an amber chip beside the Goodreads rating. Set it in the panel's filter settings (below the highlight rating) or on the options page, one per marketplace; blank turns it off, which is the default. It is separate from the maximum price: it never hides or dims a book, leaves the cover alone, works with filtering off and applies on every page. Prices are the public catalogue prices, so member offers can differ.
- Price limit on deals pages only: tick "Only on deals pages" under the maximum price in the panel (or on the options page) and the limit applies on deals pages alone, so search, categories and your library are not filtered by price. A page counts as a deals page when its address contains "deals", like /ep/audiobook-deals.

### Changed

- A highlighted book that a filter only dims, for instance one over your price limit, is now drawn at full strength with its amber outline instead of faded, so a book you are interested in stands out. Books a filter hides stay hidden: set a filter to Dim rather than Hide to let highlights through.

### Fixed

- The book on an Audible product page (/pd/…) now gets its Goodreads rating, genres and highlight like the books in lists; before, the page showed nothing for the book it was about. That book is never hidden or dimmed by your filters.

## [0.7.0] - 2026-11-05

### Added

- Highlight rating: choose a Goodreads rating from 1 to 5 and every book rated at least that gets the same amber outline as your highlighted labels. Set it in the panel's filter settings (below the highlighted labels) or on the options page; blank turns it off, which is the default. Like highlighted labels it never hides or dims a book and works with filtering off.

## [0.6.1] - 2026-11-04

### Changed

- The Firefox build is ready for addons.mozilla.org: it has a permanent add-on ID, needs Firefox 140 or later, and declares in Firefox's install prompt that the titles and authors of the books on Audible pages are sent to Goodreads to look them up. The Chrome extension is unchanged.

## [0.6.0] - 2026-11-04

### Changed

- Eager filtering: the extension no longer looks up what the filters already hide. A book over your price limit is hidden as soon as its price is known and is not looked up on Goodreads; a book under your minimum rating or number of ratings gets no Goodreads book page. This only applies to filters set to hide: dimmed books and books in carousels are looked up in full. If a held-back book would show again (you turn its filter off, set it to dim, or use Show), its lookup carries on.
- The price limit now also applies to books not found on Goodreads: such a book gets the stricter of the price limit and the not-found setting.

## [0.5.1] - 2026-11-04

### Changed

- A book on Goodreads that nobody has rated yet, often one not yet released, shows `GR: no ratings yet` instead of `★ 0.00 (0)`, and its overview says "No ratings yet". The badge still links to the book on Goodreads.

## [0.5.0] - 2026-11-04

### Changed

- Highlighted books are marked by a soft glow around their cover instead of an outline around the whole card.
- The label popover and the rating overview look like the floating panel and show the extension's logo, so it is clear they come from Book Ratings for Audible.
- A genre label's popover offers one choice, Hide, Show or Highlight, with the current one selected and a short explanation behind its ⓘ button.
- Books show up to four genre labels by default instead of three; a count you chose in Settings is kept.

### Fixed

- The panel's title no longer wraps onto two lines while some lookups have failed: "Retry" is now a link beside "Ratings".

## [0.4.0] - 2026-11-04

### Added

- Inspect cached books in Settings: search, sort by rating or saved date, open on Goodreads, delete entries and save a correct Goodreads match that survives automatic cleanup.
- Choose for each filter (rating, number of ratings, labels, year, price) whether failing books are hidden or only dimmed.
- Highlight genres you are interested in: their books get an outline and the label is marked. Add them from the panel or from a label's popover; highlighting never hides a book and works with filtering off.
- The collapsed panel shows whether filtering is on, turns it on or off, and counts the books it hides or dims.
- A settings button in the panel opens the options page.

### Changed

- Clicking outside the expanded panel hides its filter settings and returns it to its normal size.
- The panel's filter settings are more compact: shorter fields, and explanations behind an ⓘ button instead of paragraphs.
- Settings and backups keep your earlier "hide or dim" choice for every filter.

## [0.3.0] - 2026-11-03

### Added

- Filter Audible cards by an inclusive first-published year range in the panel.
  Leave either end blank for no limit, or use negative years for BCE. The range
  syncs across tabs and devices; books with no known year stay visible unless
  another filter applies.
- Set a maximum public price for each Audible marketplace in the panel. Limits
  sync across tabs and devices; blank turns the limit off and 0 means free only.
  Books with no known price stay visible unless another filter applies. Public
  catalogue prices can differ from member offers.
- Open Settings from the popup to edit all preferences, choose the number of
  labels, show or hide the year and hover overview, and reset or back up prefs
  as JSON. Display edits update open Audible tabs; imports are validated and
  confirmed before replacing preferences. Saved drafts preserve unrelated edits
  made in other tabs. Cached books and panel placement are kept on the device.

## [0.2.0] - 2026-11-03

### Added

- A small panel at the bottom right of Audible pages shows how far the rating
  lookups are: a bar and counts such as `34/60 · 18 cached · 2 not found ·
  1 failed`. When Goodreads is rate limiting it says so with a countdown, a
  "Retry failed" button looks failed books up again, and a message tells you if
  Goodreads has changed its pages so that ratings cannot be read. The panel
  appears once a page has books to look up and is drawn apart from Audible's own
  styles.
- The panel can be moved: grab its title (it has a grip and a grab cursor) and
  drag it; dashed markers show the four corners, the nearest one lit, and it
  docks where you let go, remembered on this device. A `–` button collapses it
  to a small pill showing the count (`34/60`); click the pill to open it
  again. A `×` button hides the panel on that Audible site, and the toolbar
  popup shows "Show the panel again" until you bring it back.
- The panel shows the extension's logo, on the pill and in the header, where it
  links to the project page.
- The panel shows both steps of the lookups: the ratings, then a second bar for
  genres, first-published year and overview, which are read from each book's
  Goodreads page after the ratings. The collapsed pill follows the second step
  once all ratings are in.
- Filters. The panel on Audible pages hides books that do not fit what you
  want to read: below a minimum rating (4.0 to start with), with too few
  ratings (50), or carrying a genre you have chosen to hide. Open "Filter
  settings" in the panel to change them; a switch turns filtering off.
  A book is never hidden before its rating has loaded, and in carousels books
  are dimmed instead, so the page keeps its layout. Books that are not on
  Goodreads are shown unless you choose otherwise. "12 hidden · Show" reveals
  the hidden books, dimmed, without changing the filters.
- Hover a genre label under a book's rating (or tab to it and press Enter) to
  hide every book with that genre, or to stop hiding it. Labels you hide are
  struck through, so you can see what is being filtered, and the popover says
  how many books on the page carry the label.
- The settings are saved in your browser's synced storage, so they apply on
  every Audible site and in every open tab at once, and follow your Chrome
  profile to your other devices.

### Changed

- Internal: the page's lookup state now lives in a TanStack Store, ready for the
  floating panel. Badges and the hover overview behave as before.
- Internal: the background worker now tells each Audible tab how many of its
  lookups are waiting, running, done, cached, not found or failed, and when
  Goodreads has paused them. Nothing shows it yet; the floating panel will.
- Settings are stored in a new version that holds the filters. Your on/off
  switch carries over.

### Fixed

- On Library pages the Goodreads rating no longer appears inside the hidden
  Download menu of each book; the badge stays after the title only.

## [0.1.0] - 2026-11-02

### Added

- Audible book cards now show a Goodreads badge after the title, such as `★ 4.21
  (12k)`: green for 4.2 and above, red below 3.7, and a `?` after the rating
  when the Goodreads match is approximate. The badge links to the book on
  Goodreads and is followed by the year it was first published and up to three
  genre labels. It appears on search results, categories, deals, the home page
  (including the cards in hover popovers), the Library and the Wish List, and on
  books that load as you scroll. Books are looked up as they come within a
  screen of view.
- A book with no confident Goodreads match shows `GR: not found`, linking to a
  Goodreads search for its title. If a lookup fails, the badge shows `GR: retry`
  and clicking it tries again. Books in your Library and Wish List are kept
  longer in the local cache than books you only browse. Filters and the progress
  panel come in a later release.
- Hovering a Goodreads badge shows the book's overview: the rating line (rating,
  number of ratings, the year it was first published and whether the match is
  approximate), up to six genres and the Goodreads description, cut at 600
  characters and faded at the end. The box opens below the badge, or above it
  near the bottom of the window, and closes when the pointer leaves or the page
  scrolls. It is drawn apart from Audible's own styles. A book whose details
  have not arrived yet keeps the plain tooltip.
- The toolbar popup has a switch that turns the extension on or off on every
  open Audible tab at once. Off removes the badges and stops looking books up;
  on brings them back, drawn from the cache where the books are already known.
  The setting is kept in your browser account's sync storage, so it follows you
  to your other devices.
- The popup shows how many books are cached, how much space they take and how
  many come from your Library and Wish List. Two buttons empty the cache: one
  keeps the Library and Wish List books, the other (after a confirmation) clears
  everything. They replace the userscript's menu commands.
- The toolbar popup says the extension is not affiliated with Audible, Amazon or
  Goodreads, and links to the privacy policy and the source code.

### Changed

- The extension has its own icon: a gold star inside indigo headphones, with an
  open book at larger sizes, in place of the framework's placeholder.
- The extension runs only on the ten Audible marketplace sites. It asks for
  storage and for access to Goodreads and to Audible's catalogue servers, which
  the rating lookups use.
- Internal: the rules that pick the matching Goodreads book for an Audible title
  are now in the extension, tested against saved Goodreads results.
- Internal: the extension now checks what it reads from Goodreads and Audible,
  and the messages between a page and the background, against written
  definitions, so a change in Goodreads' format is reported as such and not
  shown as a wrong rating.
- Goodreads ratings and book details are remembered on your device, so a book is
  not looked up again each time: found ratings for 30 days, "not found" for 7
  days, and books from your Library and Wish List for up to 180 days after you
  last saw them.
- Internal: the extension can now look up a book's title and author in Audible's
  catalogue and read its Goodreads rating, genres, first-published year and
  overview, with no cookies sent to either site. Audible book IDs (ASINs) go to
  the catalogue of the marketplace you are browsing, and book titles and authors
  to Goodreads, as the privacy statement says. The permissions are the ones
  already requested.
- Internal: the background worker now looks books up for every open Audible tab
  through one shared queue (at most 3 Goodreads requests at a time, a pause
  between them, a longer pause when Goodreads asks to slow down, and a stop
  after repeated failures).
- The extension is called **Book Ratings for Audible** in Chrome's toolbar and
  extensions page, in place of the working name `audible-ex`. Its description no
  longer mentions filters, which haven't shipped yet.

[Unreleased]: https://github.com/liqweed/audible-ex/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/liqweed/audible-ex/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/liqweed/audible-ex/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/liqweed/audible-ex/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/liqweed/audible-ex/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/liqweed/audible-ex/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/liqweed/audible-ex/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/liqweed/audible-ex/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/liqweed/audible-ex/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/liqweed/audible-ex/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/liqweed/audible-ex/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/liqweed/audible-ex/releases/tag/v0.1.0
