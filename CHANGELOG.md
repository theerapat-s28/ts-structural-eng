# Changelog

All notable changes to `@theerapat-s28/ts-structural-eng-tools` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses [semantic versioning](https://semver.org/): a **major** release can break existing code, a **minor** release adds features, a **patch** release fixes bugs.

## [Unreleased]

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

[Unreleased]: https://github.com/theerapat-s28/ts-structural-eng/compare/v2.3.0...HEAD
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
