/**
 * A shear wall meshed into shell elements: the model a front end sends to `analyze` and the
 * result it gets back, saved as model.json and result.json next to this file.
 *
 * Run with: pnpm exec ts-node -r tsconfig-paths/register examples/EX-0003-shear-wall/shear-wall.ts
 */

import { writeFileSync } from "fs";
import { join } from "path";

import { analyze, concreteElasticModulus } from "../../src";
import type { FeaModel } from "../../src";

// 4 m long × 3 m high wall, 200 mm thick, in the XZ plane
const model: FeaModel = {
  nodes: [
    { id: "W1", x: 0, y: 0, z: 0 }, // base, mm
    { id: "W2", x: 4000, y: 0, z: 0 },
    { id: "W3", x: 4000, y: 0, z: 3000 }, // top
    { id: "W4", x: 0, y: 0, z: 3000 },
  ],
  restraints: [],
  // Fixes every node along the base, including the ones the mesh generates
  lineRestraints: [
    { nodeIds: ["W1", "W2"], ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
  ],
  shells: [
    {
      id: "wall",
      nodeIds: ["W1", "W2", "W3", "W4"], // local 2 = up, local 1 = +X, local 3 = −Y
      section: { thickness: 200, E: concreteElasticModulus(28), nu: 0.2, unitWeight: 24 },
      mesh: { maxSize: 1000 }, // 4 × 3 elements
    },
  ],
  loadCases: [{ id: "W", type: "wind" }],
  nodalLoads: [{ loadCase: "W", nodeId: "W4", fx: 100 }], // kN, in-plane shear at the top
};

const result = analyze(model);

writeFileSync(join(__dirname, "model.json"), JSON.stringify(model, null, 2) + "\n");
writeFileSync(join(__dirname, "result.json"), JSON.stringify(result, null, 2) + "\n");

const wind = result.cases.W;
console.log("── Shear wall ──");
console.log(
  "  Mesh:",
  result.mesh!.shells.length,
  "elements,",
  result.mesh!.nodes.length,
  "generated nodes",
);
console.log(
  "  Σ reactions fx =",
  wind.reactions.reduce((sum, r) => sum + r.fx, 0),
  "kN",
);
console.log("  Top drift ux =", wind.nodalDisplacements.find((d) => d.nodeId === "W4")!.ux, "mm");
console.log("  Written to", __dirname);
