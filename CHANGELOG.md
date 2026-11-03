# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
