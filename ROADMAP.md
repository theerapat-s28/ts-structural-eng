# FEA Roadmap & Implementation Plan

> **Module**: [`@theerapat-s28/ts-structural-eng-tools/fea`](src/fea/index.ts)  
> **Documentation**: [html-docs/fea/index.html](html-docs/fea/index.html)  
> **Target users**: engineers analysing **RC and steel buildings** — moment frames, braced frames, wall–frame systems with floor slabs as null areas and shell walls or slabs where their stiffness matters, under gravity, wind and seismic load cases.

This roadmap lists what the `fea` engine still needs to be a dependable analysis core for building design: the modelling inputs a building model uses every day, lateral-system behaviour (diaphragms, second-order effects), dynamics (modal, response spectrum) and shell elements.

---

## Architecture Rules & Constraints

Every feature added must conform to the following core principles:

1. **Linear in the loads**: Every load-case result must be linear in that case's loads, so load combinations (superposition of raw states) stay exact.
   - **One documented exception — linearized P-Δ**: a single user-named P-Δ load set fixes the geometric stiffness $\mathbf{K}_g$ once; every case is then solved linearly against $\mathbf{K} + \mathbf{K}_g$, so superposition still holds (a common approach in building analysis).
   - Modal, buckling and response-spectrum results are separate result kinds, not load cases; response-spectrum peaks enter combinations only through envelope-type combinations.
   - Still excluded: anything whose stiffness depends on the case being solved (tension-only members, gaps, plasticity).
2. **Validated with location**: Every new input field must be validated in [`src/fea/analysis/validation/validate-model.ts`](src/fea/analysis/validation/validate-model.ts) (member and null-area fields in [`src/fea/frame/validation/`](src/fea/frame/validation/), shell fields in [`src/fea/shell/validation/validate-shells.ts`](src/fea/shell/validation/validate-shells.ts), both called from it) and report errors with `details` pinpointing the exact `nodeId`, `memberId`, `loadCase`, or `field`.
3. **No dense global matrix**: The stiffness (and mass) stays in skyline form ([`src/fea/frame/utils/skyline.ts`](src/fea/frame/utils/skyline.ts)) with nodes in reverse Cuthill–McKee order ([`solver/analysis-system.ts`](src/fea/analysis/solver/analysis-system.ts)). Any DOF coupling (constraints, diaphragm masters) must enter the RCM adjacency so the profile stays narrow.
4. **Standard SI units**: Coordinates and geometry in mm, elastic moduli and stresses in MPa, forces in kN, moments in kN·m, distributed loads in kN/m, rotations in rad; thermal coefficients in 1/°C, temperatures in °C, unit weights in kN/m³, periods in s.
5. **Verified**: Validated against textbook / hand-calculated benchmarks and independent oracles (e.g. subdivided-member tests), and added to the verification suite (1.8).
6. **Synchronous Documentation**: Every change must be documented in [html-docs/fea/index.html](html-docs/fea/index.html), landing docs, [CHANGELOG.md](CHANGELOG.md), and [README.md](README.md).
7. **Engine only**: Structural data in plain JSON. No UI, rendering, colors, or presentation state.
8. **Additive within 2.x**: New inputs are optional and existing models keep producing identical results. Anything that needs a breaking change is collected for 3.0.

---

## Roadmap Overview

| Status | Phase | Feature | Effort | Depends on |
|:------:|:-----:|:--------|:------:|:-----------|
| [x] | — | Varying member loads (`trapezoidal`) | M | — |
| [x] | — | Distributed torque (`torque`) | S | — |
| [x] | — | Null areas (area loads to beams) | L | Varying loads, torque |
| [x] | — | Axial-only members (automatic joint restraint) | S | — |
| [x] | — | Partial-fixity end releases + release deformations | M | — |
| [x] | — | Projected loads | S | — |
| [ ] | 1 | Sections & materials (new `sections` module, referenced by id) | L | — |
| [ ] | 1 | Property modifiers (cracked sections) | S | — |
| [ ] | 1 | Member point moments | S | — |
| [ ] | 1 | Combination types (`linear` / `envelope`) | M | — |
| [ ] | 1 | Null area robustness (crossing beams, tolerances) | S | — |
| [ ] | 1 | Verification suite | M | — (ongoing) |
| [ ] | 2 | End offsets (rigid zones) | M | — |
| [ ] | 2 | Shear deformation (Timoshenko) | S | Sections & materials |
| [ ] | 2 | Local axes from a reference vector | S | — |
| [ ] | 2 | Distributed member moments | M | Member point moments |
| [ ] | 2 | Member twist | S | — |
| [ ] | 2 | Support settlement | M | — |
| [ ] | 2 | Temperature loads | M | Sections & materials |
| [ ] | 2 | Skewed supports | M | — |
| [ ] | 2 | Live-load patterning helper | M | Combination types |
| [ ] | 2 | Null area extensions | M | Distributed moments (part) |
| [ ] | 3 | General nodal constraints | M | — |
| [ ] | 3 | Rigid floor diaphragms & story results | L | General constraints |
| [ ] | 3 | Linearized P-Δ | L | Combination types |
| [ ] | 4 | Mass source & mass matrix | M | Diaphragms (rotational mass) |
| [ ] | 4 | Eigensolver & modal analysis | L | Mass |
| [ ] | 4 | Linear buckling | S | Eigensolver, P-Δ ($\mathbf{K}_g$) |
| [ ] | 4 | Response spectrum analysis | L | Modal, combination types |
| [x] | 5 | Generic element assembly (refactor) | S | — |
| [x] | 5 | Membrane element (drilling quad) | M | Generic assembly |
| [x] | 5 | DKQ plate element | M | Generic assembly |
| [x] | 5 | Flat shell element (axes, warping, modifiers) | M | Membrane, DKQ |
| [x] | 5 | Shells in the model (validation, assembly, loads) | L | Flat shell |
| [x] | 5 | Shell results & first release | M | Shells in the model |
| [x] | 5 | Engine meshing of shell areas | L | Shell results |
| [x] | 5 | Strip forces (design strips over slabs) | M | Engine meshing |
| [x] | 5 | Pier & spandrel forces (wall section cuts) | L | Engine meshing |
| [ ] | 5 | Thick plates (DKMQ or MITC4) | M | Shell results |
| [ ] | 5 | Triangular shells & openings | L | Engine meshing |

*Effort scale*: **S** ≈ 1 day, **M** ≈ 2–3 days, **L** ≈ 1+ week (including tests and docs).

---

## Verification Report (all modules)

A published report that shows, problem by problem, how the engine compares with published references. It is what the docs' [Verification status](html-docs/about/index.html#verification) promises and what every theory page's *Verification* section will point to. It covers `fea`, `rc` and `strengthening`, and extends 1.8 below to the whole package.

> **Examples and sources are supplied by the maintainer.** Do not pick benchmark problems or quote reference values without them: each problem enters the suite only with its source in hand, and every engine value in the report comes from running the suite.

### Infrastructure
- [ ] `tests/verification/` with one subfolder per module (`fea/`, `rc/`, `strengthening/`) and one file per published problem. Each file states the source (author, title, edition, problem or example number, page), the quantities checked, the reference values exactly as published, and the pass tolerance.
- [ ] Pass criteria per problem: exact closed-form or code-formula results ≤ 0.1 % difference; mesh-dependent shell results within a tolerance stated with the mesh used (typically 2–5 %). A failing problem fails `pnpm run test` and so CI.
- [ ] A `pnpm run verify` script that runs the suite and writes the results table (problem, source, quantity, unit, reference, engine, % difference, tolerance, pass) into the report page, stamped with the package version and date. The page stays a plain static file with no build step.

### Report page
- [ ] `html-docs/verification/index.html` following [html-docs/DESIGN.md](html-docs/DESIGN.md): the notice banner, one section per module, the generated tables, and a sources list.
- [ ] Link it from the landing page, [html-docs/about/index.html](html-docs/about/index.html) (`#verification`), the README *Verification status* paragraph, and each theory page's *Verification* section.
- [ ] Replace the "in preparation" notes in the about page, the README and the theory pages once the first module's problems are in.

### Problems (sources to be supplied)
- [ ] **FEA, frame**: 2D and 3D frames, trusses, end releases and partial fixity, spring supports, member loads (uniform, trapezoidal, point, torque), self-weight, intermediate nodes.
- [ ] **FEA, analysis**: load combinations and envelopes, null-area load distribution against statics, unresisted rotations at truss joints.
- [ ] **FEA, shells**: move the existing shell benchmarks (patch tests, MacNeal–Harder cantilevers and twisted beam, Timoshenko plates, Scordelis–Lo roof, pinched cylinder) into the suite with their published sources and the meshes used; strip forces and pier/spandrel forces against statics.
- [ ] **RC**: published design examples for singly and doubly reinforced flexure, tension-control limits, concrete and stirrup shear strength, stirrup requirement and spacing, bar layout.
- [ ] **Strengthening**: published examples or test results for plate-jacketed flexure, interface shear flow and bolting, and side-plate shear. Test data, not only formula checks, is needed to support the engineering models.
- [ ] **Later phases**: add problems as features land (end offsets, P-Δ, diaphragms, modal, buckling, response spectrum, thick plates), as listed in 1.8.

---

## Delivered Features

