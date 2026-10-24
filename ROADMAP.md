# FEA Roadmap & Implementation Plan

> **Module**: [`@theerapat-s28/ts-structural-eng-tools/fea`](src/fea/index.ts)  
> **Documentation**: [html-docs/fea/index.html](html-docs/fea/index.html)  
> **Target users**: engineers analysing **RC and steel buildings** — moment frames, braced frames, wall–frame systems with floor slabs as null areas, under gravity, wind and seismic load cases.

This roadmap lists what the `fea` engine still needs to be a dependable analysis core for building design: the modelling inputs a building model uses every day, lateral-system behaviour (diaphragms, second-order effects) and dynamics (modal, response spectrum).

---

## Architecture Rules & Constraints

Every feature added must conform to the following core principles:

1. **Linear in the loads**: Every load-case result must be linear in that case's loads, so load combinations (superposition of raw states) stay exact.
   - **One documented exception — linearized P-Δ**: a single user-named P-Δ load set fixes the geometric stiffness $\mathbf{K}_g$ once; every case is then solved linearly against $\mathbf{K} + \mathbf{K}_g$, so superposition still holds (the ETABS approach).
   - Modal, buckling and response-spectrum results are separate result kinds, not load cases; response-spectrum peaks enter combinations only through envelope-type combinations.
   - Still excluded: anything whose stiffness depends on the case being solved (tension-only members, gaps, plasticity).
2. **Validated with location**: Every new input field must be validated in [`src/fea/frame/validation/validate-model.ts`](src/fea/frame/validation/validate-model.ts) and report errors with `details` pinpointing the exact `nodeId`, `memberId`, `loadCase`, or `field`.
3. **No dense global matrix**: The stiffness (and mass) stays in skyline form ([`src/fea/frame/utils/skyline.ts`](src/fea/frame/utils/skyline.ts)) with nodes in reverse Cuthill–McKee order ([`solver/frame-system.ts`](src/fea/frame/solver/frame-system.ts)). Any DOF coupling (constraints, diaphragm masters) must enter the RCM adjacency so the profile stays narrow.
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

*Effort scale*: **S** ≈ 1 day, **M** ≈ 2–3 days, **L** ≈ 1+ week (including tests and docs).

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
  - [x] [`auto-restraint.ts`](src/fea/frame/solver/auto-restraint.ts): per-joint 3×3 rotational block, Jacobi eigen-decomposition, spring `k·n·nᵀ` on each null direction (exact: the PSD member stiffness makes that column zero)
  - [x] Per-load-case check: a moment about a held axis throws 304 with `nodeId`, `dof`, `loadCaseId`
  - [x] `calculationDetails.autoRestrainedDofs: { nodeId, axis, dof? }[]`
  - [x] Scope decision: only rotations that *no member at the joint* resists are held. Member rigid-body motions (e.g. a truss with torsion connected at both ends spinning about the member axes, or a beam without torsional support) still throw 304 — release `r1` at one end as in ETABS
  - [x] Tests in `tests/fea/frame/auto-restraint.test.ts`: truss vs method of joints, manual-restraint equivalence, inclined null axis, load-on-held-axis 304, no restraint at continuous columns or springs

- [x] **Projected Loads** (was 2.4)
  - [x] `projected?: boolean` on `udl`, `trapezoidal` and `AreaLoad`
  - [x] Global member loads scaled by the projected-length factor $L_{proj} / L = \sqrt{1 - (\mathbf{e}_1 \cdot \mathbf{e}_{dir})^2}$ in [`load-case-solver.ts`](src/fea/frame/solver/load-case-solver.ts); `start`/`end` stay along the member
  - [x] Global area loads scaled by $|\mathbf{n} \cdot \mathbf{e}_{dir}|$ on the true area in [`distribute-area-loads.ts`](src/fea/frame/area/distribute-area-loads.ts); generated member loads carry no `projected`
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
  - [ ] `FrameModel.materials?: { id, ...FrameMaterial }[]` and `FrameModel.sections?: { id, materialId, shape } | { id, materialId, properties }[]` (shape-based or explicit properties).
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
- [ ] A linear combination may reference an envelope combination, e.g. `1.2D + 1.0L + 1.0·WIND`. The result is then a max/min pair, not one state (ETABS behaviour): track `{ max, min }` raw states per result quantity and combine them term by term (positive factors keep max/min, negative factors swap them).
- [ ] `FrameCaseResult.kind` gains `"envelope"`; envelope results carry `max` / `min` instead of a single state, and no displaced shape.
- [ ] Keep the default `result.envelope` over all combinations unchanged.
- [ ] `memberDemandEnvelope(result, memberId, { combination?: string })` reads any combination, including envelope-type ones.
- [ ] Validation: existing 303 / 309 / 310 / 311 rules apply to the new type.
- [ ] Tests: envelope of one term equals that term; nested envelope matches manual max/min over expanded linear combinations; negative factor swaps bounds.

