---
name: npm-publish
description: Publish a new version of @theerapat-s28/ts-structural-eng-tools to the npm registry. Use whenever the user wants to release, publish, deploy, or push the package to npm, bump the package version, or asks how to release a new version — even if they just say "release this" or "put this on npm".
---

# Publish to npm

Prepares a release of `@theerapat-s28/ts-structural-eng-tools` (https://www.npmjs.com/package/@theerapat-s28/ts-structural-eng-tools). The package is scoped, so it must be published with public access — `publishConfig.access: "public"` in package.json handles this; don't remove it.

**You do NOT run `pnpm publish` yourself.** The npm account requires browser-based auth on publish, which only works when the user types the command in their own terminal. Your job is steps 1–4 (preflight, verify, version bump, dry run); then hand the final commands to the user (step 5) and stop.

Follow the steps in order. Stop and report to the user if any step fails — never prepare a publish over a failing build or test suite, because a published version can't be replaced (npm forbids re-publishing the same version number, and unpublish is heavily restricted).

## 1. Preflight

Run these checks first:

```bash
npm whoami                 # must print the npm username; if it errors, run `npm login` (needs the user at the terminal for browser/OTP auth)
git status --porcelain     # must be empty — commit or stash first; pnpm publish refuses a dirty tree
npm view @theerapat-s28/ts-structural-eng-tools version   # currently published version
```

Confirm the `name` in package.json is the scoped `@theerapat-s28/ts-structural-eng-tools` and its `version` is what you expect relative to the published one.

## 2. Verify the code

```bash
pnpm run lint
pnpm run test
pnpm run build
```

All three must pass. The build output in `dist/` is what actually ships (`files` field limits the tarball to `dist/`, README.md, LICENSE), so a stale or failed build means publishing broken code even if `src/` is fine.

## 3. Bump the version

Ask the user which bump applies if it isn't obvious from the changes (semver: patch = fixes, minor = new backwards-compatible features, major = breaking API changes):

```bash
pnpm version patch   # or minor / major
```

This updates package.json, commits, and creates a git tag `vX.Y.Z`.

## 4. Dry run

Always dry-run and show the user the file list — it catches missing `dist/` files or accidental inclusions before anything goes live:

```bash
pnpm publish --dry-run
```

Check that the tarball contains `dist/`, README.md, LICENSE, package.json, and that the name/version are right.

## 5. Hand off to the user — do not publish yourself

Publishing triggers npm's browser-based auth, which fails with `EOTP` when run by an agent. Once the dry run looks right, tell the user everything is ready and give them these commands to run themselves, in order:

```bash
pnpm publish                                              # completes browser auth when prompted
npm view @theerapat-s28/ts-structural-eng-tools version   # should show the new version
git push && git push --tags
```

Report the prepared version and remind them the npm URL is https://www.npmjs.com/package/@theerapat-s28/ts-structural-eng-tools. Your work ends here — do not run `pnpm publish` even if the user seems to expect it; point them back to these commands instead.

## Troubleshooting

- `ENEEDAUTH` / `npm whoami` fails → `npm login` (user must complete browser auth/OTP themselves).
- `403 Forbidden` on publish → usually the version already exists on the registry, or the logged-in user isn't `theerapat-s28`. Check `npm view` for existing versions and `npm whoami`.
- `EOTP` when the user publishes → the browser auth wasn't completed; open the URL npm prints and finish authentication, then rerun `pnpm publish`.
- Publish rejected for unclean git → commit or stash; only bypass with `--no-git-checks` if the user explicitly says so.
