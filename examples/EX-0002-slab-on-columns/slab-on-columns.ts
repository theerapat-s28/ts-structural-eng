/**
 * A flat plate on four columns: the model a front end sends to `analyze` and the result it gets
 * back, saved as model.json and result.json next to this file.
 *
 * Run with: pnpm exec ts-node -r tsconfig-paths/register examples/EX-0002-slab-on-columns/slab-on-columns.ts
 */

import { writeFileSync } from "fs";
import { join } from "path";

import { analyze, concreteElasticModulus, rectBeamToSectionProperties } from "../../src";
import type { FeaModel } from "../../src";

const fc_ = 28; // MPa
const column = rectBeamToSectionProperties({ fc_, b: 400, h: 400 }, { member: "column" });
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

// 6 × 6 m slab, 200 mm thick, on four 400 × 400 columns 3.5 m tall; no beams
const model: FeaModel = {
  nodes: [
    { id: "A", x: 0, y: 0, z: 3500 }, // slab corners, mm
    { id: "B", x: 6000, y: 0, z: 3500 },
    { id: "C", x: 6000, y: 6000, z: 3500 },
    { id: "D", x: 0, y: 6000, z: 3500 },
    { id: "A0", x: 0, y: 0, z: 0 }, // column bases
    { id: "B0", x: 6000, y: 0, z: 0 },
    { id: "C0", x: 6000, y: 6000, z: 0 },
    { id: "D0", x: 0, y: 6000, z: 0 },
  ],
  members: ["A", "B", "C", "D"].map((id) => ({
    id: `col${id}`,
    startNodeId: `${id}0`,
    endNodeId: id,
    section: column.sectionProperties,
  })),
  restraints: ["A0", "B0", "C0", "D0"].map((nodeId) => ({ nodeId, ...fixed })),
  shells: [
    {
      id: "slab",
      nodeIds: ["A", "B", "C", "D"], // counter-clockwise seen from above, so local 3 = +Z
      section: { thickness: 200, E: concreteElasticModulus(fc_), nu: 0.2, unitWeight: 24 },
      // 2 × 2 elements keep the JSON short enough to read; refine (e.g. maxSize: 500) for design values
      mesh: { divisions: [2, 2] },
    },
  ],
  loadCases: [
    { id: "D", type: "dead", selfWeight: 1 },
    { id: "L", type: "live" },
  ],
  areaLoads: [{ loadCase: "L", areaId: "slab", direction: "Z", q: -2 }], // kN/m²
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

writeFileSync(join(__dirname, "model.json"), JSON.stringify(model, null, 2) + "\n");
writeFileSync(join(__dirname, "result.json"), JSON.stringify(result, null, 2) + "\n");

const combo = result.combinations["1.2D+1.6L"];
console.log("── Slab on four columns ──");
console.log(
  "  Mesh:",
  result.mesh!.shells.length,
  "elements,",
  result.mesh!.nodes.length,
  "generated nodes",
);
// The total factored load: 1.2 · (172.8 slab + 53.76 columns) + 1.6 · 72 = 387.072 kN
console.log(
  "  Σ reactions fz =",
  combo.reactions.reduce((sum, r) => sum + r.fz, 0),
  "kN",
);
console.log(
  "  Slab centre uz =",
  combo.nodalDisplacements.find((d) => d.nodeId === "slab:1,1")!.uz,
  "mm",
);
console.log("  Written to", __dirname);