- [x] **Varying Member Loads (`TrapezoidalMemberLoad`)**
  - [x] Input type: `{ type: "trapezoidal", w1, w2, start?, end? }`
  - [x] Closed-form resultant and first moment for fixed-end actions
  - [x] 3-point Gauss quadrature replaces Simpson rule for deflection integration
  - [x] Zero-shear roots quadratic solver and zero-load point tracking inside sign-changing loads
  - [x] Unit tests in `tests/fea/frame/trapezoidal-load.test.ts` with textbook cases ($wL^2/30$, $wL^2/20$, $M_{max} = wL^2 / (9\sqrt{3})$ at $L/\sqrt{3}$, deflection at $0.5193L$, subdivided-member oracle)

- [x] **Distributed Torque Loads (`TorqueMemberLoad`)**
  - [x] Input type: `{ type: "torque", t, start?, end? }`
  - [x] Fixed-end moments from linear torsion shape functions ($tL/2$)
  - [x] Linear internal torque $T$ along loaded length
  - [x] Unit tests in `tests/fea/frame/torque-load.test.ts` (partial span loads, inclined cantilever, torsion releases)

- [x] **Null Areas (Area Loads to Beams)**
  - [x] Implemented in [`src/fea/frame/area/`](src/fea/frame/area/)
  - [x] Two-way distribution: Polygon bisector clipping with half-planes (convex shapes and skewed quadrilaterals)
  - [x] One-way distribution: Strip method based on parallel unsupported edges, resultant matching polygon centroid
  - [x] Cantilever distribution: Support edge receives line load ($q \cdot c$) and distributed torque ($q \cdot c^2 / 2$)
  - [x] Member chains along area edges (splitting at intermediate nodes)
  - [x] Direction options: local `"3"` or global `X`/`Y`/`Z`
  - [x] Error codes: 315 (`INVALID_AREA_GEOMETRY`), 316 (`AREA_EDGE_UNSUPPORTED`), 317 (`INVALID_AREA_DISTRIBUTION`)
  - [x] 58 tests in `tests/fea/frame/area-*.test.ts` (10 mm grid oracle for skewed quad, equilibrium checks $\sum R = q \cdot A$)

- [x] **Partial-Fixity End Releases & Release Deformations** (was 1.4)
  - [x] `MemberEndRelease` fields typed `DofRelease = boolean | number`: `true`/`0` full release, a number is a spring in series with the member end (kN/mm, kN·m/rad), on all six end DOFs
  - [x] Generalised condensation in [`static-condensation.ts`](src/fea/frame/elements/static-condensation.ts): expanded member + spring system, member-side DOFs eliminated, `k*_nn = S·A⁻¹·k_rr` (cancellation-free), diagonal scaling so the 307 check is unit-independent
  - [x] Member-side end displacements recovered from member equilibrium; diagrams use them, `releaseDeformations` reports node − member per released/spring DOF
  - [x] Shared release parser [`end-releases.ts`](src/fea/frame/elements/end-releases.ts) (validation and solver), 314 for invalid values with `field: "releases.end.r3"`
  - [x] Tests in `tests/fea/frame/end-releases.test.ts`: series-spring formulas, fixity factor, restraint-spring oracle, axial/torsion/shear springs, limits, superposition, validation
  - [ ] Not yet: `releaseDeformations` in the envelope

- [x] **Axial-Only Members — Automatic Joint Restraint** (was 1.3)
  - [x] [`auto-restraint.ts`](src/fea/shared/solver/auto-restraint.ts): per-joint 3×3 rotational block, Jacobi eigen-decomposition, spring `k·n·nᵀ` on each null direction (exact: the PSD member stiffness makes that column zero)
  - [x] Per-load-case check: a moment about a held axis throws 304 with `nodeId`, `dof`, `loadCaseId`
  - [x] `calculationDetails.autoRestrainedDofs: { nodeId, axis, dof? }[]`
  - [x] Scope decision: only rotations that *no member at the joint* resists are held. Member rigid-body motions (e.g. a truss with torsion connected at both ends spinning about the member axes, or a beam without torsional support) still throw 304 — release `r1` at one end
  - [x] Tests in `tests/fea/shared/auto-restraint.test.ts`: truss vs method of joints, manual-restraint equivalence, inclined null axis, load-on-held-axis 304, no restraint at continuous columns or springs

- [x] **Projected Loads** (was 2.4)
  - [x] `projected?: boolean` on `udl`, `trapezoidal` and `AreaLoad`
  - [x] Global member loads scaled by the projected-length factor $L_{proj} / L = \sqrt{1 - (\mathbf{e}_1 \cdot \mathbf{e}_{dir})^2}$ in [`load-case-solver.ts`](src/fea/analysis/solver/load-case-solver.ts); `start`/`end` stay along the member
  - [x] Global area loads scaled by $|\mathbf{n} \cdot \mathbf{e}_{dir}|$ on the true area in [`area-member-loads.ts`](src/fea/frame/area/area-member-loads.ts); generated member loads carry no `projected`
  - [x] Validation: 314 (`field: "projected"`) for a non-boolean, or `true` with a local direction, the normal `"3"`, or on a point/torque load
  - [x] Tests in `tests/fea/frame/projected-loads.test.ts`: 30° rafter vs $w \cos\theta$, partial trapezoidal, vertical column (zero load), skewed 3D member, combination, inclined ramp (two-way, one-way, cantilever) with $\sum R = q \cdot A_{plan}$, vertical area, validation

---

## Phase 1: Modelling Foundation

The inputs every RC or steel building model needs before lateral analysis is worth doing.

### 1.1 Sections & Materials (new `sections` module)
Section geometry is needed by `fea` (stiffness) and by `rc/` and future steel design (capacity), so it lives in its own top-level module `src/sections/` rather than inside `fea/`.

- [ ] **Module packaging** (per AGENTS.md): barrel `src/sections/index.ts`, re-export from `src/index.ts`, `@app-sections/*` alias in both `tsconfig.json` and `vitest.config.ts`, `./sections` subpath in `package.json` `exports` (both `import` and `require`), `html-docs/sections/index.html`, landing-page grid and Export Summary, README project layout.
- [ ] Shape union type `SectionShape`:
  - [ ] `{ kind: "rectangle", b, h }` (RC beams, columns, wide-column wall piers)
  - [ ] `{ kind: "circle", d }`
  - [ ] `{ kind: "pipe", d, t }` (CHS)
  - [ ] `{ kind: "box", b, h, tf, tw }` (RHS/SHS)
  - [ ] `{ kind: "i", d, bf, tf, tw }` (doubly symmetric I/H — W shapes and built-up girders)
  - [ ] `{ kind: "tee", d, bf, tf, tw }`
  - No steel shape database: the front end supplies dimensions (e.g. from an AISC/JIS/TIS table).
  - Channels and angles are deferred: shear-centre offset and principal-axis rotation need extra handling.
- [ ] Material type `FrameMaterial`: `{ E, nu, unitWeight, alpha?, fc?, fy? }`. `fc`/`fy` are carried through for downstream design modules and are not used by the analysis.
- [ ] `frameSection(shape, material)` returns `{ sectionProperties, calculationDetails, unit, warnings }`:
  - [ ] $A$, $I_{22}$, $I_{33}$ (local 3 is the major axis; parallel-axis theorem for tee).
  - [ ] Torsional constant $J$:
    - Solid circle: $\pi d^4 / 32$
    - Rectangle: Saint-Venant series
    - Thin-walled closed (box, pipe): Bredt formula $4A_m^2 / \oint (ds/t)$
    - Thin-walled open (I, tee): $\sum b t^3 / 3$ (warping torsion ignored — document it)
  - [ ] $G = E / (2(1 + \nu))$.
  - [ ] Shear areas $A_{s2}$, $A_{s3}$ for Timoshenko (2.2).
  - [ ] Warning when thin-walled assumptions are outside their validity range ($t > d/10$).
  - [ ] Errors: 314 (non-positive dimensions), 318 `INVALID_SECTION_SHAPE` (e.g. $2 t_f \ge d$).
