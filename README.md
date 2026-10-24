# ts-structural-eng

**📖 [API Reference — theerapat-s28.github.io/ts-structural-eng](https://theerapat-s28.github.io/ts-structural-eng/)**

A headless structural analysis and design engine for TypeScript: 3D frame analysis by the direct stiffness method, reinforced-concrete beam design per ACI 318-19, and strengthening methods. It is built to be installed by front-end applications as their calculation core.

## Scope: an engine, not an application

The library does the structural engineering and nothing else. A front-end application installs it, builds a model from its own UI, calls the engine, and draws the results.

| The engine (this package)                                                   | The front-end application                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Model validation with located errors (`details` name the node, member, field…) | Input forms, drawing tools, highlighting the reported problems |
| Analysis: load cases, combinations, envelopes, member diagrams              | Rendering the model, deformed shapes and diagrams             |
| Design checks with code-clause warnings and `RCDesignError` / `FrameAnalysisError` | Display of results, member colours, view and display options |
| Typed inputs and results in SI units                                         | Unit display, project files, undo history, other UI state     |

What this means in practice:

- **No UI, no rendering, no presentation data.** Inputs and results carry structural quantities only; no colours, labels or view state.
- **Plain JSON in, plain JSON out.** Models and results are serialisable, so the engine runs in a Web Worker, in the browser or in Node.
- **No runtime dependencies** and no DOM or Node-only APIs.
- **ESM and CommonJS builds** with `.d.ts` types, tree-shakeable (`"sideEffects": false`), split into subpath exports (`/fea`, `/rc`, `/strengthening`, `/core`, `/utils`).

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
- Build output: `dist/` (CommonJS + `.d.ts` files) and `dist/esm/` (ES modules)

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

## Quick start

Analyse a simply supported RC beam under self-weight and live load, envelope the design demands, and check them against the section's flexural capacity:

```ts
import { analyzeFrame, memberDemandEnvelope } from "@theerapat-s28/ts-structural-eng-tools/fea";
import type { FrameModel } from "@theerapat-s28/ts-structural-eng-tools/fea";
import {
  rectBeamMomentCapacity,
  rectBeamToSectionProperties,
} from "@theerapat-s28/ts-structural-eng-tools/rc";

// 300×600 beam, f'c 28 MPa, fy 420 MPa, As 1800 mm²
const beam = { Es: 200_000, fc_: 28, fy: 420, As: 1800, b: 300, h: 600, d: 540 };
const { sectionProperties } = rectBeamToSectionProperties(beam, { member: "beam" });

const model: FrameModel = {
  nodes: [
    { id: "A", x: 0, y: 0, z: 0 },
    { id: "B", x: 6000, y: 0, z: 0 }, // mm
  ],
  members: [{ id: "AB", startNodeId: "A", endNodeId: "B", section: sectionProperties }],
  restraints: [
    { nodeId: "A", ux: true, uy: true, uz: true, rx: true },
    { nodeId: "B", uy: true, uz: true },
  ],
  loadCases: [
    { id: "D", type: "dead", selfWeight: 1 },
    { id: "L", type: "live" },
  ],
  memberLoads: [{ loadCase: "L", type: "udl", memberId: "AB", direction: "Z", w: -15 }], // kN/m
  combinations: [
    {
      id: "1.2D+1.6L",
      terms: [
        { case: "D", factor: 1.2 },
        { case: "L", factor: 1.6 },
      ],
    },
  ],
};

const result = analyzeFrame(model);
const demand = memberDemandEnvelope(result, "AB");
// demand.MuPositive → 131.328 (kN·m), demand.Vu → 87.552 (kN), governed by "1.2D+1.6L"

const { phiMn, warnings } = rectBeamMomentCapacity(beam);
// phiMn → 331.39 (kN·m), warnings → []
```

Each module is also its own subpath export (`/fea`, `/rc`, `/strengthening`, `/core`, `/utils`), so a front end can import only what it uses. The package root re-exports the most-used functions and types from every module.

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
│   ├── rc-bar-layout.ts  # Bar groups → layers satisfying ACI spacing, giving d and d'
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
│       ├── area/             # Null areas: geometry, edge-member chains, area-load distribution
│       ├── elements/         # Reference beam stiffness matrix, fixed-end forces, end releases and partial-fixity condensation
│       ├── transformation/   # ETABS-style local axes and the 12×12 transformation
│       ├── solver/           # System build (with automatic joint restraint) + skyline factorisation, per-case solve, combinations, analyzeFrame
│       ├── validation/       # validateFrameModel: every input problem, with its location
│       ├── post/             # Result presentation, member force diagrams, envelopes, design demands
│       └── types/            # Model (incl. null areas, load cases, combinations) and result types
├── core/                 # Shared infrastructure
│   ├── index.ts
│   ├── constants/        # RC design constants (ACI 318) and frame-analysis tolerances
│   ├── errors/           # RCDesignError and FrameAnalysisError with their coded entries
│   └── types/            # Shared types: RC sections, plate jacketing, section properties, warnings, units
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
ROADMAP.md                # FEA roadmap and implementation plan (not published)
.agents/skills/update-version/ # AI agent skill: bump the version and roll the changelog
.claude/skills/npm-publish/ # AI agent skill: release checklist for publishing to npm
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

- **`analyzeFrame(model, options?)`** — Analyses every load case in `model.loadCases` (dead, superimposed dead, live, wind…, each with an optional `selfWeight` multiplier) and forms every combination in `model.combinations` by superposition. The loads are flat top-level lists, `model.nodalLoads` and `model.memberLoads` (uniform, trapezoidal and point loads in local or global directions, and torques about the member axis), each load tagged with its `loadCase`, so large models stay readable. Area loads (`model.areaLoads`, kN/m²) on null areas (`model.areas`) are first distributed to the members along each area's edges — see `distributeAreaLoads`. A combination is a list of factored terms `{ case, factor }` or `{ combination, factor }`; factors are entered by the user, and nested combinations are expanded. Supports end releases — full (`true`) or partial fixity (a spring stiffness in series with the member end) on any of the six end DOFs, with the deformation across each release reported in `releaseDeformations` — and fixed or spring supports. Joint rotations that no member resists, as at pin-jointed truss joints, are held automatically and listed in `calculationDetails.autoRestrainedDofs`. The stiffness matrix is factorised once for all cases. Returns `cases` and `combinations` keyed by id — each with displacements, reactions, member end forces, member diagrams along each member (forces `N`, `V2`, `V3`, `T`, `M2`, `M3` and deflections `u1`–`u3` local / `ux`–`uz` global, ready for plotting) and an equilibrium check — and an `envelope` of max/min over the combinations with the governing combination. Combination diagrams are rebuilt exactly, not summed from case extremes. The stiffness is stored in skyline (banded) form with nodes in reverse Cuthill–McKee order, so a building of ~850 nodes runs in about 1.5 s. Model and result are plain JSON, so it runs in a Web Worker. Invalid models, load cases or combinations and mechanisms throw `FrameAnalysisError` (codes 301–317) with `details` locating the problem.
- **`createFrameAnalysis(model, options?)`** — Same analysis, keeping the solution: returns `{ result, memberDiagram(resultId, memberId) }` so full member diagrams can be computed on demand. Combine with `options.diagrams: "extremes"`, which keeps diagram extremes (and the envelope) but drops the station arrays, for results about 4× smaller on large models.
- **`validateFrameModel(model)`** — Checks a model without analysing it and returns every problem, each with `details` (`nodeId`, `memberId`, `areaId`, `edge`, `loadCaseId`, `combinationId`, `field`, `dof`) for highlighting in a UI. `analyzeFrame` runs it first and throws the first problem as a `FrameAnalysisError` whose `issues` lists all of them; non-finite numbers, negative springs, invalid end-release values and unknown option values are rejected (314).
- **`distributeAreaLoads(model)`** — Returns `{ memberLoads, warnings }`: the member loads that the model's null areas send to their edge members, exactly what `analyzeFrame` adds, for checking or previewing. A null area (`{ id, nodeIds, distribution, supportEdges? }`) has 3 or 4 nodes forming a planar convex polygon and adds no stiffness. `"twoWay"` sends each point to its nearest edge (the corner-bisector split, any convex shape); `"oneWay"` spans strips between the listed `supportEdges`, parallel to the unsupported edges, half to each end; `"cantilever"` (rectangles) puts `q·c` and a torque `q·c²/2` on its one support edge. Area loads (`{ loadCase, areaId, direction: "3" | "X" | "Y" | "Z", q }`) are per unit true area, `"3"` being the area's normal. Edges split by intermediate nodes are cut at them. Area problems throw 315 (geometry), 316 (an edge without members) or 317 (supports that do not fit the distribution).
- **`memberDemandEnvelope(result, memberId, options?)`** — Reduces a member's diagrams to `MuPositive`, `MuNegative`, `Vu` (optionally at distance `d` from the supports) and `Nu`, enveloped over all combinations (or the `combinations` / `cases` you select), with the `governing` combination of each, for the RC capacity functions.
- **`rectBeamToSectionProperties(section, options?)`** (from `rc`) — Converts a rectangular RC section into `SectionProperties` (`E`, `G`, `A`, `I22`, `I33`, `J`, `unitWeight`) with the ACI 318-19 6.6.3.1.1 inertia modifiers (0.35 beams, 0.70 columns) and a unit weight for self-weight (default 24 kN/m³, common practice rather than an ACI value).
- **`beam3dLocalStiffness(E, G, A, I22, I33, J, L)`** — The 12×12 local stiffness matrix exactly as in the reference "Complete Beam Stiffness Matrix". Its bending rotations R2 and R3 follow the opposite sign to the right-hand rule; **`beam3dLocalStiffnessRightHanded`** returns the right-handed form that `analyzeFrame` uses.
- **`memberAxes(start, end, angle?)`** — The ETABS-style local axes of a member as a direction-cosine matrix.

### Concrete properties (from `rc`)

- **`concreteBeta(fc_)`** — ACI 318 β₁ factor
- **`concreteElasticModulus(fc_)`** — Ec = 4700√f'c (MPa)
- **`psiToMpa(psi)`** — Unit conversion

### Errors and warnings (from `core`)

A design that is valid but breaks a code provision returns normally with an entry in `warnings`, citing the clause (e.g. `"ACI318-19, 9.6.1.2"`). A calculation whose assumptions break down throws instead, never returning a silently wrong result:

- **`RCDesignError`** — `code` and `message` from `Errors`: 1XX for RC beam design (e.g. 102, tensile steel not yielding; 105, `Vs` above the 22.5.1.2 limit), 2XX for strengthening and plate connections (201–206).
- **`FrameAnalysisError`** — `code` from `FrameErrors` (301–317), `details` locating the problem, and `issues` listing every problem `validateFrameModel` found.

`core` also exports the shared input types, the type guards `isSinglyReinforced`, `hasTopPlate`, `hasBottomPlate` and `hasSidePlate`, and the engineering constants (φ factors, ultimate concrete strain, inertia modifiers, frame-analysis tolerances).

### Utilities (from `utils`)

Low-level helpers the engine is built on, exported for reuse: `solveQuadratic`, `roundToDecimalPlaces`, `mergeWarnings`, dense matrix helpers (`zeros`, `identity`, `transpose`, `matMul`, `matVec`), Cholesky and general linear solvers (`choleskyFactor`, `choleskySolveFactored`, `choleskySolve`, `solveLinearSystem`), and the skyline solver (`createSkyline`, `skylineAdd`, `skylineGet`, `skylineSize`, `skylineFactor`, `skylineSolve`, `reverseCuthillMcKee`).

## Build

```bash
pnpm run build
```

The build emits a CommonJS build in `dist/` (for `require`, with the `.d.ts` types) and an ES-module build in `dist/esm/` (for `import` and bundlers such as Vite); `package.json` `exports` routes each subpath to the right one, and `"sideEffects": false` lets bundlers drop unused code. `pnpm run dev` runs [`examples/basic-usage.ts`](examples/basic-usage.ts) against the sources without building.

## Tests

```bash
pnpm run test                                   # all tests
pnpm vitest run tests/rc/rc-beam-design.test.ts # one file
```

Tests live in `tests/`, mirroring `src/`, and check results against hand-calculated or textbook values.

## Releasing

Releases follow semantic versioning and are published to npm with tags `vX.Y.Z`. What changed in each version is in [CHANGELOG.md](CHANGELOG.md). Preparing a version (changelog, version number, checks) is described in [`.agents/skills/update-version/SKILL.md`](.agents/skills/update-version/SKILL.md), and publishing (release commit and tag, dry run, publish, push tags) in [`.claude/skills/npm-publish/SKILL.md`](.claude/skills/npm-publish/SKILL.md).

## License

[ISC](LICENSE)
