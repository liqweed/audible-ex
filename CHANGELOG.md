# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
