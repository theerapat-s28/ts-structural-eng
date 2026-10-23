---
name: update-version
description: Prepare a new version of @theerapat-s28/ts-structural-eng-tools in the working tree — pick the semver bump, bring CHANGELOG.md up to date and cut its Unreleased section into the new version, set package.json, check that the root barrel, README and html-docs match the public surface, and verify lint, tests, build and package contents. Use whenever the user asks to update, bump, set or change the version, cut or prepare a release, "make it 2.1.1", or roll the changelog — even without the word "version". Stops before committing, tagging or publishing; publishing is the npm-publish skill.
---

# Update version

Prepares version `X.Y.Z` of `@theerapat-s28/ts-structural-eng-tools` so the working tree is ready to commit, tag and publish. Done means all of the following, and nothing beyond them:

- `CHANGELOG.md` has a `## [X.Y.Z] — YYYY-MM-DD` section listing every user-facing change since the last release, an empty `## [Unreleased]` above it, and updated compare links.
- `package.json` `version` is `X.Y.Z`.
- The package root re-exports every module export, and README / html-docs describe the public surface as it now stands.
- Lint, tests, build and the packed file list all check out.
- The user gets a short report and the exact commands for the next step.

**Do not commit, tag, push or publish.** AGENTS.md forbids committing unless the user explicitly asks, and a release commit or tag is hard to take back once pushed. If the user's request itself says to commit or tag (e.g. "bump to 2.2.0 and commit it"), do that at the end as described in step 8; otherwise offer it.

Stop and report if any step fails. A version number on top of a red build or a stale changelog is worse than no bump.

## 1. Read the current state

```bash
node -p "require('./package.json').version"   # version in the working tree
git describe --tags --abbrev=0                # last release tag, e.g. v2.1.0
git status --short                            # unreleased work is often uncommitted
git log --oneline $(git describe --tags --abbrev=0)..HEAD
```

Releases are tagged `vX.Y.Z` (annotated, message `Release vX.Y.Z`) on a commit named `chore(release): X.Y.Z`. Use those, not npm, as the record of what has been released. `npm view @theerapat-s28/ts-structural-eng-tools version` is a useful cross-check but needs the network.

**Already bumped?** If package.json is already ahead of the last tag and CHANGELOG.md already has a section for that version, the bump was done but not released. Don't bump again: re-run steps 2, 5, 6 and 7 against that version and report.

## 2. Collect what changed since the last release

Unreleased work can be committed, uncommitted, or both, so read both:

```bash
LAST=$(git describe --tags --abbrev=0)
git log --format='%h %s%n%b' $LAST..HEAD     # commit subjects and bodies (BREAKING CHANGE: footers)
git diff --stat $LAST                        # committed + uncommitted, against the release
git diff $LAST -- 'src/*/index.ts' src/index.ts package.json   # public-surface changes
```

Untracked files don't show in `git diff`; check `git status --short` for `??` entries under `src/`.

A change is **user-facing** if someone importing the package would notice it: a new or renamed export, a changed parameter, default or result field, a new warning or error code, a changed numeric result, a packaging change (exports, ESM/CJS, `files`). Refactors, tests, lint/format, CI and agent tooling are not, and stay out of the changelog.

## 3. Choose the version

If the user named a version or bump, use it, but check it against the changes. Otherwise derive it:

| Changes since the last release | Bump |
| --- | --- |
| Anything that can break existing code: removed or renamed export, a required new input field, a changed result shape, an error thrown where a result used to be returned | **major** |
| New exports, new optional inputs, new result fields, new warnings or error codes | **minor** |
| Only fixes: wrong values corrected, missing re-exports restored, docs fixes | **patch** |

Conventional-commit markers help: `feat!` or a `BREAKING CHANGE:` footer means major, `feat` means minor, `fix` means patch.

If the user asked for a smaller bump than the changes call for (a patch over a breaking change), say so and ask before going on. Downstream apps upgrade on the strength of the version number. A deprecated API that still works does not force a major; removing it does.

