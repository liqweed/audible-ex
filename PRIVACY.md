# Privacy policy — Book Ratings for Audible

Last updated: 2026-11-02

Book Ratings for Audible is a browser extension that shows Goodreads ratings,
genres and first-published years on Audible book cards. It is free, open source
(MIT) and made by one person, Ophir Radnitz. It has no server, no account, no
analytics and no telemetry. It is not affiliated with Audible, Amazon or
Goodreads.

## What the extension reads

On the Audible sites it runs on (`www.audible.com`, `.co.uk`, `.ca`, `.com.au`,
`.in`, `.de`, `.fr`, `.it`, `.es` and `.co.jp`), the extension reads the page to
find the books on it and their Audible IDs (ASINs). That includes your Library
and Wish List pages, so the books you own or want are looked up like any other.
It does not read your account details, payment details or anything outside the
book cards.

## What the extension sends, and to whom

Only two kinds of requests leave your browser, both made by the extension's
background worker:

| Sent to                                                                    | What is sent                                                          | Why                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Audible's catalogue API (`api.audible.<marketplace>`, the site you are on) | The ASINs of the books on the page                                    | To get each book's title and author                                |
| Goodreads (`www.goodreads.com`)                                            | A book's title and author, then a request for the matched book's page | To find the book on Goodreads and read its rating, genres and year |

Like any web request, these reach Goodreads and Audible from your IP address,
so they can tell which books were looked up from it. The requests carry no
cookies, so they are not tied to your Audible or Goodreads account. Nothing else
is sent anywhere: not the pages you visit, not your settings, and nothing that
identifies you beyond that address.

## What the extension stores, and where

- **Settings** (for now, whether the extension is on) are kept in your
  browser's sync storage, which your browser may sync to your other devices
  through your browser account.
- **A cache of lookups** (each book's Goodreads rating, number of ratings, link,
  genres, first-published year and a short overview of at most 600 characters)
  is kept on your device only, so the same book isn't looked up again. A found
  book is looked up again after 30 days, a not-found one after 7; entries saved
  more than 32 days ago are deleted, except books seen in your Library or Wish List,
  which are kept until 180 days after you last saw them. You can clear the
  cache at any time from the extension's toolbar popup; uninstalling the
  extension deletes it.

No data is sold, shared, exported or used for any purpose other than showing
ratings on the Audible page you are looking at.

## Permissions

- `storage` and `unlimitedStorage`: to keep your settings and the lookup cache.
- Access to `www.goodreads.com` and the ten `api.audible.*` hosts: to make the
  requests described above.
- The extension runs on the ten `www.audible.*` sites to show the ratings there.

## Changes and contact

Changes to this policy are listed in the extension's
[changelog](CHANGELOG.md) and in this file's history. Questions or concerns:
open an issue at <https://github.com/liqweed/audible-ex/issues>.
