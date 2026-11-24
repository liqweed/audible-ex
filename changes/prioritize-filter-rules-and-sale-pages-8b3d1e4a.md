---
release: minor
---

### Added

- Filter and highlight rules can now be prioritized by drag-and-drop (or Up/Down arrow keys on each rule's grip) in both the floating panel and the settings page. When a book matches more than one rule, the highest-priority rule wins: a highlight rule above a hide rule keeps matching books visible, and a dim rule above a hide rule dims instead of hiding. Existing preferences migrate to preserve their current behaviour.

### Fixed

- Sale campaign pages without "deals" in their address (such as `/ep/bfcm-uk`, Black Friday, Cyber Monday, cash sale, and 2-for-1 pages) are now recognized as deals pages for the "Only on deals pages" price limit, while `/pd/` product pages whose titles contain those words are no longer misclassified.
