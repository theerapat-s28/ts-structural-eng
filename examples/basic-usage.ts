/**
 * Example usage of the ts-structural-eng library.
 *
 * Run with: pnpm run dev
 */

import { calculateSteelJacketedBeamMomentCapacity, rectBeamMomentCapacity } from "../src";

// ── 1. Singly-reinforced beam ───────────────────────────────────────────────

const singlyResult = rectBeamMomentCapacity({
  Es: 207_000,
  fc_: 25,
  fy: 240,
  As: 1520, // 4-DB22
  b: 250,
  h: 500,
  d: 450,
});

console.log("── Singly-reinforced beam ──");
console.log("  φMn =", singlyResult.phiMn, singlyResult.unit);
console.log("  Details:", singlyResult.calculationDetails);
if (singlyResult.warnings.length > 0) {
  console.log("  Warnings:", singlyResult.warnings);
}

// ── 2. Doubly-reinforced beam ───────────────────────────────────────────────

const doublyResult = rectBeamMomentCapacity({
  Es: 207_000,
  fc_: 25,
  fy: 240,
  As: 1520, // 4-DB22
  As_: 603, // 2-DB20
  b: 250,
  h: 500,
  d: 450,
  d_: 50,
});

console.log("\n── Doubly-reinforced beam ──");
console.log("  φMn =", doublyResult.phiMn, doublyResult.unit);
console.log("  Details:", doublyResult.calculationDetails);
if (doublyResult.warnings.length > 0) {
  console.log("  Warnings:", doublyResult.warnings);
}

// ── 3. Beam with steel-plate jacketing ──────────────────────────────────────

const jacketedResult = calculateSteelJacketedBeamMomentCapacity(
  {
    Es: 207_000,
    fc_: 25,
    fy: 240,
    As: 1520, // 4-DB22
    As_: 603, // 2-DB20
    b: 250,
    h: 500,
    d: 450,
    d_: 50,
  },
  {
    topSteelWidth: 250,
    topSteelThickness: 6,
    bottomSteelWidth: 250,
    bottomSteelThickness: 8,
    Es: 207_000,
    fy: 240,
  },
);

console.log("\n── Steel-plate jacketed beam ──");
console.log("  Before strengthening:");
console.log("    φMn =", jacketedResult.before.phiMn, jacketedResult.before.unit);
console.log("    Details:", jacketedResult.before.calculationDetails);
console.log("  After strengthening:");
console.log("    φMn =", jacketedResult.after.phiMn, jacketedResult.after.unit);
console.log("    Details:", jacketedResult.after.calculationDetails);
if (jacketedResult.after.warnings.length > 0) {
  console.log("  Warnings:", jacketedResult.after.warnings);
}
