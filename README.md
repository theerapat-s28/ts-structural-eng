# ts-structural-eng

**📖 [API Reference — theerapat-s28.github.io/ts-structural-eng](https://theerapat-s28.github.io/ts-structural-eng/)** · [npm](https://www.npmjs.com/package/@theerapat-s28/ts-structural-eng-tools) · [Changelog](CHANGELOG.md)

A headless structural analysis and design engine for TypeScript: 3D analysis of frames and shells — beams, columns, braces, walls, slabs and cores — by the direct stiffness method, reinforced-concrete beam design per ACI 318-19, and strengthening methods. It is built to be installed by front-end applications as their calculation core.

## Scope: an engine, not an application

The library does the structural engineering and nothing else. A front-end application installs it, builds a model from its own UI, calls the engine, and draws the results.

| The engine (this package)                                                          | The front-end application                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Model validation with located errors (`details` name the node, member, shell, field…) | Input forms, drawing tools, highlighting the reported problems     |
| Analysis: load cases, combinations, envelopes, member diagrams, shell forces       | Rendering the model, the mesh, deformed shapes, diagrams and contours |
| Design checks with code-clause warnings and `RCDesignError` / `FeaError` | Display of results, member colours, view and display options       |
| Typed inputs and results in SI units                                               | Unit display, project files, undo history, other UI state          |

What this means in practice:

- **No UI, no rendering, no presentation data.** Inputs and results carry structural quantities only; no colours, labels or view state.
- **Plain JSON in, plain JSON out.** Models and results are serialisable, so the engine runs in a Web Worker, in the browser or in Node.js.
- **No runtime dependencies** and no DOM or Node-only APIs.
- **ESM and CommonJS builds** with `.d.ts` types, tree-shakeable (`"sideEffects": false`), split into subpath exports.

## Install

```bash
pnpm add @theerapat-s28/ts-structural-eng-tools
# or: npm install @theerapat-s28/ts-structural-eng-tools
```

Import from a module's subpath — `/fea`, `/rc`, `/strengthening`, `/core` or `/utils` — so a front end loads only what it uses, or from the package root, which re-exports every function, type and constant of every module.

**Upgrading from 2.x?** Nothing was removed, frame-only models give the same results, and the exports renamed in 3.2.0 keep their old names as deprecated aliases. Results gain a few fields, and models with shells bring new error codes and generated mesh nodes; [Upgrading from 2.x](CHANGELOG.md#upgrading-from-2x) in the changelog lists what a front end may need to handle.

## Documentation

Full API reference, with parameter tables, worked examples, warnings and error codes:

- **[API reference](https://theerapat-s28.github.io/ts-structural-eng/)** — landing page
- [FEA — Frame and shell analysis](https://theerapat-s28.github.io/ts-structural-eng/fea/) — `@theerapat-s28/ts-structural-eng-tools/fea`
- [RC Beam Design](https://theerapat-s28.github.io/ts-structural-eng/rc/) — `@theerapat-s28/ts-structural-eng-tools/rc`
- [Strengthening](https://theerapat-s28.github.io/ts-structural-eng/strengthening/) — `@theerapat-s28/ts-structural-eng-tools/strengthening`
- [Shell element theory notes](https://theerapat-s28.github.io/ts-structural-eng/fea/theory/shell-element.html) — how the shell element's stiffness is formed, with its benchmarks
- [Strip forces theory notes](https://theerapat-s28.github.io/ts-structural-eng/fea/theory/strip-forces.html) — how strip forces are integrated from the shell forces, with their sign conventions and checks
- [Pier and spandrel theory notes](https://theerapat-s28.github.io/ts-structural-eng/fea/theory/pier-spandrel.html) — how wall pier and spandrel forces are summed from the element nodal forces, with their sign conventions and checks

The pages are served from [`html-docs/`](https://github.com/theerapat-s28/ts-structural-eng/tree/main/html-docs) via GitHub Pages.

## Quick start

Two models, one with members only and one that adds a slab as shell elements. The values in the comments are what the engine returns for these inputs.

### Frame only: an RC beam from analysis to design check

Analyse a simply supported RC beam under self-weight and live load, envelope the design demands, and check them against the section's flexural capacity:

```ts
import { analyze, memberDemandEnvelope } from "@theerapat-s28/ts-structural-eng-tools/fea";
import type { FeaModel } from "@theerapat-s28/ts-structural-eng-tools/fea";
import {
  rectBeamMomentCapacity,
  rectBeamToSectionProperties,
} from "@theerapat-s28/ts-structural-eng-tools/rc";

// 300×600 beam, f'c 28 MPa, fy 420 MPa, As 1800 mm²
const beam = { Es: 200_000, fc_: 28, fy: 420, As: 1800, b: 300, h: 600, d: 540 };
const { sectionProperties } = rectBeamToSectionProperties(beam, { member: "beam" });

const model: FeaModel = {
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

const result = analyze(model);

// Diagrams along every member, ready for plotting
const { stations } = result.combinations["1.2D+1.6L"].memberDiagrams[0];
stations.find((s) => s.x === 3000); // M3 → 131.328 (kN·m), uz → -10.47731 (mm) at mid-span

// Design demands enveloped over the combinations, then the capacity check
const demand = memberDemandEnvelope(result, "AB");
// demand.MuPositive → 131.328 (kN·m), demand.Vu → 87.552 (kN), governed by "1.2D+1.6L"

const { phiMn, warnings } = rectBeamMomentCapacity(beam);
// phiMn → 331.39 (kN·m), warnings → []
```

`rectBeamToSectionProperties` gives the frame section of an RC rectangle with the ACI 318-19 6.6.3.1.1 cracked inertia (0.35 Ig for a beam) and a unit weight, so `selfWeight: 1` loads the beam with its own weight.

### Frame with shells: a slab on edge beams and columns

A 6 × 5 m, 200 mm slab on four edge beams and four columns. The slab is one shell area; the engine meshes it, splits the edge beams at the mesh nodes so they share them with the slab, and reports the slab's forces per element:

```ts
import { analyze, memberDemandEnvelope } from "@theerapat-s28/ts-structural-eng-tools/fea";
import type { FeaModel } from "@theerapat-s28/ts-structural-eng-tools/fea";
import {
  concreteElasticModulus,
  rectBeamToSectionProperties,
} from "@theerapat-s28/ts-structural-eng-tools/rc";

const fc_ = 28; // MPa
const beam = rectBeamToSectionProperties({ fc_, b: 300, h: 600 }, { member: "beam" });
const column = rectBeamToSectionProperties({ fc_, b: 400, h: 400 }, { member: "column" });
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

const model: FeaModel = {
  nodes: [
    { id: "A", x: 0, y: 0, z: 3500 }, // slab corners, mm
    { id: "B", x: 6000, y: 0, z: 3500 },
    { id: "C", x: 6000, y: 5000, z: 3500 },
    { id: "D", x: 0, y: 5000, z: 3500 },
    { id: "A0", x: 0, y: 0, z: 0 }, // column bases
    { id: "B0", x: 6000, y: 0, z: 0 },
    { id: "C0", x: 6000, y: 5000, z: 0 },
    { id: "D0", x: 0, y: 5000, z: 0 },
  ],
  members: [
    ...["A", "B", "C", "D"].map((id) => ({
      id: `col${id}`,
      startNodeId: `${id}0`,
      endNodeId: id,
      section: column.sectionProperties,
    })),
    { id: "AB", startNodeId: "A", endNodeId: "B", section: beam.sectionProperties }, // edge beams
    { id: "BC", startNodeId: "B", endNodeId: "C", section: beam.sectionProperties },
    { id: "CD", startNodeId: "C", endNodeId: "D", section: beam.sectionProperties },
    { id: "DA", startNodeId: "D", endNodeId: "A", section: beam.sectionProperties },
  ],
  restraints: ["A0", "B0", "C0", "D0"].map((nodeId) => ({ nodeId, ...fixed })),
  shells: [
    {
      id: "slab",
      nodeIds: ["A", "B", "C", "D"], // counter-clockwise seen from above, so local 3 = +Z
      section: { thickness: 200, E: concreteElasticModulus(fc_), nu: 0.2, unitWeight: 24 },
      mesh: { maxSize: 500 }, // the engine divides it into 12 × 10 elements
    },
  ],
  loadCases: [
    { id: "D", type: "dead", selfWeight: 1 },
    { id: "L", type: "live" },
  ],
  areaLoads: [{ loadCase: "L", areaId: "slab", direction: "Z", q: -3 }], // kN/m²
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

const result = analyze(model);
const mesh = result.mesh!; // present whenever the model has shells

// Draw the mesh: 120 elements, each with its four corner nodes
const xyz = new Map([...model.nodes, ...mesh.nodes].map((n) => [n.id, n]));
const quads = mesh.shells.map((element) => element.nodeIds.map((id) => xyz.get(id)!));
// mesh.shells[0] → { id: "slab:0,0", areaId: "slab", nodeIds: ["A", "A~B:1", "slab:1,1", "A~D:1"] }

// Slab moments at the element corners, in the slab's local axes (local 1 = +X here)
const combo = result.combinations["1.2D+1.6L"];
const M11 = combo.shellForces.flatMap((element) => element.corners.map((c) => c.M11));
// Math.max(...M11) → 18.849 (kN·m/m), sagging at the slab centre
// Math.min(...M11) → -15.4157 (kN·m/m), hogging at the corners over the columns

// Node results include the generated nodes; "slab:6,5" is the slab centre
combo.nodalDisplacements.find((d) => d.nodeId === "slab:6,5"); // uz → -4.99265 (mm)

// The edge beams are split at the mesh nodes, but report under their own ids
memberDemandEnvelope(result, "AB"); // MuPositive → 45.8202, MuNegative → 37.2024 (kN·m), Vu → 56.5957 (kN)

combo.reactions.reduce((sum, r) => sum + r.fz, 0); // → 495.36 (kN), the total factored load
```

What changes for the front end when a model has shells:

- **Generated nodes.** `result.mesh.nodes` holds the nodes the engine generated, and `nodalDisplacements` and `reactions` list them after your own nodes. Their ids are strings even when yours are numbers: `"<areaId>:<i>,<j>"` inside an area, `"<a>~<b>:<k>"` along an edge between your nodes `a` and `b`.
- **Elements.** `result.mesh.shells` lists every element with its four nodes. `shellForces` and `envelope.shells` have one entry per element, named by `shellId`, with `areaId` linking it back to your area. An area that is not meshed is one element with the area's own id.
- **Shell forces** come at each element's corners, in its local axes: membrane forces `F11`, `F22`, `F12` (kN/m), moments `M11`, `M22`, `M12` (kN·m/m, positive with the −3 face in tension, i.e. sagging when local 3 is up), transverse shears `V13`, `V23` (kN/m) and top and bottom face stresses `S11Top` … `S12Bot` (MPa). Elements meeting at a node give different values there, as usual for shell results; average them for a smooth contour.
- **Members** keep their own ids in every result, even where a meshed edge splits them, and `calculationDetails.memberCount` counts your members.

### Running in a Web Worker

Model and result are plain JSON, so post the model to a worker, run `analyze` there, and post the result back; the page stays responsive on large models. For big results, analyse with `{ diagrams: "extremes" }`, which keeps every diagram's extremes (so envelopes and `memberDemandEnvelope` still work) but drops the stations, and draw a member's full diagram on demand with `createAnalysis(model).memberDiagram(resultId, memberId)`. The reference has a [worker example](https://theerapat-s28.github.io/ts-structural-eng/fea/#frontend).

On a desktop PC (Intel Core i5-13500, Node.js 24):

| Model | Analysis time |
| --- | --- |
| Frame building: 880 nodes, 2 163 members, 3 load cases and 3 combinations | 1.7 s; with `diagrams: "extremes"` the result is 3.8× smaller (15 MB of JSON instead of 57 MB) |
| Slab on beams and columns: 4 × 4 bays, 2 304 shell elements, 14 556 DOFs | 1.7 s |

## API

Summarised below; see the [full API reference](https://theerapat-s28.github.io/ts-structural-eng/) for parameter tables, units, warnings and error codes.

### FEA — Frame and shell analysis

Linear-elastic 3D analysis by the direct stiffness method, from `@theerapat-s28/ts-structural-eng-tools/fea`. Global axes X, Y, Z (Z up); members and shells use local axes 1, 2, 3. Inputs are in mm, MPa, kN, kN·m and kN/m²; results are in kN, kN·m, mm and rad, and shell forces in kN/m, kN·m/m and MPa, as listed in `result.units`.

**Renamed in 3.2.0.** A model may have no frame members at all, e.g. a mat foundation, so the exports that apply to the whole model no longer say "frame": `analyzeFrame` → `analyze`, `createFrameAnalysis` → `createAnalysis`, `validateFrameModel` → `validateModel`, `AnalyzeFrameOptions` → `AnalyzeOptions`, `FrameAnalysis` → `Analysis`, and `Frame` → `Fea` in `FeaModel`, `FeaResult`, `FeaCaseResult`, `FeaEnvelope`, `FeaMesh`, `FeaNode`, `FeaId`, `FeaModelIssue`, `FeaErrorDetails`, `FeaError` and `FeaErrors`. The old names still work as deprecated aliases and are removed in 4.0.0.

#### Functions

- **`analyze(model, options?)`** — Validates the model, analyses every load case and forms every combination by superposition. The stiffness is factorised once for all cases, and combination diagrams are rebuilt from the combined forces, so their extremes are exact rather than sums of case extremes. `options.stations` sets the stations per member diagram (default 21); `options.diagrams: "extremes"` keeps only each diagram's extremes. Returns a `FeaResult`.
- **`createAnalysis(model, options?)`** — The same analysis, keeping the solution: returns `{ result, memberDiagram(resultId, memberId, stations?) }` to compute a member's full diagram on demand.
- **`validateModel(model)`** — Checks a model without analysing it and returns every problem, each with `details` (`nodeId`, `memberId`, `areaId`, `shellId`, `edge`, `loadCaseId`, `combinationId`, `field`, `dof`) for highlighting in a UI. `analyze` runs it first and throws the first problem as a `FeaError` whose `issues` lists all of them.
- **`distributeAreaLoads(model)`** — Returns `{ memberLoads, warnings }`: the member loads that the model's null areas send to their edge members, exactly what `analyze` adds, for checking or previewing. Loads on shells act on the shells and are not included.
- **`memberConnectivity(model)`** — Returns `{ intermediateNodes, nearMissNodes, warnings }`: the model nodes each member is connected to and the nodes that just miss a member, the same check `analyze` makes, without analysing. It doesn't throw for a model that is still being edited, so a frontend can mark the points on every edit. It also reports a near miss that leaves the model unstable, when `analyze` throws 304 and returns no result.
- **`memberDemandEnvelope(result, memberId, options?)`** — Reduces a member's diagrams to `MuPositive`, `MuNegative`, `Vu` (optionally from distance `d` off the supports) and `Nu`, enveloped over all combinations (or the `combinations` / `cases` you select), with the `governing` combination of each, for the RC capacity functions.
- **`rectBeamToSectionProperties(section, options?)`** (from `rc`) — Converts a rectangular RC section into `SectionProperties` (`E`, `G`, `A`, `I22`, `I33`, `J`, `unitWeight`) with the ACI 318-19 6.6.3.1.1 inertia modifiers (0.35 beams, 0.70 columns) and a unit weight for self-weight (default 24 kN/m³, common practice rather than an ACI value).
- **`beam3dLocalStiffness(E, G, A, I22, I33, J, L)`** — The 12×12 local stiffness matrix exactly as in the reference "Complete Beam Stiffness Matrix". Its bending rotations R2 and R3 follow the opposite sign to the right-hand rule; **`beam3dLocalStiffnessRightHanded`** returns the right-handed form that `analyze` uses.
- **`memberAxes(start, end, angle?)`** — The local axes of a member as a direction-cosine matrix.

#### The model

A `FeaModel` is plain data. Every load names its `loadCase`, so loads are flat top-level lists:

| Field | What it holds |
| --- | --- |
| `nodes` | `{ id, x, y, z }` in mm; ids are strings or numbers |
| `members` | `{ id, startNodeId, endNodeId, section, angle?, releases?, connectIntermediateNodes? }`, with `section` a `SectionProperties`; omit for a model of shells only |
| `restraints` | Per node, each DOF `ux` … `rz` fixed (`true`) or a spring (kN/mm, kN·m/rad) |
| `lineRestraints` | `{ nodeIds: [a, b], ux? … rz? }`: fixes those DOFs at every node on the line from `a` to `b`, generated mesh nodes included, e.g. a wall base |
| `loadCases` | `{ id, name?, type?, selfWeight? }`; `selfWeight: 1` applies the full self-weight of members and shells |
| `nodalLoads` | `{ loadCase, nodeId, fx? … mz? }` in kN and kN·m |
| `memberLoads` | Uniform (`"udl"`), `"trapezoidal"` and `"point"` loads in local (`"1"`–`"3"`) or global (`"X"`–`"Z"`) directions, and `"torque"` about the member axis; uniform and trapezoidal loads in a global direction can be per unit projected length (`projected: true`), e.g. snow on a sloped rafter |
| `areas` | Null areas, `{ id, nodeIds, distribution, supportEdges? }` |
| `shells` | Shell areas, `{ id, nodeIds, type?, section, angle?, modifiers?, mesh? }` |
| `areaLoads` | `{ loadCase, areaId, direction, q, projected? }` in kN/m², on a null area or a shell; `direction` is the area's normal `"3"` or a global axis |
| `combinations` | `{ id, name?, terms }`, each term `{ case, factor }` or `{ combination, factor }`; nested combinations are expanded |
| `strips` | Design strips across shells, `{ id, points, widthLeft, widthRight, normal?, maxSpacing? }`; see [Strip forces](#strip-forces) |
| `piers`, `spandrels` | Wall piers `{ id, areaIds?, memberIds?, cuts?, angle? }` and spandrels `{ id, areaIds, memberIds?, cuts?, reverse? }`; see [Pier and spandrel forces](#pier-and-spandrel-forces) |

#### Members

End releases on any of the six end DOFs, full (`true`) or partial fixity (a spring stiffness in series with the member end), with the deformation across each release reported in `releaseDeformations`. Supports are fixed or springs. Joint rotations that no member resists, as at pin-jointed truss joints, are held automatically and listed in `calculationDetails.autoRestrainedDofs`.

Draw a girder once, from support to support: a model node lying on a member between its ends, such as where a beam frames in or a column lands mid-span, is connected to it automatically. The member is split there internally and still reported as one member. Each connection is listed in `calculationDetails.intermediateNodes`. A node within 1 % of the member length (at most 100 mm) of a member, but not on it, is not connected: it is listed in `calculationDetails.nearMissNodes` and gets a "Member connectivity" warning, which catches a node that was meant to snap to the member but didn't. Draw both lists in their own colours so users can see that the model connects the way they think, and call `memberConnectivity(model)` to get them while the user draws, without analysing. Set `connectIntermediateNodes: false` on a member to connect it only at its ends.

#### Null areas or shells

Both are areas that take `areaLoads`, and they share one id namespace.

- **A null area** adds no stiffness: it only sends its loads to the members along its edges. It has 3 or 4 nodes forming a planar convex polygon. `"twoWay"` sends each point to its nearest edge (the corner-bisector split, any convex shape); `"oneWay"` spans strips between the listed `supportEdges`, parallel to the unsupported edges, half to each end; `"cantilever"` (rectangles) puts `q·c` and a torque `q·c²/2` on its one support edge. Edges split by intermediate nodes are cut at them. Use it for slabs whose stiffness you leave out of the model.
- **A shell area** has its own stiffness and shares nodes with members and other shells; use it for walls, cores, transfer slabs and mats. It is a four-node flat shell: a drilling-rotation membrane, so a beam framing into a wall in its plane transfers its moment, and a thin (DKQ) plate. `type` is `"shell"` (both parts, the default), `"membrane"` or `"plate"`. `section` is `{ thickness, E, nu, unitWeight? }`, and `modifiers` scale the membrane (`f11`, `f22`, `f12`) and bending (`m11`, `m22`, `m12`) stiffness and the self-weight (`weight`), e.g. for the cracked-section values of ACI 318-19 Table 6.6.3.1.1. Slightly warped quads are allowed, up to `SHELL_WARPING_LIMIT` (0.1·√A off the plane). Local 3 follows the right-hand rule around `nodeIds`, local 2 points up on walls and local 1 is +X on horizontal shells; `angle` rotates them.
- **Meshing.** Give a shell `mesh: { maxSize }` (mm) or `mesh: { divisions: [n1, n2] }` and the engine divides it into elements. Neighbouring areas share their mesh nodes, including where an area edge meets another at a node; model nodes on an area edge become mesh nodes; and members along a meshed edge are split there internally. Fix supports along a meshed edge with `lineRestraints`, which reach the generated nodes.

#### Strip forces

Draw a design strip over a slab and `analyze` returns the forces on cuts across it. The front end draws the strip; the engine takes it as data: a centreline polyline `points` (`{ x, y, z }` in mm, at least two) with `widthLeft` and `widthRight` measured from it (left seen from above). The strip lies in the plane through its points normal to `normal` (default `[0, 0, 1]`) and picks up every shell element in that plane; walls and other planes are ignored.

Stations sit at every polyline point and no further apart than `maxSpacing` (default: 20 divisions per segment); a bend has two stations, one normal to each segment. At each station the engine integrates each element's own force field along the cut and returns, in strip axes (1 along, 2 across to the left, 3 the normal), `P` (axial, + tension), `V` (shear, `V = −dM/dx`), `M` (bending, + sagging), `T` (torsion about the strip axis), `Vp` and `Mp` (in-plane shear and moment), plus each divided by the covered `width` in `perWidth`. A cut that is not fully on shells (an opening, a slab edge) integrates what it covers and reports its `width`, with a warning. Strip forces are linear, so combinations superpose them, and `envelope.strips` gives the max and min at every station. The [strip forces theory notes](https://theerapat-s28.github.io/ts-structural-eng/fea/theory/strip-forces.html) show how each value is calculated.

```ts
const result = analyze({
  ...model, // a slab of shells
  strips: [
    {
      id: "CS-1",
      points: [{ x: 0, y: 1000, z: 0 }, { x: 6000, y: 1000, z: 0 }],
      widthLeft: 1000, // mm
      widthRight: 1000, // mm
      maxSpacing: 500, // mm
    },
  ],
});
const strip = result.combinations.ULS.stripForces[0];
// strip.stations[i] → { x, point, segment, width, P, V, M, T, Vp, Mp, perWidth: { … } }
```

A strip with a horizontal `normal` also works up a single flat wall (`P`, `Vp`, `Mp`); for grouped walls, cores and walls with columns, use piers.

#### Pier and spandrel forces

Group walls into piers and coupling beams into spandrels and `analyze` returns one resultant per cut across each group, for wall design. A pier lists vertical shell areas (`areaIds`: wall legs, planar or not, connected or not) and members (`memberIds`: boundary or embedded columns). It is cut at the bottom and top of each lift, between consecutive elevations where any of its areas or members starts or ends: a floor level shared by two lifts gives a `"top"` cut from below and a `"bottom"` cut from above, which differ by what the floor delivers. `cuts` adds elevations. A spandrel lists areas in one vertical plane, plus beams along it, and is cut at its `"left"` and `"right"` ends and at the distances in `cuts`. Every cut must lie on the mesh lines of the areas it meets (error 331 otherwise); separate legs are summed together.

Each cut gives `P`, `V2`, `V3`, `T`, `M2`, `M3` (kN, kN·m) about the centroid of the cut section, with the signs of member internal forces: pier axis 1 is up and 2 runs along its longest area (or set it with `angle`); spandrel axis 1 runs along the wall toward +X or +Y (flip it with `reverse`) and 2 is up. Each cut also lists its `section` (each leg's end points and thickness, each member's position and area, the total length, area and centroid) for a later wall design. The forces are the element nodal forces summed at the cut, so they are in exact equilibrium with the loads, and they superpose: `envelope.piers` and `envelope.spandrels` give the max and min at every cut. The [pier and spandrel theory notes](https://theerapat-s28.github.io/ts-structural-eng/fea/theory/pier-spandrel.html) show how each value is calculated.

```ts
const result = analyze({
  ...model, // walls of shells, coupled over an opening
  piers: [
    { id: "P1", areaIds: ["W1", "W1top"] },
    { id: "P2", areaIds: ["W2", "W2top"] },
  ],
  spandrels: [{ id: "S1", areaIds: ["SP"] }],
});
const pier = result.combinations.ULS.pierForces[0];
// pier.cuts[i] → { z, face: "bottom" | "top" | "cut", P, V2, V3, T, M2, M3, section: { legs, members, length, area, centroid } }
const spandrel = result.combinations.ULS.spandrelForces[0];
// spandrel.cuts[i] → { x, face: "left" | "right" | "cut", P, V2, V3, T, M2, M3, section }
```

#### The result

| Field | What it holds |
| --- | --- |
| `cases`, `combinations` | Results keyed by id, each with `nodalDisplacements`, `reactions`, `memberEndForces`, `releaseDeformations`, `memberDiagrams` (`N`, `V2`, `V3`, `T`, `M2`, `M3` and deflections `u1`–`u3` local, `ux`–`uz` global, along each member), `shellForces`, `stripForces`, `pierForces`, `spandrelForces`, an `equilibriumResidual` check and `warnings` |
| `envelope` | Max and min of every result over the combinations, with the governing combination; absent without combinations |
| `mesh` | The generated nodes and every shell element with its nodes; absent without shells |
| `calculationDetails` | Node (generated included), member, shell-element, DOF, load case and combination counts, `profileSize`, `autoRestrainedDofs`, `intermediateNodes` and `nearMissNodes` |
| `units`, `warnings` | The unit of each kind of result, and the warnings of every case and combination |

Invalid models and unstable structures throw `FeaError`, described under [Errors and warnings](#errors-and-warnings-from-core).

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

### Concrete properties (from `rc`)

- **`concreteBeta(fc_)`** — ACI 318 β₁ factor
- **`concreteElasticModulus(fc_)`** — Ec = 4700√f'c (MPa)
- **`psiToMpa(psi)`** — Unit conversion

### Errors and warnings (from `core`)

A design that is valid but breaks a code provision returns normally with an entry in `warnings`, citing the clause (e.g. `"ACI318-19, 9.6.1.2"`). A calculation whose assumptions break down throws instead, never returning a silently wrong result:

- **`RCDesignError`** — `code` and `message` from `Errors`: 1XX for RC beam design (e.g. 102, tensile steel not yielding; 105, `Vs` above the 22.5.1.2 limit), 2XX for strengthening and plate connections (201–206).
- **`FeaError`** — `code` and `message` from `FeaErrors`, `details` locating the problem, and `issues` listing every problem `validateModel` found. Codes 301–317 cover the model, members, loads, null areas and combinations (304 is an unstable structure); 326–329 cover shells: 326 invalid geometry, 327 invalid section, 328 a translation that nothing resists at a node connected only to membranes or plates, 329 an area that cannot be meshed; 330 is an invalid strip; 331 an invalid pier or spandrel. Match on `code`, not on `message`.

`core` also exports the shared input types, the type guards `isSinglyReinforced`, `hasTopPlate`, `hasBottomPlate` and `hasSidePlate`, and the engineering constants (φ factors, ultimate concrete strain, inertia modifiers, frame-analysis tolerances, `SHELL_WARPING_LIMIT`).

### Utilities (from `utils`)

Low-level helpers the engine is built on, exported for reuse: `solveQuadratic`, `roundToDecimalPlaces`, `mergeWarnings`, dense matrix helpers (`zeros`, `identity`, `transpose`, `matMul`, `matVec`), Cholesky and general linear solvers (`choleskyFactor`, `choleskySolveFactored`, `choleskySolve`, `solveLinearSystem`), and the skyline solver (`createSkyline`, `skylineAdd`, `skylineGet`, `skylineSize`, `skylineFactor`, `skylineSolve`, `reverseCuthillMcKee`).

## Development

To work on the library itself you need a current Node.js LTS (22 or later) and pnpm. Install the dependencies with:

```bash
pnpm install
```

### Scripts

| Command                 | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `pnpm run dev`          | Run [`examples/EX-0001-basic-usage/basic-usage.ts`](examples/EX-0001-basic-usage/basic-usage.ts) against the sources with `ts-node` |
| `pnpm run build`        | Compile `src/` into `dist/` (CommonJS and `.d.ts`) and `dist/esm/` (ES modules) |
| `pnpm run lint`         | Lint source files with ESLint                                 |
| `pnpm run lint:fix`     | Auto-fix lint issues                                          |
| `pnpm run format`       | Format code with Prettier                                     |
| `pnpm run format:check` | Check formatting without writing                              |
| `pnpm run test`         | Run unit tests with Vitest                                    |
| `pnpm run test:watch`   | Run tests in watch mode                                       |

### Project layout

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
│   ├── deprecated.ts     # Names before 3.2.0 (analyzeFrame, FrameModel, …), aliases until 4.0.0
│   ├── shared/           # The base every part builds on
│   │   ├── index.ts
│   │   ├── types/            # Nodes, restraints, area loads
│   │   ├── solver/           # Generic element assembly, boundary conditions, automatic restraint
│   │   └── validation/       # Issue helpers shared by the model checks
│   ├── frame/            # Frame members (3D beam element) and null areas
│   │   ├── index.ts
│   │   ├── area/             # Null areas: geometry, edge-member chains, area-load distribution
│   │   ├── elements/         # Reference beam stiffness matrix, fixed-end forces, end releases and partial-fixity condensation
│   │   ├── transformation/   # Local axes and the 12×12 transformation
│   │   ├── solver/           # Member pieces, nodes along members, member-load resolution, member assembly helpers
│   │   ├── validation/       # Checks on members, member loads and null areas
│   │   ├── post/             # Member force diagrams
│   │   └── types/            # Member, member-load and null-area types; member result types
│   ├── shell/            # Flat shell element (drilling membrane + DKQ plate)
│   │   ├── index.ts
│   │   ├── elements/         # Membrane, DKQ plate, flat shell, local axes, warping links, quad geometry
│   │   ├── mesh/             # Shell-area meshing
│   │   ├── solver/           # Shell elements of the system and their surface-load vectors
│   │   ├── post/             # Shell forces and stresses, strip forces
│   │   ├── validation/       # Checks on shell areas and strips
│   │   └── types/            # Shell-area and strip model and result types
│   └── analysis/         # The whole model, members and shells together (direct stiffness method)
│       ├── index.ts
│       ├── mesh/             # The analysed model: shell mesh, line restraints, member splitting at model and mesh nodes
│       ├── solver/           # System build + skyline factorisation, per-case solve, combinations, analyze, distributeAreaLoads
│       ├── validation/       # validateModel: every input problem, with its location; pier and spandrel checks
│       ├── post/             # Result presentation, envelopes, design demands, pier and spandrel forces
│       └── types/            # FeaModel (load cases, combinations, nodal loads, line restraints, piers, spandrels) and FeaResult
├── core/                 # Shared infrastructure
│   ├── index.ts
│   ├── constants/        # RC design constants (ACI 318) in rc.constant.ts; FEA constants in fea.constant.ts (shared), frame.constant.ts and shell.constant.ts
│   ├── errors/           # RCDesignError and FeaError with their coded entries
│   └── types/            # Shared types: RC sections, plate jacketing, section properties, warnings, units
└── utils/                # Helper utilities
    ├── index.ts
    ├── math.ts           # Quadratic solver, rounding
    ├── matrix.ts         # Dense matrix helpers, Cholesky (factor once, solve many) and general linear solvers
    ├── skyline.ts        # Skyline (banded) Cholesky solver and reverse Cuthill–McKee ordering
    └── merge-warning.ts  # Warning array merging
examples/                 # One folder per example, EX-<number>-<name>
├── EX-0001-basic-usage/      # RC beam capacity and steel-plate jacketing (pnpm run dev)
├── EX-0002-slab-on-columns/  # Flat plate on four columns, with its model.json and result.json
└── EX-0003-shear-wall/       # Meshed shear wall, with its model.json and result.json
tests/
├── rc/                   # Tests for RC module
├── strengthening/        # Tests for strengthening module
├── fea/frame/            # Tests for members and null areas
├── fea/shell/            # Tests for shell elements, meshing and shell results
├── fea/shared/           # Tests for element assembly and automatic restraint
├── fea/analysis/         # Tests for analyze, combinations, validation, errors and RC integration
└── utils/                # Tests for utilities
html-docs/                # HTML API reference, deployed to GitHub Pages
├── DESIGN.md             # Style guide for the doc pages
├── index.html            # Landing page
├── rc/index.html
├── strengthening/index.html
├── fea/index.html
├── fea/theory/
│   ├── shell-element.html  # Shell element theory notes
│   ├── strip-forces.html   # Strip forces: theory and how they are calculated
│   └── pier-spandrel.html  # Pier and spandrel forces: theory and how they are calculated
└── shell-element.html    # Redirect to fea/theory/shell-element.html (old address)
ROADMAP.md                # FEA roadmap and implementation plan (not published)
.agents/skills/update-version/ # AI agent skill: bump the version and roll the changelog
.claude/skills/npm-publish/ # AI agent skill: release checklist for publishing to npm
```

### TypeScript path aliases

The sources import each other through `baseUrl` + `paths` aliases:

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

They are duplicated in `vitest.config.ts`, registered at runtime by `tsconfig-paths` in the `dev` script, and rewritten into relative paths by `tsc-alias` when building.

### Build

```bash
pnpm run build
```

The build emits a CommonJS build in `dist/` (for `require`, with the `.d.ts` types) and an ES-module build in `dist/esm/` (for `import` and bundlers such as Vite); `package.json` `exports` routes each subpath to the right one, and `"sideEffects": false` lets bundlers drop unused code. Only `dist/`, `README.md`, `CHANGELOG.md` and `LICENSE` are published.

### Tests

```bash
pnpm run test                                   # all tests
pnpm vitest run tests/rc/rc-beam-design.test.ts # one file
```

Tests live in `tests/`, mirroring `src/`, and check results against hand-calculated or textbook values.

### Releasing

Releases follow semantic versioning and are published to npm with tags `vX.Y.Z`. What changed in each version is in [CHANGELOG.md](CHANGELOG.md). Preparing a version (changelog, version number, checks) is described in [`.agents/skills/update-version/SKILL.md`](.agents/skills/update-version/SKILL.md), and publishing (release commit and tag, dry run, publish, push tags) in [`.claude/skills/npm-publish/SKILL.md`](.claude/skills/npm-publish/SKILL.md).

## License

[ISC](LICENSE)

## Trademarks

ETABS, SAFE and SAP2000 are registered trademarks of Computers and Structures, Inc. This project is not affiliated with or endorsed by Computers and Structures, Inc.
