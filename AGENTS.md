# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project

`ts-structural-eng-tools` — a TypeScript library of structural-engineering calculations (RC beam design per ACI 318-19, strengthening methods), published to npm as an open-source package. Uses pnpm.

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
pnpm run dev                # run examples/basic-usage.ts with ts-node
```

## Architecture

Layered modules, each with a barrel `index.ts`, dependencies flowing downward only:

- `src/core/` — shared foundation: types (`core/types/`), ACI constants (`core/constants/`), error classes (`core/errors/`). Depends on nothing.
- `src/utils/` — generic helpers (quadratic solver, rounding, warning merging). Depends only on core types.
- `src/rc/` — RC beam design calculations. Depends on core + utils.
- `src/strengthening/` — strengthening methods. Builds on `rc/`: e.g. steel plate jacketing converts plates to equivalent rebar area and delegates to `rectBeamMomentCapacity` rather than reimplementing capacity math. New strengthening methods should follow this transform-then-delegate pattern where possible.

### Path aliases — three places must stay in sync

`@app-core/*`, `@app-types/*`, `@app-utils/*`, `@app-rc/*`, `@app-strg/*` are defined in **tsconfig.json** (`paths`) and duplicated in **vitest.config.ts** (`resolve.alias`). Runtime resolution for `pnpm run dev` comes from `tsconfig-paths`. Adding or renaming an alias requires updating both config files.

### npm packaging

`package.json` declares subpath exports (`.`, `./rc`, `./strengthening`, `./core`, `./utils`) pointing into `dist/`. A new top-level module under `src/` needs: its own barrel `index.ts`, re-export from `src/index.ts`, and a matching entry in `package.json` `exports`. Anything not re-exported from a barrel is effectively private. Only `dist/`, `README.md`, and `LICENSE` are published (`files` field).

The publish build uses `tsconfig.build.json` (extends the main tsconfig but roots at `src/` and excludes tests) followed by `tsc-alias`, which rewrites the `@app-*` path aliases into relative paths in the emitted JS — without it the published package cannot resolve its own imports. The main `tsconfig.json` stays as-is for editor/test tooling.

To release a new version, use the `npm-publish` skill (`.claude/skills/npm-publish/SKILL.md`): preflight auth/git checks, lint + test + build, `pnpm version`, dry-run, publish, push tags.

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

User-facing HTML reference pages live at `docs/<module-name>/index.html` (one per top-level module: `rc`, `strengthening`, …), styled per the guide in `docs/DESIGN.md` — read it before touching any doc page.

- **Any change to a module's public surface must be reflected in its doc page in the same change**: new/renamed/removed exports, parameter or return-shape changes, new warnings (with their ACI clause) or `RCDesignError` codes, changed defaults. Check the relevant `docs/<module>/index.html` whenever you touch a barrel export or a public function's signature/behavior.
- **A new top-level module under `src/` must ship with its own `docs/<module-name>/index.html`**, following the DESIGN.md checklist (copy the full `<style>` block from an existing page).
- Numeric values shown in doc examples must be real: run the example inputs through the actual library (e.g. a temporary Vitest file under `tests/`, deleted afterward) and paste the produced outputs — never hand-estimate them.
- Verify every sidebar `href` matches a real element `id` on the page.
- **`README.md` must be kept up to date alongside `docs/`**: when a module is added, its `src/` tree entry goes into the "Project layout" listing; when a module's exports or scripts change, update the corresponding README section in the same change.
