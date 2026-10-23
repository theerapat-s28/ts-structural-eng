# ts-structural-eng

**📖 [API Reference — theerapat-s28.github.io/ts-structural-eng](https://theerapat-s28.github.io/ts-structural-eng/)**

A TypeScript library of structural-engineering helper functions and beam design utilities. Designed to be copied and reused across TypeScript frameworks.

## Documentation

Full API reference, with parameter tables, worked examples, warnings and error codes:

- **[API reference](https://theerapat-s28.github.io/ts-structural-eng/)** — landing page
- [RC Beam Design](https://theerapat-s28.github.io/ts-structural-eng/rc/) — `@theerapat-s28/ts-structural-eng-tools/rc`
- [Strengthening](https://theerapat-s28.github.io/ts-structural-eng/strengthening/) — `@theerapat-s28/ts-structural-eng-tools/strengthening`
- [FEA — Frame Analysis](https://theerapat-s28.github.io/ts-structural-eng/fea/) — `@theerapat-s28/ts-structural-eng-tools/fea`

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
│   ├── rc-beam-design.ts # Beam moment capacity (singly/doubly reinforced) and shear capacity (Vc, Vs, stirrup requirement)
│   └── rc-section-properties.ts # Section properties (E, G, A, I22, I33, J) for frame analysis
├── strengthening/        # Strengthening methods
│   ├── index.ts
│   ├── rc-beam-steel-plate-jacketing.ts   # Moment capacity before/after plate jacketing
│   ├── rc-beam-plate-interface-bolts.ts  # Interface shear flow and required interface bolts
│   └── rc-beam-side-plate-shear.ts       # Shear capacity before/after bolted side plates (two models)
├── fea/                  # Finite-element analysis
│   ├── index.ts
│   └── frame/            # 3D frame analysis (direct stiffness method)
│       ├── index.ts
│       ├── elements/         # Reference beam stiffness matrix, fixed-end forces, end-release condensation
│       ├── transformation/   # ETABS-style local axes and the 12×12 transformation
│       ├── solver/           # System build + skyline factorisation, per-case solve, combinations, analyzeFrame
│       ├── validation/       # validateFrameModel: every input problem, with its location
│       ├── post/             # Result presentation, member force diagrams, envelopes, design demands
│       └── types/            # Model (incl. load cases, combinations) and result types
├── core/                 # Shared infrastructure
│   ├── index.ts
│   ├── constants/        # RC design constants (ACI 318)
│   ├── errors/           # Custom error classes
│   └── types/            # Shared type definitions
└── utils/                # Helper utilities
    ├── index.ts
    ├── math.ts           # Quadratic solver, rounding
    ├── matrix.ts         # Dense matrix helpers, Cholesky (factor once, solve many) and general linear solvers
    ├── skyline.ts        # Skyline (banded) Cholesky solver and reverse Cuthill–McKee ordering
    └── merge-warning.ts  # Warning array merging
examples/
└── basic-usage.ts        # Example usage of the library
tests/
├── rc/                   # Tests for RC module
├── strengthening/        # Tests for strengthening module
├── fea/frame/            # Tests for frame analysis
└── utils/                # Tests for utilities
html-docs/                # HTML API reference, deployed to GitHub Pages
├── DESIGN.md             # Style guide for the doc pages
├── index.html            # Landing page
├── rc/index.html
├── strengthening/index.html
└── fea/index.html
```

## TypeScript path aliases

This project uses `baseUrl` + `paths` for clean imports:

```jsonc
"paths": {
  "@app-core/*": ["src/core/*"],
  "@app-types/*": ["src/core/types/*"],
  "@app-utils/*": ["src/utils/*"],
  "@app-rc/*": ["src/rc/*"],
  "@app-strg/*": ["src/strengthening/*"],
  "@app-fea/*": ["src/fea/*"]
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

### FEA — Frame Analysis

Linear-elastic 3D frame analysis by the direct stiffness method, imported from `@theerapat-s28/ts-structural-eng-tools/fea`. Global axes X, Y, Z (Z up) and ETABS-style local axes 1, 2, 3; inputs in mm, MPa, kN and kN·m, results in kN, kN·m, mm and rad.

- **`analyzeFrame(model, options?)`** — Analyses every load case in `model.loadCases` (dead, superimposed dead, live, wind…, each with an optional `selfWeight` multiplier) and forms every combination in `model.combinations` by superposition. The loads are flat top-level lists, `model.nodalLoads` and `model.memberLoads` (uniform, trapezoidal and point loads in local or global directions), each load tagged with its `loadCase`, so large models stay readable. A combination is a list of factored terms `{ case, factor }` or `{ combination, factor }`; factors are entered by the user, and nested combinations are expanded. Supports end releases and fixed or spring supports. The stiffness matrix is factorised once for all cases. Returns `cases` and `combinations` keyed by id — each with displacements, reactions, member end forces, member diagrams along each member (forces `N`, `V2`, `V3`, `T`, `M2`, `M3` and deflections `u1`–`u3` local / `ux`–`uz` global, ready for plotting) and an equilibrium check — and an `envelope` of max/min over the combinations with the governing combination. Combination diagrams are rebuilt exactly, not summed from case extremes. The stiffness is stored in skyline (banded) form with nodes in reverse Cuthill–McKee order, so a building of ~850 nodes runs in about 1.5 s. Model and result are plain JSON, so it runs in a Web Worker. Invalid models, load cases or combinations and mechanisms throw `FrameAnalysisError` (codes 301–314) with `details` locating the problem.
- **`createFrameAnalysis(model, options?)`** — Same analysis, keeping the solution: returns `{ result, memberDiagram(resultId, memberId) }` so full member diagrams can be computed on demand. Combine with `options.diagrams: "extremes"`, which keeps diagram extremes (and the envelope) but drops the station arrays, for results about 4× smaller on large models.
- **`validateFrameModel(model)`** — Checks a model without analysing it and returns every problem, each with `details` (`nodeId`, `memberId`, `loadCaseId`, `combinationId`, `field`, `dof`) for highlighting in a UI. `analyzeFrame` runs it first and throws the first problem as a `FrameAnalysisError` whose `issues` lists all of them; non-finite numbers, negative springs and unknown option values are rejected (314).
- **`memberDemandEnvelope(result, memberId, options?)`** — Reduces a member's diagrams to `MuPositive`, `MuNegative`, `Vu` (optionally at distance `d` from the supports) and `Nu`, enveloped over all combinations (or the `combinations` / `cases` you select), with the `governing` combination of each, for the RC capacity functions.
- **`rectBeamToSectionProperties(section, options?)`** (from `rc`) — Converts a rectangular RC section into `SectionProperties` (`E`, `G`, `A`, `I22`, `I33`, `J`, `unitWeight`) with the ACI 318-19 6.6.3.1.1 inertia modifiers (0.35 beams, 0.70 columns) and a unit weight for self-weight (default 24 kN/m³, common practice rather than an ACI value).
- **`beam3dLocalStiffness(E, G, A, I22, I33, J, L)`** — The 12×12 local stiffness matrix exactly as in the reference "Complete Beam Stiffness Matrix". Its bending rotations R2 and R3 follow the opposite sign to the right-hand rule; **`beam3dLocalStiffnessRightHanded`** returns the right-handed form that `analyzeFrame` uses.
- **`memberAxes(start, end, angle?)`** — The ETABS-style local axes of a member as a direction-cosine matrix.

### General Utilities

- **`concreteBeta(fc_)`** — ACI 318 β₁ factor
- **`concreteElasticModulus(fc_)`** — Ec = 4700√f'c (MPa)
- **`psiToMpa(psi)`** — Unit conversion

## Build

```bash
pnpm run build
node dist/index.js
```

The build emits a CommonJS build in `dist/` (for `require`, with the `.d.ts` types) and an ES-module build in `dist/esm/` (for `import` and bundlers such as Vite); `package.json` `exports` routes each subpath to the right one, and `"sideEffects": false` lets bundlers drop unused code.

## Tests

```bash
pnpm run test
```