## 4. Update CHANGELOG.md

The file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). AGENTS.md asks for an `[Unreleased]` entry with every user-facing change, but entries get missed, so reconcile:

1. Compare `## [Unreleased]` with what step 2 found. Add anything missing, under `### Breaking changes`, `### Added`, `### Changed`, `### Deprecated`, `### Removed` or `### Fixed`, in that order. Drop empty headings.
2. Write each entry for a package user: name the export or field in backticks, say what it does or what changed, and cite the ACI clause or error code where one applies. Not commit subjects, and no file paths.
3. Rename `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD` (today's date, em dash) and put a new, empty `## [Unreleased]` above it.
4. Update the link references at the bottom:
   ```markdown
   [Unreleased]: https://github.com/theerapat-s28/ts-structural-eng/compare/vX.Y.Z...HEAD
   [X.Y.Z]: https://github.com/theerapat-s28/ts-structural-eng/compare/v<previous>...vX.Y.Z
   ```

If the new section ends up with no user-facing entries at all, ask the user whether a release is wanted. A release with nothing in it only makes downstream apps upgrade for nothing.

## 5. Check the public surface and docs

These are the places that have drifted from the code before.

**Root barrel.** Every export of a module barrel (`src/<module>/index.ts`) must be re-exported from `src/index.ts`, because the docs landing page promises that the root re-exports everything:

```bash
node .agents/skills/update-version/scripts/check-root-exports.mjs
```

It lists, by barrel, any value or type the root misses, and exits 1 if there are any. Add those names to `src/index.ts` in the matching group, and record it under `### Fixed` (or `### Added`, if the export is new in this version).

**Docs.** For each public-surface change found in step 2, confirm:

- `html-docs/<module>/index.html` documents it (signature, parameters, warnings with their clause, error codes), and `html-docs/index.html` (module grid, Export Summary) still describes the module. Follow `html-docs/DESIGN.md`.
- `README.md` lists it in the API section, and the "Project layout" tree has any new `src/` file.
- Numbers in doc examples come from the library, not estimates. If one changed, re-run it through a temporary Vitest file under `tests/` and delete the file afterward.

Fix gaps in place. They ship with this version.

## 6. Set the version

```bash
pnpm version X.Y.Z --no-git-tag-version
```

`--no-git-tag-version` is what keeps this to package.json. Plain `pnpm version` would also commit and tag, which step 8 leaves to the user. Nothing else in the repo stores the version (html-docs show none). The `2.1.0` text in `html-implementation-plans/` is history, so leave it.

## 7. Verify

```bash
pnpm run lint            # errors fail; the existing no-explicit-any warning in output-message.type.ts is known
pnpm run format:check
pnpm run test
pnpm run build
npm pack --dry-run --json | grep '"path"' | grep -vE 'dist/'   # expect CHANGELOG.md, LICENSE, README.md, package.json
```

After the build, confirm both entry points load and carry anything added this version:

```bash
node -e "console.log(Object.keys(require('./dist')).length)"
node --input-type=module -e "import * as m from './dist/esm/index.js'; console.log(Object.keys(m).length)"
```

The two counts should match.

## 8. Report and hand off

Report briefly:

- The version: `old → X.Y.Z`, with the bump type and why.
- The changelog entries added in step 4, and anything fixed in step 5.
- Verification results: tests passed, build OK, files in the package.
- Files changed (`git status --short`).

Then give the next step, and offer to run it:

```bash
git add -A && git commit -m "chore(release): X.Y.Z"   # or use the git-commit skill
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

Publishing (`pnpm publish`, which needs the user's browser login, then `git push && git push --tags`) is the `npm-publish` skill in `.claude/skills/npm-publish/SKILL.md`.

Commit and tag only if the user's request asked for it. In that case, review `git status` first so nothing unrelated gets committed, then use the two commands above.
