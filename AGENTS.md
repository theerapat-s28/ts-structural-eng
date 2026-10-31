# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project

`ts-structural-eng-tools` — a headless structural analysis and design engine for TypeScript (3D frame analysis, RC beam design per ACI 318-19, strengthening methods), published to npm as an open-source package. Uses pnpm.

Front-end applications install this package as their calculation core and do all graphics themselves. Keep it engine-only: no UI, rendering or presentation data (colours, display labels, view state) in inputs or results, no DOM or Node-only APIs, no runtime dependencies, and models/results that stay plain JSON.

## Commands

```bash
pnpm install                # install dependencies
pnpm run build              # clean + tsc (tsconfig.build.json, src only) + tsc-alias → dist/
pnpm run test               # run all tests (Vitest)
pnpm run test:watch         # watch mode
pnpm vitest run tests/rc/rc-beam-design.test.ts        # single test file
pnpm vitest run -t "calculates phiMn"                  # single test by name
pnpm run lint               # ESLint on src/ (lint:fix to auto-fix)
pnpm run format             # Prettier on src/, tests/, examples/
pnpm run dev                # run examples/EX-0001-basic-usage/basic-usage.ts with ts-node
```

## Git

**Never run `git commit` automatically** — not after finishing a change, not as part of another task. Leave changes uncommitted in the working tree; the maintainer commits when ready using the `git-commit` skill. Only commit when explicitly asked to.

## Architecture

Layered modules, each with a barrel `index.ts`, dependencies flowing downward only:

- `src/core/` — shared foundation: types (`core/types/`), ACI constants (`core/constants/`), error classes (`core/errors/`). Depends on nothing.
- `src/utils/` — generic helpers (quadratic solver, rounding, warning merging). Depends only on core types.
- `src/rc/` — RC beam design calculations. Depends on core + utils.
- `src/strengthening/` — strengthening methods. Builds on `rc/`: e.g. steel plate jacketing converts plates to equivalent rebar area and delegates to `rectBeamMomentCapacity` rather than reimplementing capacity math. New strengthening methods should follow this transform-then-delegate pattern where possible.
- `src/fea/` — finite-element analysis. Depends on core + utils. Four parts, each with its own barrel re-exported by `fea/index.ts`. `shared` is the base; `frame` and `shell` build on it and never import each other; `analysis` builds on all three, and nothing in `fea` imports it. Imports across parts use the `@app-fea/...` alias; relative imports stay inside a part. "Frame" means line members only (as in ETABS): exports that apply to the whole model, which may be shells only, use `Fea…` or no prefix (`analyze`, `FeaModel`, `FeaError`). The pre-3.2.0 `Frame…` names are deprecated aliases in `fea/deprecated.ts` and `core/errors/fea.error.ts`, removed in 4.0.0.
  - `fea/shared/` — what every part builds on: node, restraint and area-load types; generic element assembly (`StiffnessElement`, `elementDofs`); boundary conditions; automatic restraint and unresisted-DOF detection; the `modelIssue` / `throwIssues` / `isFiniteNumber` validation helpers.
  - `fea/frame/` — frame members and null areas: the 3D beam element (stiffness, end releases and their condensation, fixed-end forces, local axes), member pieces (`solver/system-member.ts`), member-load resolution (`solver/member-loads.ts`), member diagrams, member types, and the checks on members, member loads and null areas (`validation/`). Null areas (`area/`) live here, not in `shell/`: they only turn area loads into member loads and add no stiffness.
  - `fea/shell/` — the four-node flat shell: element formulations (`elements/`), shell-area meshing (`mesh/`), per-element system data and surface-load vectors (`solver/`), force and stress recovery (`post/`), shell types, and the checks on shell areas (`validation/validate-shells.ts`).
  - `fea/analysis/` — the whole model, members and shells together, by the direct stiffness method: `FeaModel` and `FeaResult`, `validateModel`, `analyze`, `distributeAreaLoads` and `memberDemandEnvelope`. `analyze` always runs user-defined load cases and forms combinations by superposition: the system is built and factorised once (`solver/analysis-system.ts`), each case is solved into an unrounded `RawState` (`solver/load-case-solver.ts`), combinations superpose raw states and rebuild their diagrams, and rounding happens only on presentation (`post/present-state.ts`, which calls the member-diagram and shell-force presenters). Keep new result quantities linear in the loads, or superposition breaks. Every model goes through `analysis/validation/validate-model.ts` first: it checks the model-level input (ids, nodes, restraints, load cases, nodal and area loads, combinations) and calls the checks in `frame/validation/` and `shell/validation/`. Validate a new input field in the part that owns it (finite numbers, allowed options) and report it with `details` locating it. The solver stores the stiffness in skyline form (`utils/skyline.ts`) and must not build a dense global matrix.

### Path aliases — three places must stay in sync

`@app-core/*`, `@app-types/*`, `@app-utils/*`, `@app-rc/*`, `@app-strg/*`, `@app-fea/*` are defined in **tsconfig.json** (`paths`) and duplicated in **vitest.config.ts** (`resolve.alias`). Runtime resolution for `pnpm run dev` comes from `tsconfig-paths`. Adding or renaming an alias requires updating both config files.