- [ ] Material presets:
  - [ ] `concreteMaterial(fc, options?)`: $E = 4700\sqrt{f'_c}$ (ACI 318-19, 19.2.2.1(b)), $\nu = 0.2$, $\gamma = 24\text{ kN/m}^3$, $\alpha = 1.0 \times 10^{-5}/^\circ\text{C}$.
  - [ ] `steelMaterial(options?)`: $E = 200\,000\text{ MPa}$, $\nu = 0.3$, $\gamma = 78.5\text{ kN/m}^3$, $\alpha = 1.2 \times 10^{-5}/^\circ\text{C}$.
  - [ ] Custom overrides for every property.
- [ ] **Referencing from the frame model (additive)**:
  - [ ] `FeaModel.materials?: { id, ...FrameMaterial }[]` and `FeaModel.sections?: { id, materialId, shape } | { id, materialId, properties }[]` (shape-based or explicit properties).
  - [ ] `Member.sectionId?` as an alternative to the inline `Member.section`; exactly one of the two must be given.
  - [ ] Self-weight reads `unitWeight` from the referenced material.
  - [ ] Error 322 `UNKNOWN_PROPERTY_REFERENCE` for an unknown `sectionId` / `materialId`; 303 for duplicate ids.
- [ ] Benchmark tests against published steel manual tables and concrete section formulas.

### 1.2 Property Modifiers (Cracked Sections)
- [ ] `Member.modifiers?: { A?, A2?, A3?, J?, I22?, I33?, weight? }`, default 1, applied to the section properties at stiffness assembly (`weight` scales self-weight only).
- [ ] Optional `modifiers` on a `sections[]` entry, multiplied by any member-level modifiers.
- [ ] Validation: finite, $> 0$ (error 314 with the field located).
- [ ] Docs: table of typical ACI 318-19 Table 6.6.3.1.1 values ($0.35 I_g$ beams, $0.70 I_g$ columns, $0.70 I_g$ / $0.35 I_g$ uncracked / cracked walls) as guidance; the engine applies no defaults.
- [ ] Tests: modified member equals a member with scaled properties; self-weight unchanged unless `weight` is set.

### 1.5 Member Point Moments
- [ ] Member load type: `{ type: "moment", direction: "1" | "2" | "3" | "X" | "Y" | "Z", M: number, a: number }`.
- [ ] Fixed-end actions from beam shape-function derivatives evaluated at $a$; torsion shape functions for direction `"1"`.
- [ ] Diagrams: concentrated jump of $M$ at $a$, with left and right values reported.
- [ ] Tests: fixed-fixed beam with moment at midspan and arbitrary positions; subdivided-member oracle.

### 1.6 Combination Types
Replaces the earlier "envelope sets" item: an envelope combination does that job and also nests inside linear combinations, which named envelope sets cannot.

- [ ] `LoadCombination.type?: "linear" | "envelope"` (default `"linear"`).
  - `linear`: the current factored sum.
  - `envelope`: max/min of its terms (each factored), e.g. `WIND = Env(Wx+, Wx−, Wy+, Wy−)`.
- [ ] A linear combination may reference an envelope combination, e.g. `1.2D + 1.0L + 1.0·WIND`. The result is then a max/min pair, not one state: track `{ max, min }` raw states per result quantity and combine them term by term (positive factors keep max/min, negative factors swap them).
- [ ] `FeaCaseResult.kind` gains `"envelope"`; envelope results carry `max` / `min` instead of a single state, and no displaced shape.
- [ ] Keep the default `result.envelope` over all combinations unchanged.
- [ ] `memberDemandEnvelope(result, memberId, { combination?: string })` reads any combination, including envelope-type ones.
- [ ] Validation: existing 303 / 309 / 310 / 311 rules apply to the new type.
- [ ] Tests: envelope of one term equals that term; nested envelope matches manual max/min over expanded linear combinations; negative factor swaps bounds.

### 1.7 Null Area Robustness
- [ ] **Crossing beams**: detect members lying inside a null area (not on its edges). Today they silently receive no load — issue a warning naming the area and member. A later step can subdivide the area automatically (2.11).
- [ ] **Tolerances**: split `AREA_GEOMETRY_TOLERANCE` ($10^{-6} \times \text{size}$, [`fea.constant.ts`](src/core/constants/fea.constant.ts)) into:
  - [ ] `AREA_LENGTH_TOLERANCE`: absolute length (e.g. $1\text{ mm}$) for planarity and node-on-edge checks.
  - [ ] `AREA_ANGLE_TOLERANCE`: angle (e.g. $10^{-3}\text{ rad} \approx 0.06^\circ$) for parallel edges, square corners and convexity.
  - [ ] Keep $10^{-6} \times \text{size}$ only for true degeneracies (duplicate nodes, zero area).
- [ ] Slightly non-planar areas: distribute the load on the best-fit plane so the total stays exactly $q \cdot A$, and warn. Never move user nodes.
- [ ] Optional model-level tolerance override for imported CAD/BIM models.
- [ ] Tests: just-inside vs just-outside tolerance cases; equilibrium conservation; crossing-beam warning.

### 1.8 Verification Suite

The FEA part of the [Verification Report](#verification-report-all-modules), which sets out the infrastructure and the report page for all modules.
- [ ] `tests/fea/verification/` with one file per published problem, each citing its source.
- [ ] Sources: verification manuals of commercial analysis programs (frame problems), McGuire–Gallagher–Ziemian *Matrix Structural Analysis*, Kassimali *Matrix Analysis of Structures*.
- [ ] Coverage grows with each phase: 2D/3D frames, trusses, releases, springs, end offsets, diaphragms, P-Δ (AISC 360 Appendix benchmark frames), modal (periods of cantilever and shear-building benchmarks).
- [ ] A results table (problem, quantity, reference, engine, % difference) in `html-docs/fea/index.html`, with values produced by running the suite.

---

## Phase 2: Building Modelling Options

### 2.1 Member End Offsets (Rigid Joint Zones)
- [ ] `Member.endOffsets?: { start?: number, end?: number, rigidZoneFactor?: number }` (mm; factor 0–1, default 1).
- [ ] Rigid-link transformation applied to the member stiffness $\mathbf{K}_e$ and fixed-end load vector $\mathbf{F}_e$.
- [ ] Member loads inside a rigid offset go directly to the end node.
- [ ] Diagrams over the flexible clear span; face moments reported at column/beam faces.
- [ ] `memberDemandEnvelope` uses face moments for design (ACI 318-19 critical section at the support face).
- [ ] Docs: wide-column model for shear walls (column at the wall centreline, rigid beam stubs to the wall edges).
- [ ] Tests: portal frame joint vs explicit stiff member links (oracle).

### 2.2 Shear Deformation (Timoshenko Beam Element)
- [ ] `SectionProperties` gains optional shear areas $A_{s2}$, $A_{s3}$ (from 1.1 or user-given).
- [ ] `AnalyzeOptions.shearDeformation?: boolean` (default `false`, Euler–Bernoulli).
- [ ] Timoshenko 12×12 element stiffness with
  $$\Phi_2 = \frac{12 E I_{33}}{G A_{s2} L^2}, \quad \Phi_3 = \frac{12 E I_{22}}{G A_{s3} L^2}$$
- [ ] Fixed-end actions and deflection integration include shear distortion.
- [ ] Tests: deep cantilever tip deflection $\delta = \frac{P L^3}{3 E I} + \frac{P L}{G A_s}$; Euler–Bernoulli limit as $A_s \to \infty$; wall pier lateral stiffness.

### 2.3 Local Axes from a Reference Vector
- [ ] `Member.localAxis?: { refVector: [x, y, z] } | { refPoint: [x, y, z] }`: local 2 lies in the plane of local 1 and the reference, as an alternative to `angle`.
- [ ] Validation: reference not parallel to the member (error 314).
- [ ] Tests: equivalence with the matching `angle`; vertical and inclined members.

### 2.5 Distributed Member Moments
- [ ] Member load type: `{ type: "distributedMoment", axis: "2" | "3", m: number, start?: number, end?: number }`.
- [ ] Fixed-end actions by integrating the point-moment expressions along the loaded span.
- [ ] Diagrams: linear slope in $M$, no shear change.
- [ ] Enables cantilever null areas with in-plane load components along the support edge (removes the current 317 rejection).
- [ ] Tests: fixed-fixed beam under uniform moment; ramp cantilever area with edge parallel to slope.

### 2.6 Member Twist Reporting
- [ ] Twist $r_1$ (rad) in `MemberStation.r1`, `extremes.r1` and `StationComponent`.
- [ ] Integrate $\phi' = T / (G J)$ along the stations from the start node rotation, skipping released ends.
- [ ] Include $r_1$ in envelopes.
- [ ] Tests: fixed-fixed uniform torque $\phi_{max} = tL^2 / (8GJ)$; cantilever tip $\phi = tL^2 / (2GJ)$.

### 2.7 Support Settlement (Prescribed Displacements)
- [ ] `FeaModel.supportDisplacements?: { loadCase, nodeId, ux?, uy?, uz?, rx?, ry?, rz? }[]`.
- [ ] Partition free and prescribed DOFs: $\mathbf{F}_{free} \leftarrow \mathbf{F}_{free} - \mathbf{K}_{fr} \mathbf{u}_r$, assembled member by member without a dense $\mathbf{K}$.
- [ ] Reconstitute the full displacement vector for end forces and reactions.
- [ ] Error 319 `SETTLEMENT_ON_FREE_DOF` for a displacement on a free or spring DOF.
- [ ] Tests: fixed-fixed settlement ($M = 6EI\Delta/L^2$, $V = 12EI\Delta/L^3$), propped cantilever, continuous beam.

### 2.8 Temperature Loads
- [ ] Load type: `{ type: "temperature", deltaT?: number, gradient2?: number, gradient3?: number }` (gradients in °C/mm).
- [ ] Needs $\alpha$ on the member's material (1.1) or section.
- [ ] Fixed-end forces: $N = E A \alpha \Delta T$, $M_2 = E I_{22} \alpha \cdot \text{gradient}_3$, $M_3 = E I_{33} \alpha \cdot \text{gradient}_2$ (sign and axis pairing confirmed by tests).
- [ ] Diagrams subtract free thermal strain/curvature so unrestrained members deflect without internal forces.
- [ ] Error 320 `MISSING_THERMAL_COEFFICIENT`.
- [ ] Tests: restrained bar, free cantilever expansion and curvature without force, long-building frame under uniform $\Delta T$.

### 2.9 Skewed Supports
- [ ] `Restraint.axes?: { angle } | { refVector }`: restraints and springs act in a rotated local system at the node.
- [ ] Reactions reported in both the skewed system and global axes.
- [ ] Tests: roller on an inclined plane vs equivalent inclined stiff link; rotated restraint equal to global when the angle is 0.

### 2.10 Live-Load Patterning Helper
Generates load cases (not code combinations), so it fits the "user-specified factors" rule.

- [ ] `patternLiveLoads(model, { loadCase, spans | areas, patterns })` returns a model with extra cases for the ACI 318-19 6.4.3 arrangements (adjacent spans loaded, alternate spans loaded) and an envelope combination (1.6) over them.
- [ ] Spans identified by member chains or null-area groups the caller gives; no automatic span detection.
- [ ] Tests: three-span continuous beam vs textbook pattern moments.

### 2.11 Null Area Extensions
- [ ] Automatic subdivision of areas crossed by interior beams (follows the 1.7 warning).
- [ ] Arbitrary convex polygons: allow $N \ge 5$ vertices (half-plane clipping already supports them).
- [ ] Varying-depth cantilevers: triangular/trapezoidal cantilever slabs via linear torque loads.
- [ ] One-way trapezoids: parallel-edge one-way distribution with non-parallel sides.
- [ ] Relax or formalise the edge-member requirement along zero-load parallel edges of one-way slabs.

---

## Phase 3: Lateral System Behaviour

### 3.1 General Nodal Constraints
The shared transformation mechanism behind diaphragms (3.2), and usable on its own for equal-DOF ties and rigid links.

- [ ] `FeaModel.constraints?: ({ id, type: "equalDof", nodeIds, dofs } | { id, type: "rigidBody", nodeIds, dofs? })[]`.
- [ ] Master–slave elimination: slave DOFs expressed through master DOFs by a transformation $\mathbf{T}$, applied element by element so no dense matrix is formed.
- [ ] Master DOFs enter the RCM adjacency next to their slaves so the profile stays narrow.
- [ ] Error 321 `INVALID_CONSTRAINT`: node in two conflicting constraints, constrained DOF that is also fixed, or a cycle.
- [ ] Tests: equal-DOF tie vs very stiff link; rigid body vs stiff member cage.

### 3.2 Rigid Floor Diaphragms & Story Results
- [ ] `FeaModel.diaphragms?: { id, nodeIds }[]` (all nodes at one elevation), implemented as a 3.1 constraint:
  - Master at the diaphragm centroid $(x_m, y_m)$ with DOFs $(U_X, U_Y, R_Z)$.
  - Slave $(x_i, y_i)$: $u_{xi} = U_X - (y_i - y_m) R_Z$, $u_{yi} = U_Y + (x_i - x_m) R_Z$, $r_{zi} = R_Z$.
  - Out-of-plane DOFs $(u_z, r_x, r_y)$ stay independent.
- [ ] Diaphragm loads: `FeaModel.diaphragmLoads?: { loadCase, diaphragmId, fx?, fy?, mz?, eccentricity? }[]`. Story forces from the user's ELF or wind calculation, with an optional accidental eccentricity offset (e.g. ASCE 7-22 12.8.4.2 ±5 %) turned into $m_z$.
- [ ] Results:
  - [ ] Diaphragm master displacements per case/combination.
  - [ ] Story drift and drift ratio between consecutive diaphragms; maximum vs average drift at the extreme corners (torsional irregularity check input, ASCE 7-22 Table 12.3-1).
  - [ ] Story shear and overturning moment from the column/wall/brace forces cut at each level.
- [ ] Error 321 also covers diaphragm conflicts (node in two diaphragms, in-plane DOF already fixed, nodes not coplanar).
- [ ] Tests: multistory frame lateral load vs stiff-truss bracing oracle; eccentric floor torsion; story shear equals applied lateral load.

### 3.3 Linearized P-Δ
- [ ] `AnalyzeOptions.pDelta?: { terms: CombinationTerm[], iterate?: boolean }`: the gravity load set that sets member axial forces (e.g. $1.2D + 0.5L$ as in common practice).
- [ ] Solve that set first (optionally iterating until the axial forces converge), build the member geometric stiffness $\mathbf{K}_g$ (consistent 12×12, P-Δ only), then factorise $\mathbf{K} + \mathbf{K}_g$ once and solve every case against it. Results stay linear, so combinations stay exact.
- [ ] Member P-δ is not captured inside one element: document that members should be subdivided where P-δ matters, and warn for slender compression members.
- [ ] `calculationDetails.pDelta`: axial forces used, iteration count, and per-story amplification (second-order / first-order drift) when diaphragms exist.
- [ ] Warning when amplification exceeds the ACI 318-19 limit of 1.4 × first-order effects (confirm clause — see Technical Debt).
- [ ] Error 323 `GEOMETRIC_INSTABILITY` when $\mathbf{K} + \mathbf{K}_g$ is not positive definite (P-Δ set exceeds the buckling load).
- [ ] Tests: AISC 360-22 Commentary Appendix 8 benchmark cases (cantilever column, braced column); leaning-column frame; amplification vs $1/(1 - P/P_e)$.

---

## Phase 4: Dynamics & Stability

### 4.1 Mass Source & Mass Matrix
- [ ] `FeaModel.massSource?: { selfWeight?: boolean, loadCases?: { case, factor }[], nodalMasses?: { nodeId, mx, my, mz, mrx?, mry?, mrz? }[] }`. Gravity loads (kN) are converted to mass by $g$.
- [ ] Lumped mass matrix (diagonal, translational) built from member self-weight (honouring `modifiers.weight`) and the mass-source loads, distributed to member ends.
- [ ] Diaphragm masters get translational mass plus rotational inertia $\sum m_i r_i^2$ about the master.
- [ ] Mass units stated explicitly (kN·s²/mm internally; reported in tonnes).
- [ ] Error 324 `NO_MASS` when a modal analysis finds no mass on any free DOF.

### 4.2 Eigensolver & Modal Analysis
- [ ] `analyzeModal(model, { modes, options? })` (or a method on `createAnalysis`), reusing the skyline $\mathbf{L}\mathbf{D}\mathbf{L}^T$ factorisation.
- [ ] Subspace iteration (or shifted block Lanczos) for the lowest $n$ modes, with a Sturm-sequence check (count of negative pivots in $\mathbf{K} - \sigma \mathbf{M}$) to confirm no mode was missed.
- [ ] Results: periods, frequencies, mode shapes (normalised to unit modal mass), participation factors and modal participating mass ratios in UX, UY, RZ with cumulative sums (ASCE 7-22 12.9.1.1 90 % mass check input).
- [ ] Optional: modal analysis on the P-Δ stiffness $\mathbf{K} + \mathbf{K}_g$.
- [ ] Error 325 `EIGEN_NOT_CONVERGED`.
- [ ] Tests: cantilever column (closed-form frequencies), shear building (known periods), sum of all mass ratios = 100 %.

### 4.3 Linear Buckling
- [ ] `analyzeBuckling(model, { terms, modes })`: solve $\mathbf{K}\boldsymbol{\phi} = -\lambda \mathbf{K}_g \boldsymbol{\phi}$ for critical load factors, using 3.3's $\mathbf{K}_g$ and 4.2's eigensolver.
- [ ] Results: buckling factors and mode shapes.
- [ ] Tests: Euler column cases ($K = 0.5, 0.7, 1, 2$), portal frame sway buckling.

### 4.4 Response Spectrum Analysis
- [ ] `FeaModel.responseSpectra?: { id, direction: "X" | "Y" | "Z", function: { T, Sa }[], scale?, damping?, modalCombination: "CQC" | "SRSS", directionalCombination?: "SRSS" | "100-30" }[]`. The spectrum is user-given T–Sa pairs, so the engine stays code-agnostic.
- [ ] Peak modal responses combined per mode, then across directions; results are unsigned peaks.
- [ ] Spectrum cases are usable as terms of envelope combinations (1.6), entering as $\pm$ the peak.
- [ ] Results include base shear per spectrum for the user's scaling to ELF (ASCE 7-22 12.9.1.4); the scale factor is an input.
- [ ] Tests: SDOF exactness, two-mode CQC vs hand calculation, closely spaced modes (CQC vs SRSS difference).

---

## Phase 5: Shell Elements

Flat four-node shell elements with membrane, plate and shell behaviour, so walls, cores, transfer slabs and mats can be modelled with their own stiffness. The theory, the chosen formulations and the benchmark values are in [html-docs/fea/theory/shell-element.html](html-docs/fea/theory/shell-element.html). Phase 5 does not depend on Phases 1–4 and is being worked first. Null areas stay as they are; shells are opt-in, used only where a surface's stiffness matters.

**API decisions**
- **Behaviour on the area**: `ShellArea.type?: "shell" | "membrane" | "plate"` (default `"shell"`).
- **Section inline on each area**: `ShellArea.section: { thickness, E, nu, unitWeight? }`, like `Member.section`. When 1.1 lands, `ShellArea.sectionId` references a shell entry (thickness and material) in `FeaModel.sections`, and exactly one of the two is given.
- **Loads through `AreaLoad`**: `areaId` may name a null area or a shell area (one id namespace across `areas` and `shells`). Loads are routed by the kind of area: null-area loads go to the edge members through `distributeAreaLoads` as today; shell loads become equivalent nodal loads on the shell elements. `distributeAreaLoads` ignores loads on shells.
- **Unsupported DOFs are errors at model nodes, held at generated nodes (interim, see Technical Debt)**: a translation that nothing resists at a model node connected only to membrane (or only to plate) shells throws 328, naming the node, a shell and the DOF, with a message that explains the behaviour (a membrane has no out-of-plane stiffness; a plate has no in-plane stiffness). At a generated mesh node, which no restraint can name, it is held and reported in `autoRestrainedTranslations`, and a load along it throws 332. Unresisted rotations there are held as at truss joints and reported in `autoRestrainedDofs`.

### 5.0 Generic Element Assembly (Refactor)
- [x] Assembly, RCM adjacency, skyline profile and auto-restraint take elements with any number of nodes (6 DOFs each) instead of 2-node members.
- [x] Members keep their own data (`T`, releases, fixed-end forces) for loads and post-processing.
- [x] Tests: the existing suite passes unchanged; the raw and presented results of all 113 analyses the suite runs are bit-for-bit identical before and after; `tests/fea/shared/global-assembly.test.ts` covers elements with more than 2 nodes.

### 5.1 Membrane Element
- [x] [`shell/elements/quad-geometry.ts`](src/fea/shell/elements/quad-geometry.ts): bilinear and mid-side shape functions, Jacobian, 2×2 and 3×3 Gauss rules.
- [x] [`shell/elements/membrane-quad.ts`](src/fea/shell/elements/membrane-quad.ts): drilling quad after Ibrahimbegovic–Taylor–Wilson (Allman edge terms plus Hughes–Brezzi penalty, $\gamma = G$), 12×12 over $u, v, \theta_z$; strain rows exposed for stress recovery (5.5).
  - Strain energy at 3×3 points: with 2×2 a rectangle has a fourth zero-energy mode (alternating corner rotations whose normal strains vanish at the 2×2 points).
  - Penalty at one point (the centre): with 2×2 distorted elements lock as $\gamma$ grows (trapezoidal cantilever 0.0848 at $G$, 0.0323 at $100G$); at the centre results change by < 0.3 % over $0.01G$–$100G$.
- [x] `DRILLING_PENALTY_RATIO` in [`shell.constant.ts`](src/core/constants/shell.constant.ts) (not re-exported yet).
- [x] Tests in [`tests/fea/shell/`](tests/fea/shell/) (dense-solve harness, no model integration): symmetry, exactly 3 rigid-body modes (rectangle and distorted), tensor transformation and corner-order invariance; MacNeal–Harder patch test (exact field, θ = ω, $\sigma_x = \sigma_y = 1333.3$, $\tau_{xy} = 400$); straight cantilever 0.0977 / 0.0931 / 0.0829 (regular / parallelogram / trapezoidal, reference 0.1081 — a flipped edge-term sign gives 0.0031); penalty insensitivity; Cook's membrane converging from below to ≈ 25.2, where a bilinear quad and an independent 9-node element also converge; this is above the 23.9–23.96 usually quoted for the problem, a difference not yet explained (see Technical Debt).

### 5.2 DKQ Plate Element
- [x] [`shell/elements/dkq-plate.ts`](src/fea/shell/elements/dkq-plate.ts): Batoz–Ben Tahar discrete Kirchhoff quadrilateral, 12×12 over $w, \theta_x, \theta_y$ ($\theta_x = w_{,y}$, $\theta_y = -w_{,x}$), 2×2 Gauss; curvature rows exposed for moment recovery (5.5).
- [x] [`quad-geometry.ts`](src/fea/shell/elements/quad-geometry.ts) gains the 8-node serendipity functions and `cornerAreas` ($\int N_i\,dA$, for the load vectors of 5.4).
- [x] Tests in [`tests/fea/shell/dkq-plate.test.ts`](tests/fea/shell/dkq-plate.test.ts): symmetry; exactly 3 rigid-body modes (rectangle and distorted); tensor transformation, corner-order invariance, $t^3$ scaling; MacNeal–Harder plate patch test (exact field and moments); square plate, simply supported uniform ($w_c$ 0.003785 → 0.004062 for 2–16 elements per side, $M_c$ within 0.5 % of $0.0479\,qa^2$), clamped uniform (from above, within 2 % of $0.00126\,qa^4/D$, $M_c$ within 1 % of $0.0231\,qa^2$), centre point load (within 1 % of $0.0116\,Pa^2/D$); no locking ($w_c$ identical for $t/a = 0.01$ and $0.3$); straight cantilever, out-of-plane shear 0.4263 / 0.4266 / 0.4261 (regular / trapezoidal / parallelogram, reference 0.4321).

### 5.3 Flat Shell Element
- [x] [`shell/elements/shell-axes.ts`](src/fea/shell/elements/shell-axes.ts): local 3 = unit $\mathbf{d}_1 \times \mathbf{d}_2$ (the right-hand rule around the nodes, as for null areas); local 2 = +Z projected onto the plane for non-horizontal elements, local 1 = +X for horizontal ones (a wall in the XZ plane gets the axes of a member along +X); optional `angle`; corners projected onto the mean plane and their offsets $\pm h$.
- [x] [`shell/elements/flat-shell.ts`](src/fea/shell/elements/flat-shell.ts): membrane on $u_1, u_2, r_3$ and DKQ on $u_3, r_1, r_2$ in a 24×24 local matrix; `type` `"shell" | "membrane" | "plate"`; per-corner 6×6 transformations ($\lambda$ plus the rigid link $-h r_2 \to u_1$, $+h r_1 \to u_2$) applied block by block.
- [x] [`shell/elements/rigidity.ts`](src/fea/shell/elements/rigidity.ts): stiffness modifiers as $\mathbf{S D S}$, $\mathbf{S} = \mathrm{diag}(\sqrt{f_{11}}, \sqrt{f_{22}}, \sqrt{f_{12}})$, on both the membrane and the plate rigidity (so 5.5's stress recovery uses the same modified $\mathbf{D}$); the drilling penalty keeps the unmodified $G$.
- [x] Tests in [`tests/fea/shell/`](tests/fea/shell/) (`shell-axes`, `flat-shell`, 6-DOF dense harness): axes for horizontal, wall, inclined and warped elements; part placement and `type` switch; symmetry; exactly 6 rigid-body modes for flat and warped elements (and a warped element without the links fails); $\mathbf{k}(R\mathbf{x}) = R\,\mathbf{k}(\mathbf{x})\,R^T$; `angle` irrelevant without modifiers, and a 90° `angle` swaps the 11 and 22 modifiers; $\mathbf{SDS}$ values; the straight cantilever as a 3D shell equals the 2D elements and is unchanged by a 3D rotation; MacNeal–Harder twisted beam within 1 % for both thicknesses and load directions.

### 5.4 Shells in the Model
- [x] Types `ShellArea`, `ShellSection`, `ShellModifiers` (`f11, f22, f12, m11, m22, m12, weight`), `ShellType`, `FeaModel.shells` ([`shell/types/model.type.ts`](src/fea/shell/types/model.type.ts)); one shell area is one element until 5.6.
- [x] Validation in [`validate-model.ts`](src/fea/analysis/validation/validate-model.ts): geometry (4 distinct nodes, convex in order: $\det \mathbf{J} > 0$ at every corner, warping $\le$ `SHELL_WARPING_LIMIT` $= 0.1\sqrt{A}$) → 326; section → 327; `type`, `angle`, modifiers → 314; duplicate ids across `areas` and `shells` → 303; self-weight without `unitWeight` → 313; `details.shellId`.
- [x] System ([`analysis-system.ts`](src/fea/analysis/solver/analysis-system.ts)): `SystemShell`s assembled with the members (shell adjacency added once per pair, so member-only models are bit-identical); 328 from `findUnresistedTranslations` (eigen-check of the translational block at nodes connected only to shells, before factorisation). Unresisted rotations stay with auto-restraint.
- [x] Loads ([`load-case-solver.ts`](src/fea/analysis/solver/load-case-solver.ts)): `AreaLoad`s routed by id (shell loads to the shells; `areaMemberLoads` and `distributeAreaLoads` skip them), self-weight `selfWeight · unitWeight · thickness · weight`, all as corner forces $q \int N_i\,dA$ without offset moments; shells' $\mathbf{k u}$ added into the reactions.
- [x] Tests in [`tests/fea/shell/shell-model.test.ts`](tests/fea/shell/shell-model.test.ts): every validation error with its location; 328 for membrane walls and plate slabs, not where two membranes meet at an angle; equilibrium of self-weight, projected and normal loads; `weight` modifier; superposition; Scordelis–Lo roof (from above, 16 × 16 within 1 % of 0.3024); pinched cylinder (16 × 16 octant within 2 %); 2 × 6 m wall within 1 % of beam theory with shear; beam framing into a near-rigid wall equals $PL^3/3EI$ (moment through the drilling DOF); simply supported plate slab within 0.2 % of Timoshenko, 4× softer with $m = 0.25$.
- [x] Docs: FEA reference (shell section, types, conventions, errors), README, CHANGELOG, theory page status.

### 5.5 Shell Results & First Release
- [x] [`shell/post/shell-forces.ts`](src/fea/shell/post/shell-forces.ts): per element, corner values of F11, F22, F12 (kN/m), M11, M22, M12 (kN·m/m, positive with the −3 face in tension) and V13, V23 (kN/m, $V_{13} = -(\partial M_{11}/\partial x_1 + \partial M_{12}/\partial x_2)$ on the bilinear field through the Gauss-point moments), from the 2×2 Gauss points extrapolated to the corners; face stresses $F/t \mp 6M/t^2$ (MPa). Modified rigidity, so cracked forces are consistent.
- [x] Unrounded `RawState.shellForces` (8 per corner), superposed in combinations; rounding only in [`post/present-state.ts`](src/fea/analysis/post/present-state.ts).
- [x] `FeaCaseResult.shellForces`; envelope `shells` with max/min per corner and governing combination; `calculationDetails.shellCount`; `units.forcePerLength`, `momentPerLength`, `stress`. Types `ShellElementForces`, `ShellCornerForces`, `ShellForceComponent`.
- [x] Tests in [`tests/fea/shell/shell-forces.test.ts`](tests/fea/shell/shell-forces.test.ts): cantilever strip (M11 linear and V13 constant exactly, sign of moments, shears and face stresses, uniform end moment, axial force), local axes via `angle`, determinate forces unchanged by modifiers, membrane/plate parts zero, square plate 16 × 16 (centre 0.0480 / 0.0233 qa², clamped edge −0.0512 qa² against 0.0479 / 0.0231 / −0.0513), superposition, envelope, counts and units.
- [x] Docs: FEA reference (results, types, example with real outputs), theory page, README, CHANGELOG.
- [x] Released together with 5.4 and 5.6 as **3.0.0** (a major version to mark shell element analysis; no breaking changes).

### 5.6 Engine Meshing
API decisions: supports along meshed edges by line restraints; members along meshed edges split internally with results under their own id; results per generated element plus `result.mesh`.

- [x] 5.6a [`shell/mesh/mesh-shells.ts`](src/fea/shell/mesh/mesh-shells.ts): `ShellArea.mesh?: { maxSize?, divisions? }`; area edges cut into segments at model nodes lying on them (hard points, T-junctions); per-segment division counts raised until opposite edges of every area add up equally (the chord rule generalised to multi-segment edges), extra divisions where elements are longest; even segment spacing and transfinite interpolation inside; ids `"<a>~<b>:<k>"`, `"<areaId>:<i>,<j>"`; an area that stays 1 × 1 keeps its id; 329 for no balance, a bad generated element or an id clash.
- [x] [`analysis/mesh/expand-model.ts`](src/fea/analysis/mesh/expand-model.ts): the analysed model (generated nodes, elements with `areaId`, `lineRestraints` spread to every node on the line, members marked with the generated nodes inside them); warning for a member node inside an area but not on its mesh. `AreaLoad` on an area loads all its elements.
- [x] Results: displacements and reactions include generated nodes; `ShellElementForces.areaId`; `result.mesh: FeaMesh`; `calculationDetails.nodeCount` counts generated nodes, `memberCount` model members, `shellCount` elements.
- [x] 5.6b members along meshed edges: `MemberGroup`s of pieces in [`analysis-system.ts`](src/fea/analysis/solver/analysis-system.ts) (releases only at real ends), member loads resolved on the whole member then clipped to pieces, end forces from the first/last piece, `chainDiagram` stitches the pieces' diagrams; unsplit members take the old code path (frame-only raw results bit-for-bit identical).
- [x] Tests in [`tests/fea/shell/shell-mesh.test.ts`](tests/fea/shell/shell-mesh.test.ts): counts and ids, generated nodes in results, equality with the same mesh entered element by element, `divisions` as a minimum, conforming T-junction with different mesh sizes, edge beams split vs split by hand (identical displacements, end forces, diagram extremes, releases), stitched and on-demand diagrams, validation (314, 302, 329), the disconnected-node warning. A 4 × 4-bay slab on beams (1 600 elements, 10 236 DOFs) analyses in about 1.1 s.
- [x] Docs: FEA reference (meshing rules, example, `ShellMesh`, `LineRestraint`, `FeaMesh`, 329), theory page, README, CHANGELOG.

### 5.7 Thick Plates
- [ ] `ShellArea.plateTheory?: "thin" | "thick"` (default `"thin"`), using DKMQ (reuses the DKQ code) or MITC4, chosen after 5.2.
- [ ] Tests: thick-plate benchmarks; the thin limit matches DKQ; no shear locking at $t/a = 10^{-3}$.

### 5.8 Triangular Shells & Openings
- [ ] 3-node shells: DKT plate with an Allman triangle membrane; triangular areas in the mesher.
- [ ] Openings: documented approach (divide the area around the opening) or automatic subdivision.

### 5.9 Strip Forces
API decisions: strips are a field on the model (`FeaModel.strips`), so `analyze` returns their forces for every case and combination from the unrounded shell forces; a strip is a centreline polyline with left and right widths, as design strips; it picks up every shell element in its plane; each element's own force field is integrated (no nodal averaging); a cut not fully on shells integrates what it covers and warns.

- [x] Types `ShellStrip` (`id`, `points`, `widthLeft`, `widthRight`, `normal?` default +Z, `maxSpacing?`), `StripPoint` ([`shell/types/model.type.ts`](src/fea/shell/types/model.type.ts)); results `StripForces`, `StripStation`, `StripResultants`, `StripForceComponent`, `StripExtremeValue` ([`shell/types/results.type.ts`](src/fea/shell/types/results.type.ts)).
- [x] [`shell/post/strip-forces.ts`](src/fea/shell/post/strip-forces.ts): elements in the strip's plane (corners within `STRIP_PLANE_TOLERANCE` = 10⁻³ of the element size); stations at every polyline point and at most `maxSpacing` apart (default `STRIP_DEFAULT_DIVISIONS` = 20 per segment), two at a bend; cut clipped to each element (Cyrus–Beck), mean of both sides on a mesh line; inverse bilinear map; forces rotated to the strip axes (σ = ±1 for the element's local 3 against the normal); 4-point Gauss–Legendre per piece. Resultants P, V, M, T, Vp, Mp and `perWidth`, as fixed coefficients on the raw corner forces, so combinations superpose exactly.
- [x] Shear and torsion Kirchhoff-consistent, element by element: $V = -\int \partial M_{aa}/\partial a\,ds$, $T = \int (2 m_{ab} - s\,\partial M_{aa}/\partial a)\,ds$. Plain $\int Q_a$ was 8 % low on a one-way slab (twisting at the free edges); with this form $V = -dM/dx$ exactly and full-width cuts match statics.
- [x] `FeaCaseResult.stripForces`, `FeaEnvelope.strips` (max/min per station and per width, and over the strip); coverage warning; validation in [`shell/validation/validate-strips.ts`](src/fea/shell/validation/validate-strips.ts): 330, 314, 303 with `details.stripId`.
- [x] Tests in [`tests/fea/shell/strip-forces.test.ts`](tests/fea/shell/strip-forces.test.ts): simply supported one-way slab (M = 90 kN·m, V = −30 kN at quarter span, exact), cantilever corner load (V, M, T = −10, −15, −10.01), pure twist (T = −20.03 against −20), in-plane load (P, Vp, Mp within 0.2 %), reversed strip, clockwise shells, shell `angle`, half strips adding up, partial coverage, other plane, combinations and envelope, validation, geometry helpers.
- [x] Docs: [strip forces theory notes](html-docs/fea/theory/strip-forces.html) (with a "Points for review" table), FEA reference (section, types, 330), README, CHANGELOG; the shell element notes moved to `html-docs/fea/theory/` (old address redirects).
- [ ] Not yet released (in `[Unreleased]`).
- [x] V and T recovered along the strip: straight lines through the element centres, extended to supports and ends, never across a jump (a support, member, nodal load or wall in the band). V at a support now matches statics (−60 kN, was −55 kN on a 500 mm mesh).

### 5.10 Pier & Spandrel Forces
Design forces for shear walls, as piers and spandrels: one resultant per cut across a whole wall group (planar, L, C or core, columns included), for wall design (ACI 318-19 11.5, 18.10) and coupling beams (18.10.7). Strips (5.9) already work on a single planar wall (`normal` horizontal: `P`, `Vp`, `Mp`); document that, and use piers for anything grouped or non-planar.

API decisions:
- **Groups on the model**: `FeaModel.piers?: WallPier[]` and `FeaModel.spandrels?: WallSpandrel[]`, each `{ id, areaIds, memberIds?, cuts? }`, plus `angle?` on a pier and `reverse?` on a spandrel. Members count in the resultant (boundary and embedded columns in piers, beams in spandrels). An area may be in one pier and one spandrel at the same time, never in two piers or two spandrels; members likewise.
- **Cuts**: automatic at the group's area boundaries plus optional extra ones (`cuts`: elevations in mm for a pier, distances from the left end in mm for a spandrel). Pier: the *bottom* and *top* of each lift, a lift running between consecutive elevations where any of the pier's areas starts or ends. A floor level shared by two lifts therefore gives two cuts, the lower lift's top (elements below) and the upper lift's bottom (elements above); they differ by what the floor delivers there. Spandrel: left and right ends. A user cut inside an area gives one value, since both sides match.
- **Method: nodal-force summation**, not stress integration. At a cut, sum the element nodal forces ($\mathbf{f}_e = \mathbf{k}_e \mathbf{u}_e - \mathbf{f}_{e,\text{load}}$) of the group's shell elements on the lift's side at the nodes on the cut, plus the internal forces of the group's members where they cross the cut (end forces at a member end, the diagram station otherwise), and transfer the total to the reference point. Exact equilibrium, the same for non-planar sections and members, and linear in the loads (computed from each `RawState`, so combinations superpose).
- **Separate legs**: a pier cut may cross several disconnected legs (e.g. two walls either side of a door); their forces are summed about the centroid of the whole cut.
- **Reference point**: the geometric centroid of the cut, shell legs weighted by length × thickness and members by section area A (geometric, not modulus-weighted).
- **Axes**: pier 1 = global +Z (up); 2 = along the longest shell leg of the cut, or global X rotated by `angle` (rad, about +Z) when given; 3 = 1 × 2. Spandrel 1 = horizontal along the wall plane, pointing toward +X (toward +Y for a wall parallel to Y), reversed by `reverse: true`; its *left* end is where 1 starts. 2 = global +Z; 3 = 1 × 2, out of the wall plane.
- **Signs: as member diagrams** (`MemberStation`): forces act on the +1 face of the cut, the axial force named `P` (as `StripResultants`, where members say `N`), positive in tension, `V2`, `V3`, `T`, `M2`, `M3` as on a member with the same local axes. A pier reads like a column and a spandrel like a beam with the same orientation.
- **Results per cut**: `P`, `V2`, `V3`, `T`, `M2`, `M3` (kN, kN·m), the position (`z` for a pier, `x` from the left end for a spandrel, mm), the face (`"bottom"` / `"top"` / `"cut"` for piers, `"left"` / `"right"` / `"cut"` for spandrels) and the cut section: each shell leg (end points, thickness), each member (id, position, A), and the total length, area and centroid. That is enough for a front end or a later wall P–M design to rebuild the section.
- **Placement**: [`analysis/`](src/fea/analysis/), because piers mix members and shells and `frame`/`shell` cannot see each other: types in `analysis/types/`, `analysis/post/wall-forces.ts`, `analysis/validation/validate-walls.ts`. Element nodal forces come from the factorised system's element stiffness and the per-case element loads.
- **Validation**: new error **331** `INVALID_PIER_GEOMETRY` with `details.pierId` / `details.spandrelId` (and `areaId`, `memberId`, `z` where they help locate it):
  - unknown area or member id; an area or member in two piers (or in two spandrels); an empty group;
  - a pier area that is not vertical (normal horizontal within tolerance);
  - spandrel areas not all in one vertical plane;
  - a pier area spanning a cut elevation with no mesh line there (staggered lifts, or a user cut that misses the mesh): the user splits the area; results stay exact;
  - an extra cut that reaches no element of the group; an invalid `cuts`, `angle` or `reverse` value (314), an id used twice (303).
- **Release**: ships together with strip forces in the next minor version (3.4.0); no breaking changes.

- [x] Types `WallPier`, `WallSpandrel` ([`analysis/types/model.type.ts`](src/fea/analysis/types/model.type.ts)); results `PierForces`, `PierCut`, `PierCutFace`, `SpandrelForces`, `SpandrelCut`, `SpandrelCutFace`, `WallResultants`, `WallForceComponent`, `WallCutSection`, `WallSectionLeg`, `WallSectionMember` ([`analysis/types/results.type.ts`](src/fea/analysis/types/results.type.ts)); error 331 and `FeaErrorDetails.pierId`, `spandrelId`, `position` in [`fea.error.ts`](src/core/errors/fea.error.ts); constants `WALL_VERTICAL_TOLERANCE` = 10⁻³, `WALL_CUT_TOLERANCE` = 10⁻⁶.
- [x] Validation (331, 314, 303) in [`analysis/validation/validate-walls.ts`](src/fea/analysis/validation/validate-walls.ts), called from `validateModel` on the meshed model (`validateShellMesh` now also returns the mesh), so mesh-line problems are reported before analysing.
- [x] Element nodal forces from the raw state: `RawState.shellPressures` (each element's surface load, returned by `addShellLoads`) gives $\mathbf{k}_e\mathbf{u}_e - \mathbf{f}_e$; member pieces use their end forces, and `memberInternalForces` (exported from [`member-diagram.ts`](src/fea/frame/post/member-diagram.ts)) gives the forces where a member crosses a cut.
- [x] [`analysis/post/wall-geometry.ts`](src/fea/analysis/post/wall-geometry.ts) (axes, levels, faces, mesh-line check) and [`analysis/post/wall-forces.ts`](src/fea/analysis/post/wall-forces.ts) (cut terms, legs, centroid, resultants). Pier axis 2 is one direction per pier, from its area of largest horizontal extent.
- [x] `FeaCaseResult.pierForces`, `FeaCaseResult.spandrelForces`, `FeaEnvelope.piers`, `FeaEnvelope.spandrels` (max/min of each component per cut, with the governing combination).
- [x] Tests in [`tests/fea/analysis/wall-forces.test.ts`](tests/fea/analysis/wall-forces.test.ts): planar cantilever wall, unmeshed and meshed (every cut against statics: −200 kN, 100 kN, 600 / 300 / 0 kN·m); a floor load between the top and bottom of a level; self-weight per lift; an extra cut against a vertical strip (pier exact, strip −199.82 / 100.71 / 449.80 against −200 / 100 / 450); `angle`; L-shaped core under biaxial load and torsion (exact statics about (500, 500)); two separate legs equal to the two single-leg piers moved to the common centroid; a boundary column (A in the centroid); a column-only pier equal to the member diagram, between nodes too; coupled walls with a spandrel (constant V2 = 50.85 kN, V2 = (M3L − M3R)/L, antisymmetric end moments); `reverse`; combinations and envelope; every 331, 314 and 303 case, staggered lifts included.
- [x] Docs: [theory notes](html-docs/fea/theory/pier-spandrel.html) (with a "Points for review" table), FEA reference (section with a real coupled-wall example, types, 331, the strips-on-walls note), README, CHANGELOG.
- [ ] Not yet released (in `[Unreleased]`, with strip forces).

---

## Technical Debt & Pending Verifications

- [ ] **Meshed plate and membrane areas: replace the interim fix** (accepted for now, 2026-11-09, so these areas can run). Translations they do not resist are held at generated nodes only (`autoRestrainedTranslations`, error 332 for a load along one). The mechanics are sound: a zero-stiffness direction is decoupled from every other DOF. The rest is still to do:
  - **Near-flat and warped plates**: a uniform slope of 1:100000 or a corner 0.001 mm off plane is rejected under gravity (332), and a corner 10 mm off plane on a 4 × 4 m slab fails as unstable (304). Treat nearly flat meshes as flat, with a stated tolerance.
  - **Loads a plate cannot carry**: take the normal component and ignore the rest only on near-flat slabs. Dropping it removes about s² of the vertical load at slope s (0.01 % at 1:100, 25 % at 30°), so keep the error on real slopes.
  - **Membranes under gravity without members on every edge, or not flat**: [`membrane-tributary-loads.ts`](src/fea/analysis/solver/membrane-tributary-loads.ts) distributes the load only with members along all four edges. Decide what these areas should do; a meshed one throws 332 today.
  - **Membrane mesh on beams with bending end releases**: throws 304 at `divisions: [2, 2]`, though the same model runs with no releases or as `"plate"` or `"shell"`. Find out why.
  - **Same rule at every node**: model nodes still throw 328 for the same DOF that is held at a generated node. Decide between holding everywhere and restraints inherited from the parent area.
  - **Front-end**: the held zeros are not real displacements (a plate on columns under lateral load reported 0 at an interior node while its corner moved 10.24 mm), so hide them in deformed shapes.
  - **Verification**: so far only flat rectangular meshes compared with the engine's own `"shell"` type. Add independent benchmarks, including inclined held directions.
  - **Check against commercial building software, not yet done**: the sources do not settle how such software treats interior joints of a meshed plate floor. Run a 6 × 6 m, 200 mm plate slab on four corner columns with auto mesh and read interior `ux` under lateral load, then a membrane slab on edge beams and read the beam moments under gravity.
  - **References**: analysis manuals of commercial software say the user must restrain these DOFs or make them unavailable, and that meshed elements can inherit the parent's restraints; their floor-meshing help describes membrane slabs using tributary area; [Pamidi & Turner, NASA N87-27232](https://ntrs.nasa.gov/api/citations/19870017799/downloads/19870017799.pdf) describes automatic single-point constraints in a general finite element code.
- [ ] **Member local-axis convention check**: confirm the local 3 rule ($1 \times Z$ for non-vertical, $+X$ for vertical) against commercial building software.
- [ ] **Cook's membrane reference**: our plane-stress set-up (E = 1, ν = 1/3, t = 1, unit uniform shear) converges to ≈ 25.2 with three element types, against the published 23.9–23.96. Find the published set-up (load distribution, ν, mesh) before quoting a value in the docs.
- [ ] **Shell stiffness modifiers vs commercial software**: we apply f11/f22 (and m11/m22) as $\mathbf{SDS}$, so the Poisson coupling scales by $\sqrt{f_{11} f_{22}}$; confirm how commercial software treats the coupling term before claiming equivalence.
- [ ] **Mesher search cost**: hard points (every node against every area edge) and member splits (every member against every generated node) are brute force; add a spatial index if large models slow down (they take about 12 ms of the 1 600-element benchmark's 1.1 s).
- [ ] **Area local-axis convention check**: confirm the shell local 1/2 default (5.3) against commercial building software.
- [ ] **ACI 318-19 Table 6.6.3.1.1 verification**: confirm the cracked moment of inertia factors before quoting them in the 1.2 docs and in [`src/rc/`](src/rc/).
- [ ] **ACI 318-19 second-order limit**: confirm the clause number of the 1.4 × first-order moment limit used by the 3.3 warning.
- [ ] **Null area distribution assumptions**: confirm with practising structural engineers whether two-way bisector or moment-coefficient methods are expected.
- [ ] **Documentation layout fixes**:
  - Fix horizontal scroll on tables with long descriptions in [html-docs/fea/index.html](html-docs/fea/index.html).
  - Document the null-area pre-processing step in [`src/fea/frame/area/`](src/fea/frame/area/) in [AGENTS.md](AGENTS.md).
- [ ] **Review points from the theory notes** (each listed under *Points for review* on its page):
  - RC: `concreteShearCapacity` always uses ACI 318-19 Table 22.5.5.1 expression (a); members with A<sub>v</sub> &lt; A<sub>v,min</sub> need expression (c) with the size-effect factor λ<sub>s</sub> ([rc/theory/beam-design.html](html-docs/rc/theory/beam-design.html#review)).
  - RC: confirm and correct the clause citations of the f<sub>y</sub> &gt; 550 MPa warning (cites 9.6.1.2; the limit is in 20.2.2.4) and of the V<sub>s</sub> formula (22.5.10.5.3 looks like the ACI 318-14 number; 318-19 has 22.5.8.5.3).
  - RC: `checkStirrupRequirement` uses the rounded V<sub>c</sub> and φV<sub>c</sub>; `rectBeamMomentCapacity` returns `unit: "kN-m"` while other functions use `"kN·m"`.
  - RC: the compression steel force does not deduct the displaced concrete.
  - Strengthening: confirm the ACI 440.2R-17 subsections for the 0.004 strain cap and ψ<sub>f</sub> = 0.85, and whether they carry over to steel plates ([strengthening/theory/steel-plates.html](html-docs/strengthening/theory/steel-plates.html#review)).
  - FEA: name the source of the "Complete Beam Stiffness Matrix" behind `beam3dLocalStiffness`; review the abrupt switch of local axes for near-vertical members; scale the equilibrium tolerance for moment-only load cases ([fea/theory/frame-element.html](html-docs/fea/theory/frame-element.html#review), [fea/theory/analysis-method.html](html-docs/fea/theory/analysis-method.html#review)).
- [ ] **Performance baseline**: benchmark a 20-storey, ~5 000-node building model (assembly, factorisation, solve per case, result size) before Phase 3, to decide whether skyline storage stays adequate once diaphragms and modal analysis are in.

---

## Error Codes (3XX Series)

Codes 301–314 are the existing validation and solver errors in [`fea.error.ts`](src/core/errors/fea.error.ts).

| Code | Error Name | Target Feature | Trigger Condition |
|:---:|:---|:---|:---|
| **315** | `INVALID_AREA_GEOMETRY` | Null areas *(Shipped)* | Non-planar, non-convex, or degenerate area vertices |
| **316** | `AREA_EDGE_UNSUPPORTED` | Null areas *(Shipped)* | Loaded edge without supporting member chain |
| **317** | `INVALID_AREA_DISTRIBUTION` | Null areas *(Shipped)* | Invalid edge configuration for one-way / cantilever |
| **318** | `INVALID_SECTION_SHAPE` | Sections & materials | Inconsistent section geometry (e.g. $2 t_f \ge d$ for I-beam) |
| **319** | `SETTLEMENT_ON_FREE_DOF` | Support settlement | Imposed displacement assigned to a non-fixed DOF |
| **320** | `MISSING_THERMAL_COEFFICIENT` | Temperature loads | Temperature load on a member without $\alpha$ |
| **321** | `INVALID_CONSTRAINT` | Constraints, diaphragms | Conflicting constraints, constrained DOF also fixed, node in two diaphragms, non-coplanar diaphragm |
| **322** | `UNKNOWN_PROPERTY_REFERENCE` | Sections & materials | `sectionId` / `materialId` not defined in the model |
| **323** | `GEOMETRIC_INSTABILITY` | Linearized P-Δ | $\mathbf{K} + \mathbf{K}_g$ not positive definite |
| **324** | `NO_MASS` | Modal analysis | No mass on any free DOF |
| **325** | `EIGEN_NOT_CONVERGED` | Modal, buckling | Eigensolver did not converge within the iteration limit |
| **326** | `INVALID_SHELL_GEOMETRY` | Shell elements *(3.0.0)* | Not 4 distinct nodes (3 allowed from 5.8), non-convex, $\det \mathbf{J} \le 0$, or warping beyond the limit |
| **327** | `INVALID_SHELL_SECTION` | Shell elements *(3.0.0)* | Thickness or $E$ not positive, $\nu$ outside $[0, 0.5)$, or negative `unitWeight` |
| **328** | `SHELL_DOF_UNSUPPORTED` | Shell elements *(3.0.0)* | A translation nothing resists at a model node connected only to membrane (or only to plate) shells |
| **329** | `INVALID_SHELL_MESH` | Engine meshing *(3.0.0)* | No conforming division counts, a bad generated element, or a generated id already in use |
| **330** | `INVALID_STRIP_GEOMETRY` | Strip forces *(Unreleased)* | Fewer than 2 points, points off the strip's plane, a zero-length or doubled-back segment, a zero normal, a negative width or both widths 0 |
| **331** | `INVALID_PIER_GEOMETRY` | Pier & spandrel forces *(Unreleased)* | Unknown or doubly assigned area/member, empty group, non-vertical pier area, non-coplanar spandrel, a cut off the mesh lines |
| **332** | `SHELL_LOAD_UNSUPPORTED` | Meshed plates and membranes *(Unreleased, interim)* | A load along a translation held at a generated mesh node |

---

## Summary of Planned Exports

| Kind | Identifier | Type / Return | Purpose |
|:---|:---|:---|:---|
| `FN` | `frameSection` *(sections)* | `SectionResult` | Section properties from standard shapes and a material |
| `FN` | `concreteMaterial`, `steelMaterial` *(sections)* | `FrameMaterial` | Material presets |
| `TYPE` | `SectionShape`, `FrameMaterial` *(sections)* | — | Shape and material inputs |
| `TYPE` | `FeaModel.sections`, `FeaModel.materials`, `Member.sectionId` | — | Properties defined once and referenced by id |
| `TYPE` | `Member.modifiers` | `PropertyModifiers` | Cracked-section and other stiffness modifiers |
| `TYPE` | `MomentMemberLoad` | `MemberLoad` | Concentrated moment on a member |
| `TYPE` | `LoadCombination.type` | `"linear" \| "envelope"` | Envelope combinations, nestable in linear ones |
| `CONST` | `AREA_LENGTH_TOLERANCE`, `AREA_ANGLE_TOLERANCE` | `number` | Null-area geometry tolerances |
| `TYPE` | `Member.endOffsets` | `MemberEndOffsets` | Rigid joint zones and face moments |
| `TYPE` | `AnalyzeOptions.shearDeformation` | `boolean` | Timoshenko beam formulation |
| `TYPE` | `Member.localAxis` | `MemberLocalAxis` | Local axes from a reference vector or point |
| `TYPE` | `DistributedMomentMemberLoad` | `MemberLoad` | Moment per unit length about local 2 or 3 |
| `TYPE` | `MemberStation.r1` | `number` | Twist along the member |
| `TYPE` | `FeaModel.supportDisplacements` | `SupportDisplacement[]` | Prescribed support settlements per load case |
| `TYPE` | `TemperatureMemberLoad` | `MemberLoad` | Uniform $\Delta T$ and thermal gradients |
| `TYPE` | `Restraint.axes` | — | Skewed supports |
| `FN` | `patternLiveLoads` | `FeaModel` | ACI 318-19 6.4.3 live-load arrangements |
| `TYPE` | `FeaModel.constraints` | `NodalConstraint[]` | Equal-DOF and rigid-body constraints |
| `TYPE` | `FeaModel.diaphragms`, `FeaModel.diaphragmLoads` | — | Rigid diaphragms and story forces with eccentricity |
| `TYPE` | `AnalyzeOptions.pDelta` | — | Linearized P-Δ load set |
| `TYPE` | `FeaModel.massSource` | `MassSource` | Mass from self-weight, load cases and nodal masses |
| `FN` | `analyzeModal` | `ModalResult` | Periods, mode shapes, participating mass ratios |
| `FN` | `analyzeBuckling` | `BucklingResult` | Critical load factors and buckling modes |
| `TYPE` | `FeaModel.responseSpectra` | `ResponseSpectrum[]` | Response spectrum cases (CQC/SRSS) |
| `TYPE` | `FeaModel.shells`, `ShellArea`, `ShellSection`, `ShellModifiers` | — | Shell areas with membrane, plate or shell behaviour |
| `TYPE` | `FeaCaseResult.shellForces` *(3.0.0)* | `ShellElementForces[]` | Corner membrane forces, moments, shears and face stresses |
| `TYPE` | `ShellArea.mesh`, `ShellMesh` *(3.0.0)* | — | Engine meshing of shell areas |
| `TYPE` | `FeaModel.lineRestraints`, `LineRestraint` *(3.0.0)* | — | Fixed DOFs along a line, generated nodes included |
| `TYPE` | `FeaResult.mesh`, `FeaMesh` *(3.0.0)* | — | Generated nodes and shell elements |
| `TYPE` | `FeaModel.strips`, `ShellStrip`, `StripPoint` *(Unreleased)* | — | Design strips across shells |
| `TYPE` | `FeaCaseResult.stripForces`, `FeaEnvelope.strips` *(Unreleased)* | `StripForces[]` | Resultants on cuts across each strip, and their envelope |
| `CONST` | `STRIP_PLANE_TOLERANCE`, `STRIP_DEFAULT_DIVISIONS` *(Unreleased)* | `number` | Strip plane tolerance and default station divisions |
| `TYPE` | `FeaModel.piers`, `FeaModel.spandrels`, `WallPier`, `WallSpandrel` *(Unreleased)* | — | Wall pier and spandrel groups |
| `TYPE` | `FeaCaseResult.pierForces`, `FeaCaseResult.spandrelForces`, `FeaEnvelope.piers`, `FeaEnvelope.spandrels` *(Unreleased)* | `PierForces[]`, `SpandrelForces[]` | Resultants at each pier and spandrel cut, and their envelope |
| `TYPE` | `ShellArea.plateTheory` | `"thin" \| "thick"` | Thick-plate formulation |

---

## Out of Scope

The following items are intentionally excluded from the `fea` frame solver:

- **Nonlinear analysis that changes stiffness per load case**: tension-only braces, compression-only supports, gaps, plasticity / plastic hinges, pushover, large displacement. These break superposition. Tension-only X-bracing can be approximated with both braces active at reduced area — document this.
- **Linear and nonlinear time history**: needs time integration and damping models; revisit only after response spectrum.
- **Curved shell and solid elements**: shells are flat facets (Phase 5), which cover building walls, cores and slabs; degenerated curved shells and 3D solid elements are not planned.
- **Warping torsion** of open steel sections.
- **Automatic code load generation**: ELF story forces, wind pressures and load combinations stay user-specified (the engine applies what it is given, plus the code-agnostic patterning helper in 2.10).
- **Member design code checks**: belong in [`src/rc/`](src/rc/) or a dedicated steel design module.
- **Rendering & GUI**: the library is headless; front-end applications handle visualisation.