### 1.7 Null Area Robustness
- [ ] **Crossing beams**: detect members lying inside a null area (not on its edges). Today they silently receive no load — issue a warning naming the area and member. A later step can subdivide the area automatically (2.11).
- [ ] **Tolerances**: split `AREA_GEOMETRY_TOLERANCE` ($10^{-6} \times \text{size}$, [`frame.constant.ts`](src/core/constants/frame.constant.ts)) into:
  - [ ] `AREA_LENGTH_TOLERANCE`: absolute length (e.g. $1\text{ mm}$) for planarity and node-on-edge checks.
  - [ ] `AREA_ANGLE_TOLERANCE`: angle (e.g. $10^{-3}\text{ rad} \approx 0.06^\circ$) for parallel edges, square corners and convexity.
  - [ ] Keep $10^{-6} \times \text{size}$ only for true degeneracies (duplicate nodes, zero area).
- [ ] Slightly non-planar areas: distribute the load on the best-fit plane so the total stays exactly $q \cdot A$, and warn. Never move user nodes.
- [ ] Optional model-level tolerance override for imported CAD/BIM models.
- [ ] Tests: just-inside vs just-outside tolerance cases; equilibrium conservation; crossing-beam warning.

### 1.8 Verification Suite
- [ ] `tests/fea/verification/` with one file per published problem, each citing its source.
- [ ] Sources: CSI SAP2000 / ETABS verification manuals (frame problems), McGuire–Gallagher–Ziemian *Matrix Structural Analysis*, Kassimali *Matrix Analysis of Structures*.
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
- [ ] `AnalyzeFrameOptions.shearDeformation?: boolean` (default `false`, Euler–Bernoulli).
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
- [ ] `FrameModel.supportDisplacements?: { loadCase, nodeId, ux?, uy?, uz?, rx?, ry?, rz? }[]`.
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

- [ ] `FrameModel.constraints?: ({ id, type: "equalDof", nodeIds, dofs } | { id, type: "rigidBody", nodeIds, dofs? })[]`.
- [ ] Master–slave elimination: slave DOFs expressed through master DOFs by a transformation $\mathbf{T}$, applied element by element so no dense matrix is formed.
- [ ] Master DOFs enter the RCM adjacency next to their slaves so the profile stays narrow.
- [ ] Error 321 `INVALID_CONSTRAINT`: node in two conflicting constraints, constrained DOF that is also fixed, or a cycle.
- [ ] Tests: equal-DOF tie vs very stiff link; rigid body vs stiff member cage.

### 3.2 Rigid Floor Diaphragms & Story Results
- [ ] `FrameModel.diaphragms?: { id, nodeIds }[]` (all nodes at one elevation), implemented as a 3.1 constraint:
  - Master at the diaphragm centroid $(x_m, y_m)$ with DOFs $(U_X, U_Y, R_Z)$.
  - Slave $(x_i, y_i)$: $u_{xi} = U_X - (y_i - y_m) R_Z$, $u_{yi} = U_Y + (x_i - x_m) R_Z$, $r_{zi} = R_Z$.
  - Out-of-plane DOFs $(u_z, r_x, r_y)$ stay independent.
- [ ] Diaphragm loads: `FrameModel.diaphragmLoads?: { loadCase, diaphragmId, fx?, fy?, mz?, eccentricity? }[]`. Story forces from the user's ELF or wind calculation, with an optional accidental eccentricity offset (e.g. ASCE 7-22 12.8.4.2 ±5 %) turned into $m_z$.
- [ ] Results:
  - [ ] Diaphragm master displacements per case/combination.
  - [ ] Story drift and drift ratio between consecutive diaphragms; maximum vs average drift at the extreme corners (torsional irregularity check input, ASCE 7-22 Table 12.3-1).
  - [ ] Story shear and overturning moment from the column/wall/brace forces cut at each level.
