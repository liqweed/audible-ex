/** Where the extension's own pages live; the popup and the panel's logo link to them. */
export const SOURCE_URL = 'https://github.com/liqweed/audible-ex'
export const PRIVACY_URL = `${SOURCE_URL}/blob/main/PRIVACY.md`
/** The extension's page in the Chrome Web Store (docs/STORE-LISTING.md). */
export const STORE_URL =
  'https://chromewebstore.google.com/detail/book-ratings-for-audible/kmmnfidbflcgfcbifjfakgnjppoflffo'
/** The extension's page on Firefox Add-ons (docs/AMO-LISTING.md, "Add-on URL"). */
export const AMO_URL =
  'https://addons.mozilla.org/firefox/addon/book-ratings-for-audible/'
/** Where to rate the extension: the reviews of the store this build is listed in. */
export const REVIEW_URL = import.meta.env.FIREFOX
  ? `${AMO_URL}reviews/`
  : `${STORE_URL}/reviews`
/** The store `REVIEW_URL` belongs to, as a phrase that follows "on". */
export const REVIEW_STORE = import.meta.env.FIREFOX
  ? 'Firefox Add-ons'
  : 'the Chrome Web Store'
/** The extension's page in the store this build is listed in. */
export const LISTING_URL = import.meta.env.FIREFOX ? AMO_URL : STORE_URL
