# ts-structural-eng

A TypeScript library of structural-engineering helper functions and beam design utilities. Designed to be copied and reused across TypeScript frameworks.

## Quick summary

- Package: `ts-structural-eng-tools`
- Entry: `src/index.ts`
- Build output: `dist/` (JS + `.d.ts` files)

## Prerequisites

- Node.js (v18+ recommended)
- pnpm

## Install

```bash
pnpm install
```

## Scripts

| Command                | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `pnpm run dev`         | Run the example file with `ts-node`             |
| `pnpm run build`       | Compile TypeScript into `dist/`                 |
| `pnpm run lint`        | Lint source files with ESLint                   |
| `pnpm run lint:fix`    | Auto-fix lint issues                            |
| `pnpm run format`      | Format code with Prettier                       |
| `pnpm run format:check`| Check formatting without writing                |
| `pnpm run test`        | Run unit tests with Vitest                      |
| `pnpm run test:watch`  | Run tests in watch mode                         |

## Project layout

```
src/
├── index.ts              # Main barrel export
├── rc/                   # Reinforced concrete design
│   ├── index.ts          # Module exports
│   ├── general.ts        # Concrete properties (beta1, Ec, unit conversion)
│   └── rc-beam-design.ts # Beam moment capacity (singly/doubly reinforced) and shear capacity (Vc, Vs, stirrup requirement)
├── strengthening/        # Strengthening methods
│   ├── index.ts
│   ├── rc-beam-steel-plate-jacketing.ts   # Moment capacity before/after plate jacketing
│   └── rc-beam-plate-interface-bolts.ts  # Interface shear flow and required interface bolts
├── core/                 # Shared infrastructure
│   ├── index.ts
│   ├── constants/        # RC design constants (ACI 318)
│   ├── errors/           # Custom error classes
│   └── types/            # Shared type definitions
└── utils/                # Helper utilities
    ├── index.ts
    ├── math.ts           # Quadratic solver, rounding
    └── merge-warning.ts  # Warning array merging
examples/
└── basic-usage.ts        # Example usage of the library
tests/
├── rc/                   # Tests for RC module
├── strengthening/        # Tests for strengthening module
└── utils/                # Tests for utilities
```

## TypeScript path aliases

This project uses `baseUrl` + `paths` for clean imports:

```jsonc
"paths": {
  "@app-core/*": ["src/core/*"],
  "@app-types/*": ["src/core/types/*"],
  "@app-utils/*": ["src/utils/*"],
  "@app-rc/*": ["src/rc/*"],
  "@app-strg/*": ["src/strengthening/*"]
}
```

For runtime resolution, `tsconfig-paths` is registered in the `dev` script.

## API

### RC Beam Design

- **`rectBeamMomentCapacity(section)`** — Computes φMn for a rectangular RC beam (singly or doubly reinforced). Returns `phiMn` in kN·m with calculation details and ACI 318-19 warnings.
- **`concreteShearCapacity(section)`** — Computes φVc, the concrete contribution to shear capacity (ACI 318-19, 22.5.5.1).
- **`stirrupShearCapacity(section)`** — Computes φVs, the stirrup contribution to shear capacity (ACI 318-19, 22.5.10.5.3).
- **`checkStirrupRequirement(input)`** — Determines whether stirrups are required, and the required Av/s ratio and max spacing (ACI 318-19, 9.6.3.1, 9.6.3.3, 9.7.6.2.2).

### Strengthening

- **`calculateSteelJacketedBeamMomentCapacity(section, jacketedProperties)`** — Computes φMn for a beam strengthened with steel plate jacketing, as a `before` / `after` pair.
- **`plateInterfaceShearFlow(input)`** — Computes the shear flow `q = V·Q/I` (N/mm) to transfer across each concrete-to-plate interface, from a cracked (default) or uncracked elastic transformed section. Returns a per-plate `top` / `bottom` result, `null` where a plate is absent.
- **`boltShearCapacity(bolt)`** — Computes φVsa for one anchor bolt from the steel strength (ACI 318-19, 17.7.1.2b, φ per Table 17.5.3). Concrete breakout and pryout are not evaluated and must be checked separately.
- **`plateInterfaceBoltRequirement(input)`** — Computes the required bolt pitch and count at each interface, taking the larger of the shear-flow requirement (`s = n·φVbolt / q`) and the count needed to develop the full plate yield force, and reports which one governs.

Both plates are independently optional: a plate counts as present only when its width and thickness are both positive, so the same functions cover a bottom-only jacket and a top-and-bottom jacket. Use `hasTopPlate(props)` / `hasBottomPlate(props)` to test for presence.

### General Utilities

- **`concreteBeta(fc_)`** — ACI 318 β₁ factor
- **`concreteElasticModulus(fc_)`** — Ec = 4700√f'c (MPa)
- **`psiToMpa(psi)`** — Unit conversion

## Build

```bash
pnpm run build
node dist/index.js
```

## Tests

```bash
pnpm run test
```