- [ ] Error 321 also covers diaphragm conflicts (node in two diaphragms, in-plane DOF already fixed, nodes not coplanar).
- [ ] Tests: multistory frame lateral load vs stiff-truss bracing oracle; eccentric floor torsion; story shear equals applied lateral load.

### 3.3 Linearized P-Δ
- [ ] `AnalyzeFrameOptions.pDelta?: { terms: CombinationTerm[], iterate?: boolean }`: the gravity load set that sets member axial forces (e.g. $1.2D + 0.5L$ as in ETABS practice).
- [ ] Solve that set first (optionally iterating until the axial forces converge), build the member geometric stiffness $\mathbf{K}_g$ (consistent 12×12, P-Δ only), then factorise $\mathbf{K} + \mathbf{K}_g$ once and solve every case against it. Results stay linear, so combinations stay exact.
- [ ] Member P-δ is not captured inside one element: document that members should be subdivided where P-δ matters, and warn for slender compression members.
- [ ] `calculationDetails.pDelta`: axial forces used, iteration count, and per-story amplification (second-order / first-order drift) when diaphragms exist.
- [ ] Warning when amplification exceeds the ACI 318-19 limit of 1.4 × first-order effects (confirm clause — see Technical Debt).
- [ ] Error 323 `GEOMETRIC_INSTABILITY` when $\mathbf{K} + \mathbf{K}_g$ is not positive definite (P-Δ set exceeds the buckling load).
- [ ] Tests: AISC 360-22 Commentary Appendix 8 benchmark cases (cantilever column, braced column); leaning-column frame; amplification vs $1/(1 - P/P_e)$.

---

## Phase 4: Dynamics & Stability

### 4.1 Mass Source & Mass Matrix
- [ ] `FrameModel.massSource?: { selfWeight?: boolean, loadCases?: { case, factor }[], nodalMasses?: { nodeId, mx, my, mz, mrx?, mry?, mrz? }[] }`. Gravity loads (kN) are converted to mass by $g$.
- [ ] Lumped mass matrix (diagonal, translational) built from member self-weight (honouring `modifiers.weight`) and the mass-source loads, distributed to member ends.
- [ ] Diaphragm masters get translational mass plus rotational inertia $\sum m_i r_i^2$ about the master.
- [ ] Mass units stated explicitly (kN·s²/mm internally; reported in tonnes).
- [ ] Error 324 `NO_MASS` when a modal analysis finds no mass on any free DOF.

### 4.2 Eigensolver & Modal Analysis
- [ ] `analyzeModal(model, { modes, options? })` (or a method on `createFrameAnalysis`), reusing the skyline $\mathbf{L}\mathbf{D}\mathbf{L}^T$ factorisation.
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
- [ ] `FrameModel.responseSpectra?: { id, direction: "X" | "Y" | "Z", function: { T, Sa }[], scale?, damping?, modalCombination: "CQC" | "SRSS", directionalCombination?: "SRSS" | "100-30" }[]`. The spectrum is user-given T–Sa pairs, so the engine stays code-agnostic.
- [ ] Peak modal responses combined per mode, then across directions; results are unsigned peaks.
- [ ] Spectrum cases are usable as terms of envelope combinations (1.6), entering as $\pm$ the peak.
- [ ] Results include base shear per spectrum for the user's scaling to ELF (ASCE 7-22 12.9.1.4); the scale factor is an input.
- [ ] Tests: SDOF exactness, two-mode CQC vs hand calculation, closely spaced modes (CQC vs SRSS difference).

---

## Technical Debt & Pending Verifications

- [ ] **ETABS local-axis convention check**: confirm the local 3 rule ($1 \times Z$ for non-vertical, $+X$ for vertical) matches CSI ETABS v21 documentation exactly.
- [ ] **ACI 318-19 Table 6.6.3.1.1 verification**: confirm the cracked moment of inertia factors before quoting them in the 1.2 docs and in [`src/rc/`](src/rc/).
- [ ] **ACI 318-19 second-order limit**: confirm the clause number of the 1.4 × first-order moment limit used by the 3.3 warning.
- [ ] **Null area distribution assumptions**: confirm with practising structural engineers whether two-way bisector or moment-coefficient methods are expected.
- [ ] **Documentation layout fixes**:
  - Fix horizontal scroll on tables with long descriptions in [html-docs/fea/index.html](html-docs/fea/index.html).
  - Document the null-area pre-processing step in [`src/fea/frame/area/`](src/fea/frame/area/) in [AGENTS.md](AGENTS.md).
