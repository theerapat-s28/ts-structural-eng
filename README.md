# ts-structural-eng

A small TypeScript library of structural-engineering helper functions and beam design utilities. This repository is arranged so you can run the TypeScript sources directly in development (via ts-node) and build distributable JavaScript + type declarations.

## Quick summary
- Package: `ts-structural-eng-tools`
- Entry: `src/index.ts`
- Build output: `dist/` (JS + `.d.ts` files)

## Prerequisites
- Node.js (v14+ recommended)
- pnpm (project uses pnpm)

## Install

Install dependencies with pnpm:

```bash
pnpm install
```

## Scripts

The important scripts in `package.json`:

- `pnpm run dev` — run TypeScript sources directly with `ts-node` (includes runtime support for tsconfig path aliases)
- `pnpm run build` — compile TypeScript into `dist/`

You can inspect them in `package.json`. Current scripts:

```json
{
  "dev": "ts-node -r tsconfig-paths/register src/index.ts",
  "build": "tsc -p tsconfig.json"
}
```

Notes:
- The dev script already includes `-r tsconfig-paths/register`, so path aliases defined in `tsconfig.json` are resolved at runtime.

## Project layout

- `src/` — TypeScript source files
  - `core/` — constants, errors, types
  - `rc/` — concrete/beam design functions
  - `strengthening/` — functions related to steel plate jacketing, etc.
  - `utils/` — helpers (math, merge-warning)
- `tsconfig.json` — compiler options and path aliases
- `package.json` — scripts and devDependencies

Example source files I used to build this README:

- `src/index.ts` — example usage and entrypoint
- `src/strengthening/rc-beam-steel-plate-jacketing.ts` — steel jacketed beam calculations
- `src/rc/rc-beam-design.ts` — beam design helpers

## TypeScript path aliases

This project uses tsconfig `baseUrl` + `paths` to allow imports like `@app-rc/rc-beam-design`. Example entries in `tsconfig.json`:

```jsonc
"baseUrl": "./",
"paths": {
  "@app-core/*": ["src/core/*"],
  "@app-utils/*": ["src/utils/*"],
  "@app-rc/*": ["src/rc/*"],
  "@app-strg/*": ["src/strengthening/*"]
}
```

For Node/runtime to resolve these aliases when running TypeScript directly, the project uses `tsconfig-paths` (this is already wired into the `dev` script:

```bash
pnpm run dev
# which runs: ts-node -r tsconfig-paths/register src/index.ts
```

If you run `ts-node` manually, add the register flag:

```bash
pnpm exec ts-node -r tsconfig-paths/register src/index.ts
```

## Common troubleshooting

- Module not found for alias (e.g. `Cannot find module '@app-rc/rc-beam-design'`)
  - Ensure `tsconfig-paths` is installed and the `-r tsconfig-paths/register` is present when running `ts-node` (the `dev` script already does this).
  - Ensure the target file exists at the mapped path (e.g. `src/rc/rc-beam-design.ts`).

- "Cannot find name 'console'" or TS error about DOM globals
  - For Node projects this usually resolves by installing `@types/node` and ensuring `tsconfig.json` includes `"types": ["node"]` (this project already has that).
  - Restart the TypeScript server in your editor (VS Code: Command Palette → "TypeScript: Restart TS Server") and make sure the editor uses the workspace TypeScript version.

## API & conventions (notes)

- Types: prefer colocating small, module-local types with the file that uses them. Move domain/shared types into `src/core/types` if they're used across modules. This repo already contains shared type files in `src/core/types`.
- Errors: name files clearly. Use `*.errors.ts` when the file exports multiple error types; use singular `*.error.ts` for a single error export. This repo currently has `src/core/errors/rc-design.error.ts`.
- Warnings/merging: keep result objects immutable. Helpers like `mergeWarnings` (present in `src/utils/merge-warning.ts`) are helpful to keep the final return value tidy and avoid nested arrays.

## Build

Compile to `dist/`:

```bash
pnpm run build
```

Then run the compiled output:

```bash
node dist/index.js
```

## Tests & CI

There are no tests in the repository yet. If you plan to add tests, consider `vitest` or `jest` and add a `test` script in `package.json`.

## Next steps / suggestions

1. Add unit tests for core beam functions.
2. Add linting (ESLint) and formatting (Prettier) for consistent style.
3. If this becomes a public package, add `README` sections for exported functions and API usage, and include a LICENSE file.

---

If you'd like, I can also generate a short API section documenting the main exported functions (like `rectBeamMomentCapacity` and `calculateSteelJacketedBeamMomentCapacity`) by scanning their signatures and JSDoc comments.
