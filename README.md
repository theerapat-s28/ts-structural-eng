# ts-structural-eng

**📖 [API Reference — theerapat-s28.github.io/ts-structural-eng](https://theerapat-s28.github.io/ts-structural-eng/)**

A TypeScript library of structural-engineering helper functions and beam design utilities. Designed to be copied and reused across TypeScript frameworks.

## Documentation

Full API reference, with parameter tables, worked examples, warnings and error codes:

- **[API reference](https://theerapat-s28.github.io/ts-structural-eng/)** — landing page
- [RC Beam Design](https://theerapat-s28.github.io/ts-structural-eng/rc/) — `@theerapat-s28/ts-structural-eng-tools/rc`
- [Strengthening](https://theerapat-s28.github.io/ts-structural-eng/strengthening/) — `@theerapat-s28/ts-structural-eng-tools/strengthening`

The pages are served from [`html-docs/`](https://github.com/theerapat-s28/ts-structural-eng/tree/main/html-docs) via GitHub Pages.

## Quick summary

- Package: `@theerapat-s28/ts-structural-eng-tools`
- Entry: `src/index.ts`
- Build output: `dist/` (JS + `.d.ts` files)

## Prerequisites

- Node.js (v18+ recommended)
- pnpm

## Install

Use the published package:

```bash
pnpm add @theerapat-s28/ts-structural-eng-tools
# or: npm install @theerapat-s28/ts-structural-eng-tools
```

Or install this repository's dependencies to work on the library itself:

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
│   ├── rc-beam-plate-interface-bolts.ts  # Interface shear flow and required interface bolts
│   └── rc-beam-side-plate-shear.ts       # Shear capacity before/after bolted side plates (two models)
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
html-docs/                # HTML API reference, deployed to GitHub Pages
├── DESIGN.md             # Style guide for the doc pages
├── index.html            # Landing page
├── rc/index.html
└── strengthening/index.html
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

Summarised below; see the [full API reference](https://theerapat-s28.github.io/ts-structural-eng/) for parameter tables, units, warnings and error codes.

### RC Beam Design

- **`rectBeamMomentCapacity(section)`** — Computes φMn for a rectangular RC beam (singly or doubly reinforced). Returns `phiMn` in kN·m with calculation details and ACI 318-19 warnings. `calculationDetails` reports `c`, `a`, `beta1`, `d`, `As` and `ro` for either section type, plus `d_`, `As_`, `fs_` and `ro_` when compression steel is present.
- **`rectBeamBarLayout(input)`** — Lays bar groups out into the minimum number of layers that satisfy ACI 318-19 25.2.1 / 25.2.2 spacing, and returns the resulting `d` and `d_` ready to feed into `rectBeamMomentCapacity`. `topBars` is optional; omit it for a section with no top reinforcement.
- **`concreteShearCapacity(section)`** — Computes φVc, the concrete contribution to shear capacity (ACI 318-19, 22.5.5.1).
- **`stirrupShearCapacity(section)`** — Computes φVs, the stirrup contribution to shear capacity (ACI 318-19, 22.5.10.5.3).
- **`checkStirrupRequirement(input)`** — Determines whether stirrups are required, and the required Av/s ratio and max spacing (ACI 318-19, 9.6.3.1, 9.6.3.3, 9.7.6.2.2).

### Strengthening

- **`calculateSteelJacketedBeamMomentCapacity(section, jacketedProperties)`** — Computes φMn for a beam strengthened with steel plate jacketing, as a `before` / `after` pair. The bottom plate is added to the tension steel and the top plate to the compression steel, which turns an originally singly reinforced section into a doubly reinforced one.
- **`plateInterfaceShearFlow(input)`** — Computes the shear flow `q = V·Q/I` (N/mm) to transfer across each concrete-to-plate interface, from a cracked (default) or uncracked elastic transformed section. Returns a per-plate `top` / `bottom` result, `null` where a plate is absent.
- **`boltShearCapacity(bolt)`** — Computes φVsa for one anchor bolt from the steel strength (ACI 318-19, 17.7.1.2b, φ per Table 17.5.3). Concrete breakout and pryout are not evaluated and must be checked separately.
- **`plateInterfaceBoltRequirement(input)`** — Computes the required bolt pitch and count at each interface, taking the larger of the shear-flow requirement (`s = n·φVbolt / q`) and the count needed to develop the full plate yield force, and reports which one governs.

Both plates are independently optional: a plate counts as present only when its width and thickness are both positive, so the same functions cover a bottom-only jacket and a top-and-bottom jacket. Use `hasTopPlate(props)` / `hasBottomPlate(props)` to test for presence.

Plates bolted to the sides of the web strengthen the beam in shear instead. ACI 318-19 has no provisions for steel side plates, so two independent models are offered and both return a `before` / `after` pair of `phiVn` (kN) for a continuous plate or discrete strips, with the plate contribution limited by the bolt anchorage and by the ACI 318-19 22.5.1.2 web-crushing cap. Use `hasSidePlate(props)` to test for presence.

- **`sidePlateShearCapacityByWebYielding(section, plates)`** — Takes each plate as a supplementary web reaching the von Mises shear yield stress `0.6·fy` (AISC 360 G2.1), and warns on plate slenderness beyond `2.24·√(Es/fy)`.
- **`sidePlateShearCapacityByTensionTie(section, plates)`** — Takes each plate as a tension tie crossing the diagonal crack, per the bonded shear reinforcement model of ACI 440.2R-17 §11.4 with steel in place of FRP: `ffe = min(fy, Es·0.004)` and `psi_f = 0.85`. Supports inclined strips.

ACI 440.2R-17 11.4.2 (spacing, which defers to the ACI 318 limits) and 11.4.3 (`Vs + Vf ≤ 0.66·√f'c·bw·d`) are verified against the guide; the subsections carrying the 0.004 strain cap and `psi_f` are still cited at §11.4 only. See the citation-status note at the top of `src/strengthening/rc-beam-side-plate-shear.ts`.
- **`compareSidePlateShearCapacity(section, plates)`** — Runs both models and reports the lower `phiVn` as `governing`; the intended entry point for a conservative design capacity.

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
