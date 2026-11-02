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

## Cutting a release, until automation exists

The release App and workflow need the repository to be public (issue #47).
Until then a person releases by hand on an up-to-date `main`:

1. `bun <jig>/skills/changelog/scripts/release.ts --dry-run`, and read it.
2. The same without `--dry-run`, then review the diff.
3. Commit it as `chore(release): x.y.z`, push, and tag `vx.y.z` on that
   commit once CI has passed on it.
