# Changelog

All notable changes to `@theerapat-s28/ts-structural-eng-tools` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses [semantic versioning](https://semver.org/): a **major** release can break existing code, a **minor** release adds features, a **patch** release fixes bugs.

## [Unreleased]

### Added

- **Strip forces on shells.** Give the model `strips` (type `ShellStrip`), design strips drawn over a slab as in SAFE or ETABS, and every load case and combination gets `stripForces` (type `StripForces`): the resultants on cuts across each strip at stations along it. A strip is a centreline polyline `points` with `widthLeft` and `widthRight`, an optional plane `normal` (default +Z) and an optional `maxSpacing` between stations (default: 20 divisions per segment); it picks up every shell element in its plane and ignores walls and other planes. Each station gives `P`, `V`, `M`, `T`, `Vp` and `Mp` in kN and kN·m (strip axis 1 along, 2 across, 3 the normal; `M` positive sagging and `V = −dM/dx`, as for members), the same divided by the covered `width` in `perWidth`, and each strip lists the `extremes` along it. `envelope.strips` gives the max and min of every station over the combinations. A strip changes no other result. A cut that is not fully on shells (an opening, a slab edge, a strip wider than the slab) integrates the shells it crosses, reports the covered `width` and adds a warning. The new [strip forces theory notes](https://theerapat-s28.github.io/ts-structural-eng/fea/theory/strip-forces.html) show how each value is calculated. New constants `STRIP_PLANE_TOLERANCE` and `STRIP_DEFAULT_DIVISIONS` in `core`; `FeaErrorDetails` gains `stripId`.
- **Error 330** (`INVALID_STRIP_GEOMETRY`) for a strip with fewer than 2 points, points off its plane, a zero-length or doubled-back segment, a zero normal, or negative or zero widths. A strip id used twice is error 303, and a value that is not a finite number is 314.
- **Pier and spandrel forces for wall design.** Give the model `piers` (type `WallPier`) and `spandrels` (type `WallSpandrel`), groups of shell areas and members as in ETABS, and every load case and combination gets `pierForces` and `spandrelForces` (types `PierForces`, `SpandrelForces`): one resultant `P`, `V2`, `V3`, `T`, `M2`, `M3` (kN, kN·m) per cut across the whole group, about the centroid of the cut section, with member-diagram signs (`P` positive in tension). A pier lists vertical wall areas (planar, L, C or core walls, and separate legs, which are summed) and members (boundary or embedded columns); it is cut at the bottom and top of each lift, so a floor level gives a `"top"` cut from below and a `"bottom"` cut from above, plus extra elevations in `cuts`. Pier axis 1 is up and 2 runs along the longest area, or set it with `angle`. A spandrel lists areas in one vertical plane plus beams along it; it is cut at its `"left"` and `"right"` ends and at the distances in `cuts`, with axis 1 along it toward +X or +Y (`reverse` flips it) and 2 up. Each cut reports its `section` (type `WallCutSection`: legs, members, length, area and centroid) for wall design. The forces are the element nodal forces summed at the cut, in exact equilibrium with the loads; `envelope.piers` and `envelope.spandrels` give their max and min over the combinations. Pier and spandrel forces change no other result. The new [pier and spandrel theory notes](https://theerapat-s28.github.io/ts-structural-eng/fea/theory/pier-spandrel.html) show how each value is calculated. New constants `WALL_VERTICAL_TOLERANCE` and `WALL_CUT_TOLERANCE` in `core`; `FeaErrorDetails` gains `pierId`, `spandrelId` and `position`.
- **Error 331** (`INVALID_PIER_GEOMETRY`) for a pier or spandrel with an unknown, repeated or doubly assigned area or member, no area or member, a non-vertical pier area or horizontal pier member, a spandrel out of one vertical plane or with a member normal to it, an extra cut that misses the group, or a cut that crosses an area between its mesh lines (divide the area there). An id used twice is error 303, and an invalid `cuts`, `angle` or `reverse` value is 314.
- The strip types (`ShellStrip`, `StripPoint`, `StripForces`, …) and the strip and wall constants are also exported from the package root.

### Changed

- The shell element theory notes moved to `fea/theory/shell-element.html`, next to the new strip forces notes. The old address redirects there.

## [3.3.0] — 2026-11-03

**Members connect to the nodes lying on them.** Draw a girder once, from support to support, and the beams framing into it and the columns landing on it are connected without splitting it by hand. The girder stays one member in the results. Nodes that just miss a member are reported, and the new `memberConnectivity` returns both lists while the user draws, so a frontend can show what is connected. Results change only for models that had a node on a member's span that the member ignored; see Changed.

### Added

- **Members connect to the nodes lying on them.** A model node on a member between its ends, such as where a beam frames into a girder or a column lands mid-span, is now connected to the member. You no longer need to split the member there. The member is still one member in every result: one set of end forces, one diagram over its full length, and one envelope row. Member loads keep their positions along the whole member. Each connection is listed in the new `calculationDetails.intermediateNodes` (`{ memberId, nodeId, x }[]`, type `MemberIntermediateNode`), so a frontend can mark these points. Set `connectIntermediateNodes: false` on a member to connect it only at its ends; any value other than a boolean is rejected with error 314.
- **Near misses are reported.** A model node that is close to a member but not on it is not connected. It is now listed in the new `calculationDetails.nearMissNodes` (`{ memberId, nodeId, x, distance }[]`, type `MemberNearMissNode`) and gets a "Member connectivity" warning naming the node, the member and the distance. Close means within 1 % of the member length and at most 100 mm (`NODE_NEAR_MEMBER_RATIO` and `NODE_NEAR_MEMBER_MAX_DISTANCE`, exported from `core`).
- **`memberConnectivity(model)`** returns the same connected nodes and near misses without analysing (type `MemberConnectivity`). It is cheap and doesn't throw for a model that is still being edited, so a frontend can show the points while the user draws. It also reports a near miss that leaves the model unstable, when `analyze` throws 304 and returns no result.

### Changed

- **Results change for models with a node on a member's span that was not connected before.** Such a node used to be ignored by the member. A load or support on it then either went nowhere (an unstable structure, error 304) or acted on a separate frame. Now it acts on the member. To keep the old behaviour for a member, set `connectIntermediateNodes: false` on it. Models where every node on a member is the end of one of its pieces give the same results as before.

## [3.2.0] — 2026-10-31

**The analysis exports lose "Frame" from their names.** A model can be members, shells or both, so `analyzeFrame` is now `analyze`, `FrameModel` is `FeaModel`, `FrameAnalysisError` is `FeaError`, and so on, and a model of shells only, such as a mat foundation, no longer needs a `members` list. Nothing breaks: the old names still work as deprecated aliases until 4.0.0, and every result is identical to 3.1.0.

### Added

- **New names for the analysis exports.** "Frame" now means frame members only, as in ETABS. The exports that apply to the whole model, which may have members, shells or both, are renamed:

  | Before | Now |
  | --- | --- |
  | `analyzeFrame`, `createFrameAnalysis`, `validateFrameModel` | `analyze`, `createAnalysis`, `validateModel` |
  | `AnalyzeFrameOptions`, `FrameAnalysis` | `AnalyzeOptions`, `Analysis` |
  | `FrameModel`, `FrameResult`, `FrameCaseResult`, `FrameEnvelope`, `FrameMesh`, `FrameNode`, `FrameId` | `FeaModel`, `FeaResult`, `FeaCaseResult`, `FeaEnvelope`, `FeaMesh`, `FeaNode`, `FeaId` |
  | `FrameAnalysisError`, `FrameErrors`, `FrameModelIssue`, `FrameErrorDetails` | `FeaError`, `FeaErrors`, `FeaModelIssue`, `FeaErrorDetails` |

  They are exported from the same places as the old names (the package root, `/fea`, and `/core` for the errors) and behave the same: same inputs, results, and error codes and messages.
- **`members` is optional in `FeaModel`.** A model of shells only, such as a mat foundation, can leave it out instead of passing `members: []`.

### Changed

- The plain `Error` that `memberDemandEnvelope` throws for an id that is not in the result says "is not in the result" instead of "is not in the frame result".

### Deprecated

- The names before 3.2.0, listed under **Added**, still work: each is an alias of its new name (the same function, type, error class or object), so `instanceof FrameAnalysisError` still catches every error `analyze` throws. They are marked `@deprecated`, so editors strike them through, and will be removed in 4.0.0. To migrate, rename the imports and the types; nothing else changes.

### Documentation

- The FEA reference page is titled **Frame and Shell Analysis** and uses the new names throughout. Its anchors follow them too (`#analyze`, `#create-analysis`, `#validate-model`, `#fea-model`, `#fea-result` and so on), so links to the old anchors such as `#analyze-frame` open the top of the page.
- README: a second quick start, with a slab meshed into shell elements on edge beams and columns; what changes for a front end when a model has shells (generated nodes, elements, shell forces); the model and result fields at a glance; null areas compared with shells; running in a Web Worker, with measured analysis times; and the shell error codes 326–329.

## [3.1.0] — 2026-10-31

**Engine reorganised, and a guide for upgrading from 2.x.** The analysis engine behind `/fea` is reorganised into separate parts for frame members, shell elements and the analysis that runs them together. Nothing you call changes: every export keeps its name, its import path and its behaviour, and every result is identical to 3.0.0. Coming from 2.x? Read **Upgrading from 2.x** below; it covers this release and 3.0.0 together.

### Changed

- **Files inside `dist/` moved.** The code behind `/fea` moved from `dist/fea/frame/…` into `dist/fea/shared/`, `dist/fea/frame/` (members and null areas), `dist/fea/shell/` (the shell element) and `dist/fea/analysis/` (`analyzeFrame`, `validateFrameModel`, and the model and result types), in both the CommonJS and the ES-module builds. Imports from the package root and the subpaths (`/fea`, `/core`, …) are unaffected. An import of a file inside `dist/` no longer resolves: the `exports` map has never allowed one, but TypeScript's legacy `"moduleResolution": "node"` and bundler aliases can reach those files. Import from the root or `/fea` instead. Your editor's "go to definition" now opens the new files.

### Fixed

- The type comment and the reference page for `FrameCaseResult.shellForces` said one entry per shell area. There is one entry per shell element, area by area in model order, as the results have always had.

### Upgrading from 2.x

Nothing has been removed or renamed since 2.3.0, and no input has become required. A model that runs on 2.3.0 runs unchanged and gives the same numbers, warnings and validation issues; results only gain the fields in step 3. Most frontends need step 1 and a look at steps 3 and 4. Step 5 matters once you start sending shells (see 3.0.0 for the shell features themselves).

1. **Update the dependency.** A `^2.x` range does not pick up a major version: run `pnpm add @theerapat-s28/ts-structural-eng-tools@^3.1.0` (or `npm install` / `yarn add` with the same spec).

2. **Imports.** Nothing to change. Every name exported in 2.3.0 is still exported from the same place: the package root and `/fea`, `/rc`, `/strengthening`, `/core`, `/utils`. Only imports of files inside `dist/` break (see **Changed**).

3. **New result fields, on every result.** Without shells they are empty or zero:

   | Field | Without shells |
   | --- | --- |
   | `cases[id].shellForces`, `combinations[id].shellForces` | `[]` |
   | `envelope.shells` (when the model has combinations) | `[]` |
   | `calculationDetails.shellCount` | `0` |
   | `units.forcePerLength`, `units.momentPerLength`, `units.stress` | `"kN/m"`, `"kN·m/m"`, `"MPa"` |
   | `mesh` | absent; present only when the model has shells |

   Code that only reads results needs no change. Update code that:
   - **builds** a `FrameResult` or `FrameCaseResult` itself, such as an empty placeholder in app state, test fixtures or mocks. TypeScript names the missing fields.
   - **validates** stored or received results against a strict schema (Zod `.strict()`, JSON Schema `additionalProperties: false`).
   - **snapshots** whole results. Refresh the snapshots once; the values in them do not change.
   - maps **every key of `units`** to a label, e.g. for a units display.

4. **Errors and warnings.** For frame-only models the codes, `details` and the order of `issues` are unchanged, but two messages are reworded to mention shells:
   - 303 `DUPLICATE_ID`: "Node ids, member ids and restrained node ids must each be unique, area ids must be unique across null areas and shells, and load case and combination ids must be unique across both lists."
   - 313 `MISSING_UNIT_WEIGHT`: "A load case requests self-weight but a member or shell section has no unitWeight; set unitWeight (0 for a weightless member or shell)."

   If your code matches on `message`, match on `code` instead. Models with shells can also raise 326 `INVALID_SHELL_GEOMETRY`, 327 `INVALID_SHELL_SECTION`, 328 `SHELL_DOF_UNSUPPORTED` and 329 `INVALID_SHELL_MESH`, located by the new `details.shellId` (the shell area's id). Add them to any code-to-message table, and highlight the shell area that `shellId` names. The new warning **Shell area meshing** appears in `result.warnings`.

5. **When you add shells to a model.** These points apply only to models with `shells`:
   - **Generated nodes in node results.** Meshing adds nodes. `nodalDisplacements` and `reactions` list them after your own nodes, with string ids — `"<areaId>:<i>,<j>"` inside an area, `"<a>~<b>:<k>"` along an edge between your nodes `a` and `b` — even when your ids are numbers. Their coordinates are in `result.mesh.nodes`. Do not assume every node id in a result is one of yours; `calculationDetails.nodeCount` counts the generated nodes too.
   - **Drawing the mesh.** `result.mesh.shells` lists every element with its four node ids. `shellForces[].shellId` and `envelope.shells[].shellId` name these elements, and `areaId` groups them under your area; an area that is not meshed is one element with the area's own id. `calculationDetails.shellCount` counts elements, not areas.
   - **Contours.** Shell results are corner values in each element's local axes (`ShellCornerForces`), and `ShellForceComponent` lists the components for a picker. As usual for shell results, elements meeting at a node give different values there; average them for a smooth contour.
   - **Members along meshed edges** are split internally at the mesh nodes on them, but every member result (end forces, diagrams, release deformations, envelopes, `memberDemandEnvelope`) stays under the member's own id, along its full length. `calculationDetails.memberCount` counts your members.
   - **One id namespace for areas.** A null area and a shell cannot share an id (303), and an `AreaLoad` can name either. `distributeAreaLoads` returns only the loads from null areas; loads on shells stay on the shell.
   - **Supports along an edge.** Fix a wall base or a slab edge with `lineRestraints`: they reach the generated nodes, which a point `Restraint` cannot name.
   - **Model size.** Shell models have many more nodes than frames. Run the analysis in a Web Worker, and consider `diagrams: "extremes"` with `createFrameAnalysis(...).memberDiagram` to compute member diagrams on demand.

## [3.0.0] — 2026-10-31

**Shell element analysis.** `analyzeFrame` now analyses walls, cores, slabs and mats as shell elements alongside the frame: four-node flat shells with membrane and plate stiffness, meshed by the engine, with internal forces and stresses in every load case, combination and envelope. The major version marks this milestone; nothing is removed or renamed, and frame-only models give the same results as in 2.3.0, which only gain the new fields below (empty `shellForces` and `envelope.shells`, and the new `units` keys).

### Added

- **Shell areas** (`model.shells`): `ShellArea` (`{ id, nodeIds, type?, section, angle?, modifiers?, mesh? }`), a four-node flat shell with its own stiffness, sharing nodes with members and other shells. Null areas are unchanged; use shells where a surface's stiffness matters.
  - The element is a drilling-rotation membrane (after Ibrahimbegovic, Taylor & Wilson), so a beam framing into a wall in its plane transfers its moment, plus a thin DKQ plate (Batoz & Ben Tahar). `type` `"membrane"` or `"plate"` keeps only one part; `"shell"` (the default) keeps both.
  - Slightly warped quads are built on their mean plane and linked to their corners, up to `SHELL_WARPING_LIMIT` (0.1 × √A off the plane).
  - Local axes follow ETABS: local 3 by the right-hand rule around `nodeIds`, local 2 up on walls, local 1 = +X on horizontal shells, rotated by `angle`.
  - `ShellSection` (`thickness`, `E`, `nu`, `unitWeight?`) and `ShellModifiers` (`f11`, `f22`, `f12`, `m11`, `m22`, `m12`, `weight`) for cracked-section stiffness, e.g. the ACI 318-19 6.6.3.1.1 values entered by the user.
- **Engine meshing**: `ShellArea.mesh` (`ShellMesh`: `{ maxSize }` in mm, or `{ divisions: [n1, n2] }` as a minimum) divides an area into elements. Neighbouring areas share their mesh nodes, also where an area edge meets another at a node (a slab edge on two wall panels); division counts grow as needed, and an unmeshed area next to a meshed one is divided too. Model nodes lying on an area edge become mesh nodes. Generated elements are named `"<areaId>:<i>,<j>"`, generated nodes `"<areaId>:<i>,<j>"` inside an area or `"<a>~<b>:<k>"` on an edge; an area that stays one element keeps its id.
- **Members along meshed edges** (an edge beam under a slab, a beam on a wall top) are split at the mesh nodes inside them so they share them with the shells; their end forces, release deformations, diagrams, envelopes and design demands stay under the member's own id, the diagram stitched along its full length.
- **Line restraints** (`model.lineRestraints`, `LineRestraint`): `{ nodeIds: [a, b], ux?…rz? }` fixes those DOFs at every node on the segment from a to b, generated mesh nodes included, e.g. a wall base fixed along its length. A DOF fixed by a point or a line restraint is fixed.
- **Loads on shells**: an `AreaLoad` names a shell area by its id (area ids are shared by null areas and shells) and loads all its elements; self-weight acts as `selfWeight · unitWeight · thickness · modifiers.weight` per unit area. Both act as forces at the element corners.
- **Shell results**: every load case and combination has `shellForces` (`ShellElementForces[]`), per element with its `areaId`, the forces per unit width at its corners in its local axes: membrane forces `F11`, `F22`, `F12` (kN/m), moments `M11`, `M22`, `M12` (kN·m/m, positive with the −3 face in tension, i.e. sagging when local 3 is up, like a member's `M3`), transverse shears `V13`, `V23` (kN/m, `V13 = −(∂M11/∂x₁ + ∂M12/∂x₂)`), and top and bottom face stresses `S11Top` … `S12Bot` (MPa). They are extrapolated from the element's Gauss points, combine by superposition and are enveloped per corner in `envelope.shells`. The shears are recovered from the moments and are the coarsest output. Types `ShellCornerForces` and `ShellForceComponent`.
- `result.mesh` (`FrameMesh`): the generated nodes and every shell element with its nodes, for drawing; displacements and reactions include the generated nodes. `calculationDetails.shellCount`; `units.forcePerLength` (`"kN/m"`), `units.momentPerLength` (`"kN·m/m"`) and `units.stress` (`"MPa"`).
- Errors 326 (`INVALID_SHELL_GEOMETRY`), 327 (`INVALID_SHELL_SECTION`), 328 (`SHELL_DOF_UNSUPPORTED`: a translation that nothing resists at a node connected only to membrane or plate shells, with `nodeId`, `shellId` and `dof`) and 329 (`INVALID_SHELL_MESH`: areas that cannot be meshed), and `FrameErrorDetails.shellId`. A warning (**Shell area meshing**) for a member node inside a shell area but not on its mesh, which leaves it unconnected.
- Types `ShellArea`, `ShellSection`, `ShellModifiers`, `ShellType`, `ShellMesh`, `LineRestraint`, `ShellElementForces`, `ShellCornerForces`, `ShellForceComponent` and `FrameMesh` from `/fea` and the package root; `SHELL_WARPING_LIMIT` from `/core` and the root.
- Shell element theory notes in the documentation (`shell-element.html`): how the element's stiffness is formed, the integration choices, and the benchmarks it is checked against (patch tests, MacNeal–Harder cantilevers and twisted beam, Timoshenko plates, Scordelis–Lo roof, pinched cylinder).

### Changed

- `calculationDetails.nodeCount` counts the generated mesh nodes too, and `memberCount` counts model members (not the pieces a meshed edge splits them into).
- Error 303 also covers an area id used by both a null area and a shell, and 313 also covers a shell section without `unitWeight`; their messages say so.

## [2.3.0] — 2026-10-24

### Added

- **Projected loads**: `udl` and `trapezoidal` member loads and area loads accept `projected: true` with a global direction (`"X"`, `"Y"`, `"Z"`). The load is then given per unit projected length or area — snow or roof live load per plan length on a sloped rafter, live load per plan area on a ramp — and is applied as `w · Lproj / L` per member length, or `q · |n · direction|` on the true area. A vertical column under projected `"Z"` gets no load. `projected: true` with a local direction or the area normal `"3"`, or on a point or torque load, throws 314 with `field: "projected"`. The member loads returned by `distributeAreaLoads` are already converted to true length.

## [2.2.0] — 2026-10-24

### Added

- **Partial-fixity end releases**: any member end DOF in `releases.start` / `releases.end` (`u1`, `u2`, `u3`, `r1`, `r2`, `r3`) can be a spring stiffness in kN/mm or kN·m/rad instead of `true`, modelling semi-rigid connections. The spring acts in series with the member end; `0` is the same as `true` (fully released). Springs never make a member a mechanism (307).
- **Release deformations**: every load case and combination result has `releaseDeformations`, the node-minus-member displacement across each released or spring end DOF of the members that have any — the rotation across a hinge, or the rotation of a semi-rigid connection.
- **Automatic joint restraint**: joint rotations that no member, support or spring resists (for example every joint of a pin-jointed truss) are held automatically instead of throwing 304, with no effect on the results. They are listed in `calculationDetails.autoRestrainedDofs`. A load with a moment about such a rotation still throws 304, now naming the load case.
- Types `DofRelease`, `ReleaseDeformation`, `MemberReleaseDeformations` and `AutoRestrainedDof`, exported from `/fea` and the package root.

### Changed

- `MemberEndRelease` fields are typed `DofRelease` (`boolean | number`) instead of `boolean`. Release values that are not `true`, `false` or a finite number ≥ 0 are now rejected with 314 (`details.field` such as `"releases.end.r3"`); before, any truthy value counted as a release.

## [2.1.1] — 2026-10-23

### Fixed

- The package root now re-exports `distributeAreaLoads`, the `TrapezoidalMemberLoad`, `TorqueMemberLoad`, `NullArea`, `AreaLoad`, `AreaDistribution` and `AreaLoadDirection` types, and the `AREA_GEOMETRY_TOLERANCE` constant. Since 2.1.0 they were reachable only through the `/fea` and `/core` subpaths.
- The quick-start example on the docs landing page used `fc` instead of `fc_`.

### Documentation

- README: added a quick-start example, the `core` and `utils` exports, error codes, release steps and the license.

## [2.1.0] — 2026-10-23

### Added

- **Trapezoidal member load** (`type: "trapezoidal"`): a load varying linearly from `w1` at `start` to `w2` at `end`. Member diagrams stay exact for it.
- **Torque member load** (`type: "torque"`): a uniform torque per unit length about the member's local 1 axis.
- **Null areas** (`model.areas`) and **area loads** (`model.areaLoads`, kN/m²): 3- or 4-node areas that add no stiffness and pass their loads to the edge members, distributed `"twoWay"`, `"oneWay"` or `"cantilever"`.
- `distributeAreaLoads(model)` returns the member loads generated from the areas, for checking or previewing (from `/fea`).
- `FrameAnalysisError` codes 315 (area geometry), 316 (an area edge without members) and 317 (supports that do not fit the distribution).

### Changed

- Package description and README now present the library as a headless analysis engine for front-end applications.

## [2.0.1] — 2026-10-11

Maintenance release with no changes to the library code.

## [2.0.0] — 2026-10-11

### Breaking changes

- `FrameModel` now requires `loadCases`. Loads move to the top-level lists `nodalLoads` and `memberLoads`, and every load names its `loadCase`.
- `analyzeFrame` returns `{ cases, combinations, envelope, … }` keyed by id, instead of a single result.

### Added

- **3D frame analysis** (`/fea` subpath) by the direct stiffness method: uniform and point member loads in local or global directions, end releases, fixed and spring supports, ETABS-style local axes.
- **Load cases and combinations**: a self-weight multiplier per load case, combinations by superposition (including nested combinations), and an `envelope` reporting the governing combination.
- Member diagrams of forces (`N`, `V2`, `V3`, `T`, `M2`, `M3`) and deflections (`u1`–`u3` local, `ux`–`uz` global) along every member.
- `createFrameAnalysis` to compute member diagrams on demand, and `options.diagrams: "extremes"` for smaller results.
- `validateFrameModel` reports every problem in a model, with `details` locating it. `FrameAnalysisError` codes 301–314.
- `memberDemandEnvelope` turns analysis results into `MuPositive`, `MuNegative`, `Vu` and `Nu` for the RC capacity functions.
- `rectBeamToSectionProperties` (in `/rc`) converts an RC section into frame section properties, with the ACI 318-19 6.6.3.1.1 inertia modifiers and a unit weight for self-weight.
- `beam3dLocalStiffness`, `beam3dLocalStiffnessRightHanded` and `memberAxes`.
- Matrix and skyline solver helpers in `/utils`. Large models solve much faster (an 847-node model in about 1.5 s instead of 16.6 s).
- ES-module build in `dist/esm/` alongside CommonJS, with `"sideEffects": false` so bundlers can drop unused code.

## [1.5.0] — 2026-08-17

### Added

- **Side plate shear strengthening**, with two models because ACI 318-19 has no provisions for steel side plates:
  - `sidePlateShearCapacityByWebYielding` (plate as a supplementary web, AISC 360 G2.1)
  - `sidePlateShearCapacityByTensionTie` (plate as a tie across the crack, ACI 440.2R-17 §11.4 with steel in place of FRP)
  - `compareSidePlateShearCapacity` runs both and reports the lower as governing.
- `hasSidePlate` type guard.
- `RCDesignError` codes 205 (inconsistent side plate geometry) and 206 (no shear headroom left for strengthening).

## [1.4.0] — 2026-08-14

### Changed

- Doubly reinforced sections are solved by strain compatibility. Compression steel below the neutral axis no longer throws: it is treated as tension steel and reported with a warning citing ACI 318-19 22.2.1.2.
- Steel plate jacketing measures every depth from the extreme compression fibre. A top plate now turns a singly reinforced section into a doubly reinforced one.
- `calculationDetails` reports `c`, `a`, `beta1`, `d`, `As` and `ro` for every section. `ro_` uses the same `b·d` basis as `ro`.
- `rectBeamBarLayout` takes `topBars` as optional.

### Deprecated

- `RCDesignError` code 101 (`COMP_STEEL_DISTANCE_OVER_AC`) is no longer thrown. It will be removed in the next major release.

## [1.3.0] — 2026-08-14

### Added

- API reference site, published on GitHub Pages: <https://theerapat-s28.github.io/ts-structural-eng/>.
- `homepage`, `repository` and `bugs` links in the package metadata.

## [1.2.0] — 2026-08-13

### Added

- **Plate-to-concrete interface bolts** for steel plate jacketing:
  - `plateInterfaceShearFlow` (shear flow `q = V·Q/I`, cracked or uncracked section)
  - `boltShearCapacity` (ACI 318-19 17.7.1.2b)
  - `plateInterfaceBoltRequirement` (required bolt pitch and count).
- Top and bottom jacketing plates are each optional, with the `hasTopPlate` and `hasBottomPlate` type guards.
- `RCDesignError` codes 201–204 for strengthening.

### Fixed

- The RC shear functions are now exported from the package root, not only from `/rc`.

## [1.1.0] — 2026-07-19

### Added

- RC shear design per ACI 318-19: `concreteShearCapacity`, `stirrupShearCapacity` and `checkStirrupRequirement`, with `RCDesignError` code 105.
- `rectBeamBarLayout`: arranges bar groups into layers that meet the ACI 318-19 spacing rules and returns `d` and `d_`.

## [1.0.1] — 2026-07-19

### Fixed

- npm packaging: scoped package name `@theerapat-s28/ts-structural-eng-tools`, a build output that matches the `exports` map, and path aliases rewritten in the published JavaScript.

## 1.0.0

First version, under the unscoped name `ts-structural-eng-tools`: `rectBeamMomentCapacity` (singly and doubly reinforced rectangular beams per ACI 318-19), steel plate jacketing, and concrete property helpers.

[Unreleased]: https://github.com/theerapat-s28/ts-structural-eng/compare/v3.3.0...HEAD
[3.3.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v3.2.0...v3.3.0
[3.2.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v2.3.0...v3.0.0
[2.3.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/theerapat-s28/ts-structural-eng/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/theerapat-s28/ts-structural-eng/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v1.5.0...v2.0.0
[1.5.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/theerapat-s28/ts-structural-eng/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/theerapat-s28/ts-structural-eng/releases/tag/v1.0.1