### npm packaging

`package.json` declares subpath exports (`.`, `./rc`, `./strengthening`, `./fea`, `./core`, `./utils`) pointing into `dist/`. A new top-level module under `src/` needs: its own barrel `index.ts`, re-export from `src/index.ts`, and a matching entry in `package.json` `exports`. Anything not re-exported from a barrel is effectively private. Only `dist/`, `README.md`, and `LICENSE` are published (`files` field).

The publish build uses `tsconfig.build.json` (extends the main tsconfig but roots at `src/` and excludes tests) followed by `tsc-alias`, which rewrites the `@app-*` path aliases into relative paths in the emitted JS — without it the published package cannot resolve its own imports. The main `tsconfig.json` stays as-is for editor/test tooling. A second pass builds the ES-module output into `dist/esm/` from `tsconfig.esm.json` (`tsc-alias --resolve-full-paths` adds the `.js` extensions ESM needs, and the build writes `dist/esm/package.json` with `"type": "module"`); every `exports` entry has `import` → `dist/esm/…` and `require` → `dist/…`, so a new subpath needs both.

To change the version without publishing, use the `update-version` skill (`.agents/skills/update-version/SKILL.md`): choose the semver bump, roll `CHANGELOG.md`, set package.json, check the root barrel and docs, verify; no commit or tag. To release, use the `npm-publish` skill (`.claude/skills/npm-publish/SKILL.md`): preflight auth/git checks, lint + test + build, `update-version`, release commit + tag, dry-run, publish, push tags.

## Calculation-function conventions

These are domain rules that apply to every new calculation:

- **Units are SI and implicit in the numbers**: MPa for stresses, mm/mm² for geometry, results in kN·m. Convert at the end of the calculation (`* 0.001 * 0.001` for N·mm → kN·m) and state the unit in the returned `unit` field.
- **Return shape**: public calculation functions return `{ phiMn (or equivalent), calculationDetails, unit, warnings }`. Internal helpers return `calculationResult` (`{ ...details, warnings }`) from `@app-types/output-message.type`.
- **Warnings vs. errors**: a design that is valid but violates a code provision gets a warning pushed to the `Warnings` array, with a `reference` citing the exact clause (e.g. `"ACI318-19, 9.6.1.2"`). A design where the calculation assumptions break down (e.g. tensile steel not yielding) throws `RCDesignError` with a coded entry from `Errors` in `core/errors/rc-design.error.ts` — error codes are grouped by domain (1XX = RC beam design). Never silently return a result whose assumptions failed.
- **Rounding**: round only presented values with `roundToDecimalPlaces`; keep intermediate math unrounded.
- Engineering constants (φ factors, ultimate strain) live in `core/constants/rc.constant.ts` — never inline them as magic numbers.

## Tests

Vitest with `globals: true`; test files live in `tests/` mirroring the `src/` layout (`tests/rc/`, `tests/utils/`), named `*.test.ts`, importing via the path aliases. Tests assert numeric results, warning presence/references, and thrown `RCDesignError`s. Calculation changes should be verified against hand-calculated or textbook values where practical.

## Documentation

User-facing HTML reference pages live at `html-docs/<module-name>/index.html` (one per top-level module: `rc`, `strengthening`, `fea`, …), with a landing page at `html-docs/index.html`, styled per the guide in `html-docs/DESIGN.md` — read it before touching any doc page.

`html-docs/` is deployed verbatim to GitHub Pages (<https://theerapat-s28.github.io/ts-structural-eng/>) by `.github/workflows/pages.yml` on every push to `main` that touches it. The pages are plain static files linked relatively — there is no build step, so never introduce a `/`-rooted path or anything needing a bundler.

- **Any change to a module's public surface must be reflected in its doc page in the same change**: new/renamed/removed exports, parameter or return-shape changes, new warnings (with their ACI clause) or `RCDesignError` codes, changed defaults. Check the relevant `html-docs/<module>/index.html` whenever you touch a barrel export or a public function's signature/behavior.
- **A new top-level module under `src/` must ship with its own `html-docs/<module-name>/index.html`**, following the DESIGN.md checklist (copy the full `<style>` block from an existing page), and must be added to the module grid and Export Summary table in `html-docs/index.html`.
- Numeric values shown in doc examples must be real: run the example inputs through the actual library (e.g. a temporary Vitest file under `tests/`, deleted afterward) and paste the produced outputs — never hand-estimate them.
- Verify every sidebar `href` matches a real element `id` on the page.
- **Every user-facing change gets an entry under `## [Unreleased]` in `CHANGELOG.md` in the same change** (Added / Changed / Deprecated / Removed / Fixed, or "Breaking changes" for anything that needs a major release). Write it for package users, not as a commit subject; skip internal-only changes (refactors, tests, tooling). The `update-version` skill turns Unreleased into the new version.
- **`README.md` must be kept up to date alongside `html-docs/`**: when a module is added, its `src/` tree entry goes into the "Project layout" listing; when a module's exports or scripts change, update the corresponding README section in the same change.
