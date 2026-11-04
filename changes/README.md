# Change notes

Each pull request that changes what users of the extension notice adds one
note here instead of editing `CHANGELOG.md`; the release step writes the notes
into the changelog, moves the version in `package.json` and deletes them. The
procedure, file naming and format are Jig's changelog skill
(`/jig:changelog`); the settings are in `.config/jig.yaml` under `changelog`.

## What gets a note

A note is for someone who installs the extension, not for someone working on
the repository.

- **Needs a note:** anything a user can see or rely on: badges, the panel,
  filters, settings and their defaults, supported marketplaces, permissions,
  what data is sent where, a fixed defect, a removed feature.
- **No note:** refactors, tests, CI, the toolchain, fixtures, the repository's
  docs and agent instructions. If the branch check still asks for one (the
  change touched a released path), write one `patch` item that says the change
  is internal.
- **Permissions and privacy** changes always get a note under `Changed`, even
  when small: users and store reviewers read the changelog for them.

## Version bumps before 1.0.0

`minor` for a new capability or anything breaking, `patch` for a fix or an
internal change. Phases end in minor releases (0.1 parity, 0.2 panel, 0.3
filters, 0.4 options); 0.1.0 is the first store release (DECISIONS.md
D17), and 1.0.0 follows 0.4.

## Cutting a release

Merging is releasing (DECISIONS.md D26). After each merge to `main`,
`.github/workflows/changelog.yml` writes the waiting notes into `CHANGELOG.md`,
moves the version in `package.json` and pushes the commit
`chore(release): x.y.z` onto `main` as the release App. Once CI passes on that
commit, the same workflow tags it `vx.y.z`, and the tag runs
`.github/workflows/release.yml`, which signs the build and submits it to the
store (D20). Several notes merged before a run make one release, at the largest
bump any of them asks for.

- Before merging, `bun <jig>/skills/changelog/scripts/status.ts` shows the
  version the waiting notes make; `release.ts --dry-run` previews it.
- After merging, watch the `changelog` and `Release` runs, then read the
  review's result in the store dashboard. `status.ts` reports a failed release
  run or a releasing commit whose checks failed (it stays untagged).
- A note without `release` goes under `Unreleased` instead, in its own commit.
