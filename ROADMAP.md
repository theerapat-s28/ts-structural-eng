# FEA Roadmap & Implementation Plan

> **Module**: [`@theerapat-s28/ts-structural-eng-tools/fea`](file:///home/khunbai/1-devs/05-ts-structural-eng/src/fea/index.ts)  
> **Source Plan**: [fea-future-features.html](file:///home/khunbai/1-devs/05-ts-structural-eng/html-implementation-plans/fea-future-features.html)  
> **Documentation**: [html-docs/fea/index.html](file:///home/khunbai/1-devs/05-ts-structural-eng/html-docs/fea/index.html)

This roadmap outlines features expected in a complete 3D frame analysis package that are currently missing or planned for the `fea` engine.

---

## Architecture Rules & Constraints

Every feature added must conform to the following core principles:

1. **Linear in the loads**: All results must remain linear in the loads so that load combinations (superposition of raw states) remain exact. No nonlinearities.
2. **Validated with location**: Every new input field must be validated in [`src/fea/frame/validation/validate-model.ts`](file:///home/khunbai/1-devs/05-ts-structural-eng/src/fea/frame/validation/validate-model.ts) and report errors with `details` pinpointing the exact `nodeId`, `memberId`, `loadCase`, or `field`.
3. **No dense global matrix**: Stiffness matrix remains profile-stored in skyline form ([`src/fea/frame/utils/skyline.ts`](file:///home/khunbai/1-devs/05-ts-structural-eng/src/fea/frame/utils/skyline.ts)). Any DOF coupling (e.g. diaphragms) must keep the skyline band narrow via Reverse Cuthill-McKee (RCM) ordering.
4. **Standard SI units**: Coordinates and geometry in mm, elastic moduli and stresses in MPa, forces in kN, moments in kN·m, distributed loads in kN/m, rotations in rad; thermal coefficients in 1/°C, temperatures in °C, unit weights in kN/m³.
5. **Verified**: Validated against textbook / hand-calculated benchmarks and independent oracles (e.g. subdivided-member tests).
6. **Synchronous Documentation**: Every change must be documented in [html-docs/fea/index.html](file:///home/khunbai/1-devs/05-ts-structural-eng/html-docs/fea/index.html), landing docs, [CHANGELOG.md](file:///home/khunbai/1-devs/05-ts-structural-eng/CHANGELOG.md), and [README.md](file:///home/khunbai/1-devs/05-ts-structural-eng/README.md).
7. **Engine only**: Structural data in plain JSON. No UI, rendering, colors, or presentation state.

---

## Roadmap Overview

| Status | Phase | Feature | Effort | Depends on |
|:------:|:-----:|:--------|:------:|:-----------|
| [x] | — | Varying member loads (`trapezoidal`) | M | — |
| [x] | — | Distributed torque (`torque`) | S | — |
| [x] | — | Null areas (area loads to beams) | L | Varying loads, torque |
| [ ] | 1 | Area geometry tolerance | S | — |
| [ ] | 1 | Sections & materials | M | — |
| [ ] | 1 | Axial-only members (end releases) | S | — |
| [ ] | 1 | Member point moments | S | — |
| [ ] | 1 | Envelope sets | S | — |
| [ ] | 2 | Projected loads | S | — |
| [ ] | 2 | Distributed member moments | M | Member point moments |
| [ ] | 2 | Member twist | S | — |
| [ ] | 2 | Null area extensions | M | Distributed moments (part) |
| [ ] | 2 | Support settlement | M | — |
| [ ] | 2 | Temperature loads | M | Sections & materials |
| [ ] | 2 | End offsets (rigid zones) | M | — |
| [ ] | 3 | Rigid floor diaphragms | L | — |
| [ ] | 3 | Shear deformation (Timoshenko) | M | Sections & materials |

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
  - [x] Implemented in [`src/fea/frame/area/`](file:///home/khunbai/1-devs/05-ts-structural-eng/src/fea/frame/area/)
  - [x] Two-way distribution: Polygon bisector clipping with half-planes (convex shapes and skewed quadrilaterals)
  - [x] One-way distribution: Strip method based on parallel unsupported edges, resultant matching polygon centroid
  - [x] Cantilever distribution: Support edge receives line load ($q \cdot c$) and distributed torque ($q \cdot c^2 / 2$)
  - [x] Member chains along area edges (splitting at intermediate nodes)
  - [x] Direction options: local `"3"` or global `X`/`Y`/`Z`
  - [x] Error codes: 315 (`INVALID_AREA_GEOMETRY`), 316 (`AREA_EDGE_UNSUPPORTED`), 317 (`INVALID_AREA_DISTRIBUTION`)
  - [x] 58 tests in `tests/fea/frame/area-*.test.ts` (10 mm grid oracle for skewed quad, equilibrium checks $\sum R = q \cdot A$)

---

## Phase 1: Core Modelling Inputs & Results

### 1.1 Area Geometry Tolerance
- [ ] Split single relative tolerance `AREA_GEOMETRY_TOLERANCE` ($10^{-6} \times \text{size}$) in [`src/core/constants/`](file:///home/khunbai/1-devs/05-ts-structural-eng/src/core/constants/) into two explicit tolerances:
  - [ ] `AREA_LENGTH_TOLERANCE`: Absolute length (e.g. $1\text{ mm}$) for planarity and node-on-edge checks.
  - [ ] `AREA_ANGLE_TOLERANCE`: Angular tolerance (e.g. $10^{-3}\text{ rad} \approx 0.06^\circ$) for parallel edges, square corners, and convexity.
  - [ ] Retain $10^{-6} \times \text{size}$ only for true degeneracies (duplicate nodes, zero area).
- [ ] Project slightly non-planar quads onto best-fit plane and snap near-edge nodes to boundary edges so total load remains exactly $q \cdot A$.
- [ ] Optional model-level override for imported CAD/BIM models.
- [ ] Tests for boundary tolerances (just inside vs just outside) and equilibrium conservation.

### 1.2 Sections & Materials (`fea/sections/`)
- [ ] Define shape union type `SectionShape`:
  - [ ] `{ kind: "rectangle", b, h }`
  - [ ] `{ kind: "circle", d }`
  - [ ] `{ kind: "pipe", d, t }`
  - [ ] `{ kind: "box", b, h, tf, tw }`
  - [ ] `{ kind: "i", d, bf, tf, tw }` (doubly symmetric I/H section)
  - [ ] `{ kind: "tee", d, bf, tf, tw }`
- [ ] Define material type `FrameMaterial`: `{ E, nu, unitWeight, alpha? }`.
- [ ] Implement `frameSection(shape: SectionShape, material: FrameMaterial)` helper:
  - [ ] Geometric properties: $A$, $I_{22}$, $I_{33}$ (local 2 is depth, local 3 is major axis; parallel-axis theorem for tee).
  - [ ] Torsional constant $J$:
    - Solid circle: $\pi d^4 / 32$
    - Rectangle: Saint-Venant series / existing formula
    - Thin-walled closed (box, pipe): Bredt formula $4A_m^2 / \oint (ds/t)$
    - Thin-walled open (I, tee): $\sum b t^3 / 3$ (document ignoring warping torsion)
  - [ ] Shear modulus: $G = E / (2(1 + \nu))$.
  - [ ] Compute shear areas $A_{sy}$, $A_{sz}$ up front for Phase 3 Timoshenko analysis.
  - [ ] Standard return shape: `{ sectionProperties, calculationDetails, unit, warnings }`.
  - [ ] Warnings: Thin-walled assumptions outside validity range ($t > d/10$).
  - [ ] Errors: FrameAnalysisError 314 (non-positive dimensions) and 318 (`INVALID_SECTION_SHAPE`, e.g. $2 t_f \ge d$).
- [ ] Implement material preset functions:
  - [ ] `concreteMaterial(fc, options?)`: $E = 4700\sqrt{f'_c}$, $\nu = 0.2$, $\gamma = 24\text{ kN/m}^3$, $\alpha = 1.0 \times 10^{-5}/^\circ\text{C}$.
  - [ ] `steelMaterial(options?)`: $E = 200\,000\text{ MPa}$, $\nu = 0.3$, $\gamma = 78.5\text{ kN/m}^3$, $\alpha = 1.2 \times 10^{-5}/^\circ\text{C}$.
  - [ ] Support custom property overrides.
- [ ] Benchmark tests against published steel manual tables and concrete section formulas.

### 1.3 Axial-Only Members (Pin-Jointed End Releases)
- [ ] Maintain member format without new truss elements (use `MemberEndRelease`: $r_1, r_2, r_3$).
- [ ] Automatic joint rotation stabilization:
  - [ ] Identify unconstrained rotational DOFs at joints where all framing members release rotation and no nodal restraint/spring exists.
  - [ ] Restrain these inactive rotational DOFs prior to skyline factorization to prevent spurious mechanism error 304.
  - [ ] Return list of restrained DOFs in `calculationDetails.autoRestrainedDofs`.
- [ ] Retain error 304 if an unconstrained rotational DOF is loaded by an external nodal moment.
- [ ] Retain error 307 if both member ends release torsion $r_1$ or axial displacement.
- [ ] Tests: 2D pin-jointed truss vs method of joints, 3D space truss, manual vs auto-restrained equivalence oracle.

### 1.4 Member Point Moments
- [ ] Add member load type: `{ type: "moment", direction: "1" | "2" | "3" | "X" | "Y" | "Z", M: number, a: number }`.
- [ ] Compute fixed-end actions from beam shape function derivatives evaluated at $a$.
- [ ] For direction `"1"` (torsional moment), evaluate torsion linear shape functions.
- [ ] Update member internal force diagrams: concentrated jump of $M$ at location $a$ (reporting left and right values).
- [ ] Tests: Fixed-fixed beam with moment at midspan ($M/4$ reactions) and arbitrary positions; subdivided-member oracle.

### 1.5 Envelope Sets
- [ ] Extend model definition: `FrameModel.envelopes?: { id: string, combinations: string[] }[]`.
- [ ] Compute named envelope subsets (e.g. `"STRENGTH"`, `"SERVICE"`) using `buildEnvelope`.
- [ ] Preserve default `result.envelope` across all combinations.
- [ ] Update `memberDemandEnvelope(result, memberId, { envelope?: string })` to accept envelope set ID.
- [ ] Validate envelope IDs (unique, code 303) and combination references (code 309).
- [ ] Tests: Named envelopes matching manual subsets; single combination identity; validation errors.

---

## Phase 2: Common Load & Modelling Options

### 2.1 Projected Loads
- [ ] Add `projected?: boolean` flag to `udl`, `trapezoidal`, and `AreaLoad`.
- [ ] For global member loads: scale load by projected length factor $\cos\theta$ ($w \cdot L_{proj} / L$).
- [ ] For global area loads: scale pressure by projection cosine: $q \cdot |\mathbf{n} \cdot \mathbf{e}_{dir}|$ on true area.
- [ ] Validation: reject `projected: true` on local axes or normal `"3"` (error 314).
- [ ] Tests: 30° sloped rafter snow load, vertical columns under projected vertical loads (zero load), inclined ramp area.

### 2.2 Distributed Member Moments
- [ ] Add member load type: `{ type: "distributedMoment", axis: "2" | "3", m: number, start?: number, end?: number }`.
- [ ] Integrate point moment fixed-end action equations along loaded span.
- [ ] Update member diagrams: linear slope in $M$ diagram, zero shear change $\Delta V = 0$.
- [ ] Support cantilever null areas with in-plane load components along support edge (removing current 317 rejection).
- [ ] Tests: Fixed-fixed beam under uniform moment; ramp cantilever area with edge parallel to slope.

### 2.3 Member Twist Reporting
- [ ] Add twist angle $r_1$ (rad) to `MemberStation.r1`, `extremes.r1`, and `StationComponent`.
- [ ] Integrate $\phi' = T / (G \cdot J)$ along station points from start node rotation $r_1$, skipping released ends.
- [ ] Include $r_1$ in envelope calculations.
- [ ] Tests: Fixed-fixed member with uniform torque $\phi_{max} = tL^2 / (8GJ)$, cantilever tip $\phi = tL^2 / (2GJ)$.

### 2.4 Null Area Extensions
- [ ] Crossing beams: Detect members interior to null areas; issue warning (future: automatic area subdivision).
- [ ] Arbitrary convex polygons: Allow $N \ge 5$ vertices in validation (half-plane clipping already supports general convex polygons).
- [ ] Cantilever support edge in-plane loads: Enabled via distributed member moments.
- [ ] Varying-depth cantilevers: Support triangular/trapezoidal cantilever slabs by emitting linear/subdivided torque loads.
- [ ] One-way trapezoids: Handle parallel edge one-way distribution with non-parallel sides.
- [ ] Relax or formalize requirements for edge members along zero-load parallel edges of one-way slabs.

### 2.5 Support Settlement (Prescribed Displacements)
- [ ] Extend model definition: `FrameModel.supportDisplacements?: { loadCase: string, nodeId: string | number, ux?, uy?, uz?, rx?, ry?, rz? }[]`.
- [ ] Solver formulation: Partition system into free and prescribed DOFs:
  $$\mathbf{F}_{free} \leftarrow \mathbf{F}_{free} - \mathbf{K}_{fr} \mathbf{u}_r$$
  Assembled member by member without forming dense global $\mathbf{K}$.
- [ ] Reconstitute full displacement vector $\mathbf{U} = [\mathbf{u}_{free}, \mathbf{u}_r]^T$ for end force and reaction extraction.
- [ ] Error 319 (`SETTLEMENT_ON_FREE_DOF`): Thrown if displacement is prescribed on a free or spring DOF.
- [ ] Tests: Fixed-fixed settlement ($M = 6EI\Delta/L^2$, $V = 12EI\Delta/L^3$), propped cantilever, multi-span continuous beam settlement.

### 2.6 Temperature Loads
- [ ] Add load type: `{ type: "temperature", deltaT?: number, gradient2?: number, gradient3?: number }`.
- [ ] Requires thermal expansion coefficient $\alpha$ ($1/^\circ\text{C}$) on member's section/material.
- [ ] Fixed-end forces:
  - Axial: $N = E \cdot A \cdot \alpha \cdot \Delta T$
  - Bending: $M_2 = E \cdot I_{22} \cdot \alpha \cdot \text{gradient}_2$, $M_3 = E \cdot I_{33} \cdot \alpha \cdot \text{gradient}_3$
- [ ] Diagram corrections: Subtract free thermal curvature/strain so unrestrained members exhibit deflection without spurious internal forces.
- [ ] Error 320 (`MISSING_THERMAL_COEFFICIENT`): Raised if temperature load applied to member lacking $\alpha$.
- [ ] Tests: Restrained bar thermal stress, free cantilever expansion and thermal curvature deflection without force.

### 2.7 Member End Offsets (Rigid Joint Zones)
- [ ] Extend member: `Member.endOffsets?: { start?: number, end?: number, rigidZoneFactor?: number }`.
- [ ] Rigid-link kinematics transformation applied to member local stiffness matrix $\mathbf{K}_e$ and fixed-end load vector $\mathbf{F}_e$.
- [ ] Member loads within rigid offset transferred directly to end nodes.
- [ ] Diagrams plotted over flexible clear span; output face moments at column/beam edges.
- [ ] Update `memberDemandEnvelope` to use face moments for design.
- [ ] Tests: Portal frame beam-column joint vs explicit stiff member links (oracle).

---

## Phase 3: Solver & Structural Behavior

### 3.1 Rigid Floor Diaphragms
- [ ] Add diaphragm specification: `FrameModel.diaphragms?: { id: string, nodeIds: (string | number)[] }[]`.
- [ ] Kinematic constraint at floor level $(z)$:
  - Master node at floor centroid $(x_m, y_m)$ with DOFs $(U_X, U_Y, R_Z)$.
  - Slave node $(x_i, y_i)$:
    $$u_{xi} = U_X - (y_i - y_m) R_Z$$
    $$u_{yi} = U_Y + (x_i - x_m) R_Z$$
    $$r_{zi} = R_Z$$
  - Out-of-plane DOFs $(u_{zi}, r_{xi}, r_{yi})$ remain independent.
- [ ] Skyline matrix optimization: Renumber master DOFs immediately adjacent to floor nodes to maintain narrow skyline profile bandwidth.
- [ ] Calculation details: Output diaphragm master displacements and inter-story drift.
- [ ] Error 321 (`INVALID_DIAPHRAGM`): Raised if node assigned to multiple diaphragms or if in-plane DOF is already fixed.
- [ ] Tests: Multistory building lateral load vs horizontal stiff-truss cross-bracing oracle; floor eccentricity torsion.

### 3.2 Shear Deformation (Timoshenko Beam Element)
- [ ] Add shear areas $A_{sy}$, $A_{sz}$ to `SectionProperties`.
- [ ] Add option `AnalyzeFrameOptions.shearDeformation?: boolean` (defaults to `false` for Euler-Bernoulli compatibility).
- [ ] Formulate Timoshenko 12×12 element stiffness matrix with shear factors:
  $$\Phi_y = \frac{12 E I_{33}}{G A_{sy} L^2}, \quad \Phi_z = \frac{12 E I_{22}}{G A_{sz} L^2}$$
- [ ] Update fixed-end actions and diagram deflection integration with shear distortion terms.
- [ ] Tests: Deep beam / short column cantilever tip deflection $\delta = \frac{P L^3}{3 E I} + \frac{P L}{G A_s}$; verify Euler-Bernoulli convergence as $A_s \to \infty$.

---

## Technical Debt & Pending Verifications

- [ ] **ETABS local-axis convention check**: Confirm whether local 3 rule ($1 \times Z$ for non-vertical, $+X$ for vertical) matches CSI ETABS v21 documentation exactly.
- [ ] **ACI 318-19 Table 6.6.3.1.1 verification**: Verify cracked moment of inertia reduction factors ($0.35 I_g$ for beams, $0.70 I_g$ for columns) cited in [`src/rc/`](file:///home/khunbai/1-devs/05-ts-structural-eng/src/rc/).
- [ ] **Null area distribution assumptions**: Confirm with practicing structural engineers regarding two-way bisector vs moment-coefficient methods.
- [ ] **Package release housekeeping for v2.1.0**:
  - Review torque loads and null area changes.
  - Ensure exported types and errors 315–317 are included in documentation.
  - Bump package version via `update-version` skill.
- [ ] **Documentation layout fixes**:
  - Address horizontal scroll issue on tables with long descriptions in [html-docs/fea/index.html](file:///home/khunbai/1-devs/05-ts-structural-eng/html-docs/fea/index.html).
  - Update [AGENTS.md](file:///home/khunbai/1-devs/05-ts-structural-eng/AGENTS.md) to document the null area pre-processing step in [`src/fea/frame/area/`](file:///home/khunbai/1-devs/05-ts-structural-eng/src/fea/frame/area/).

---

## Proposed Error Codes (3XX Series)

| Code | Error Name | Target Feature | Trigger Condition |
|:---:|:---|:---|:---|
| **315** | `INVALID_AREA_GEOMETRY` | Null areas *(Shipped)* | Non-planar, non-convex, or degenerate area vertices |
| **316** | `AREA_EDGE_UNSUPPORTED` | Null areas *(Shipped)* | Loaded edge without supporting member chain |
| **317** | `INVALID_AREA_DISTRIBUTION` | Null areas *(Shipped)* | Invalid edge configuration for one-way / cantilever |
| **318** | `INVALID_SECTION_SHAPE` | Sections & materials | Inconsistent section geometry (e.g. $2 t_f \ge d$ for I-beam) |
| **319** | `SETTLEMENT_ON_FREE_DOF` | Support settlement | Imposed displacement assigned to non-fixed DOF |
| **320** | `MISSING_THERMAL_COEFFICIENT` | Temperature loads | Temperature load applied to member lacking $\alpha$ |
| **321** | `INVALID_DIAPHRAGM` | Rigid diaphragms | Node in multiple diaphragms or diaphragm node with fixed in-plane DOF |

---

## Summary of Planned Exports

| Kind | Identifier | Type / Return | Purpose |
|:---|:---|:---|:---|
| `CONST` | `AREA_LENGTH_TOLERANCE` | `number` | Absolute tolerance ($1\text{ mm}$) for planarity and edge alignment |
| `CONST` | `AREA_ANGLE_TOLERANCE` | `number` | Angular tolerance ($10^{-3}\text{ rad}$) for parallel/perpendicular edges |
| `FN` | `frameSection` | `SectionResult` | Generates section properties from standard geometric shapes |
| `FN` | `concreteMaterial`, `steelMaterial` | `FrameMaterial` | Presets for typical structural materials |
| `TYPE` | `calculationDetails.autoRestrainedDofs` | `{ nodeId, dof }[]` | List of rotational DOFs automatically restrained for pin joints |
| `TYPE` | `MomentMemberLoad` | `MemberLoad` | Concentrated moment on a member |
| `TYPE` | `FrameModel.envelopes` | `EnvelopeDefinition[]` | Grouped load combination envelopes (e.g. strength, service) |
| `TYPE` | `projected` | `boolean` | Projected-length flag for loads on sloped members and areas |
| `TYPE` | `DistributedMomentMemberLoad` | `MemberLoad` | Continuous moment per unit length along local 2 or 3 |
| `TYPE` | `MemberStation.r1` | `number` | Twist rotation along member axis |
| `TYPE` | `NullArea` (extensions) | `NullArea` | Multi-vertex polygons and varying-depth cantilevers |
| `TYPE` | `FrameModel.supportDisplacements` | `SupportDisplacement[]`| Prescribed support settlements per load case |
| `TYPE` | `TemperatureMemberLoad` | `MemberLoad` | Uniform $\Delta T$ and thermal gradients |
| `TYPE` | `Member.endOffsets` | `MemberEndOffsets` | Rigid joint offsets and face-moment reporting |
| `TYPE` | `FrameModel.diaphragms` | `DiaphragmDefinition[]`| Rigid diaphragm constraints for building lateral analysis |
| `TYPE` | `shearDeformation` | `boolean` | Timoshenko beam element formulation |

---

## Out of Scope

The following items are intentionally excluded from the core `fea` frame solver:

- **Dynamic analysis (Modal, Response Spectrum, Time History)**: Requires mass matrices and eigensolvers; belongs in a dedicated dynamic analysis package.
- **Geometric nonlinearity ($P\text{-}\Delta$, large displacement, buckling)**: Nonlinear iteration invalidates linear load case superposition.
- **Material nonlinearity (Plasticity, tension-only members, gap elements)**: Breaks superposition.
- **Finite elements for continuum plates, shells, and walls**: Null areas distribute surface loads to frames; continuum shell/plate elements belong to a separate FEA element family.
- **Automatic code load combination generation**: Factors remain user-specified.
- **Member design code checks**: Belongs in [`src/rc/`](file:///home/khunbai/1-devs/05-ts-structural-eng/src/rc/) or dedicated steel design modules.
- **Rendering & GUI**: Library is headless; front-end applications handle visualization.