- [ ] **Performance baseline**: benchmark a 20-storey, ~5 000-node building model (assembly, factorisation, solve per case, result size) before Phase 3, to decide whether skyline storage stays adequate once diaphragms and modal analysis are in.

---

## Error Codes (3XX Series)

Codes 301–314 are the existing validation and solver errors in [`frame-analysis.error.ts`](src/core/errors/frame-analysis.error.ts).

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

---

## Summary of Planned Exports

| Kind | Identifier | Type / Return | Purpose |
|:---|:---|:---|:---|
| `FN` | `frameSection` *(sections)* | `SectionResult` | Section properties from standard shapes and a material |
| `FN` | `concreteMaterial`, `steelMaterial` *(sections)* | `FrameMaterial` | Material presets |
| `TYPE` | `SectionShape`, `FrameMaterial` *(sections)* | — | Shape and material inputs |
| `TYPE` | `FrameModel.sections`, `FrameModel.materials`, `Member.sectionId` | — | Properties defined once and referenced by id |
| `TYPE` | `Member.modifiers` | `PropertyModifiers` | Cracked-section and other stiffness modifiers |
| `TYPE` | `MomentMemberLoad` | `MemberLoad` | Concentrated moment on a member |
| `TYPE` | `LoadCombination.type` | `"linear" \| "envelope"` | Envelope combinations, nestable in linear ones |
| `CONST` | `AREA_LENGTH_TOLERANCE`, `AREA_ANGLE_TOLERANCE` | `number` | Null-area geometry tolerances |
| `TYPE` | `Member.endOffsets` | `MemberEndOffsets` | Rigid joint zones and face moments |
| `TYPE` | `AnalyzeFrameOptions.shearDeformation` | `boolean` | Timoshenko beam formulation |
| `TYPE` | `Member.localAxis` | `MemberLocalAxis` | Local axes from a reference vector or point |
| `TYPE` | `DistributedMomentMemberLoad` | `MemberLoad` | Moment per unit length about local 2 or 3 |
| `TYPE` | `MemberStation.r1` | `number` | Twist along the member |
| `TYPE` | `FrameModel.supportDisplacements` | `SupportDisplacement[]` | Prescribed support settlements per load case |
| `TYPE` | `TemperatureMemberLoad` | `MemberLoad` | Uniform $\Delta T$ and thermal gradients |
| `TYPE` | `Restraint.axes` | — | Skewed supports |
| `FN` | `patternLiveLoads` | `FrameModel` | ACI 318-19 6.4.3 live-load arrangements |
| `TYPE` | `FrameModel.constraints` | `NodalConstraint[]` | Equal-DOF and rigid-body constraints |
| `TYPE` | `FrameModel.diaphragms`, `FrameModel.diaphragmLoads` | — | Rigid diaphragms and story forces with eccentricity |
| `TYPE` | `AnalyzeFrameOptions.pDelta` | — | Linearized P-Δ load set |
| `TYPE` | `FrameModel.massSource` | `MassSource` | Mass from self-weight, load cases and nodal masses |
| `FN` | `analyzeModal` | `ModalResult` | Periods, mode shapes, participating mass ratios |
| `FN` | `analyzeBuckling` | `BucklingResult` | Critical load factors and buckling modes |
| `TYPE` | `FrameModel.responseSpectra` | `ResponseSpectrum[]` | Response spectrum cases (CQC/SRSS) |

---

## Out of Scope

The following items are intentionally excluded from the `fea` frame solver:

- **Nonlinear analysis that changes stiffness per load case**: tension-only braces, compression-only supports, gaps, plasticity / plastic hinges, pushover, large displacement. These break superposition. Tension-only X-bracing can be approximated with both braces active at reduced area — document this.
- **Linear and nonlinear time history**: needs time integration and damping models; revisit only after response spectrum.
- **Continuum plate, shell and wall elements**: null areas distribute surface loads to frames; walls are modelled as wide columns with rigid end offsets (2.1); in-plane slab flexibility is handled only through rigid diaphragms (semi-rigid diaphragms need shells).
- **Warping torsion** of open steel sections.
- **Automatic code load generation**: ELF story forces, wind pressures and load combinations stay user-specified (the engine applies what it is given, plus the code-agnostic patterning helper in 2.10).
- **Member design code checks**: belong in [`src/rc/`](src/rc/) or a dedicated steel design module.
- **Rendering & GUI**: the library is headless; front-end applications handle visualisation.
