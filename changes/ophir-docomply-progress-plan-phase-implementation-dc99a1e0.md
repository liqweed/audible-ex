---
release: minor
---

### Added

- Set a maximum public price for each Audible marketplace in the panel. Limits
  sync across tabs and devices; blank turns the limit off and 0 means free only.
  Books with no known price stay visible unless another filter applies. Public
  catalogue prices can differ from member offers.

- Open Settings from the popup to edit all preferences, choose the number of
  labels, show or hide the year and hover overview, and reset or back up prefs
  as JSON. Display edits update open Audible tabs; imports are validated and
  confirmed before replacing preferences. Saved drafts preserve unrelated edits
  made in other tabs. Cached books and panel placement are kept on the device.
