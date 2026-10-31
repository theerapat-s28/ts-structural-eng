import type { AreaLoad, FeaId } from "@app-fea/shared/types/model.type";

import type { SystemShell } from "./system-shell";

const GLOBAL_DIRECTIONS: Record<"X" | "Y" | "Z", [number, number, number]> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
};

/**
 * Adds one load case's surface loads on shells to the global load vector `F` (N): its area
 * loads on every element of their area, and self-weight
 * `selfWeight · unitWeight · thickness · modifiers.weight` per unit area along −Z. Both act as
 * forces at the corners, each corner the share `∫ Nᵢ dA` of the element's area on its mean plane
 * (no corner moments, so a warped element's offsets do not load the rotations auto-restraint
 * holds).
 *
 * @param F - Global load vector, 6 DOFs per node
 * @param shells - The system's shell elements
 * @param shellsByArea - Element indices of each shell area
 * @param loads - The load case's area loads on shell areas
 * @param selfWeight - The load case's self-weight multiplier
 */
export const addShellLoads = (
  F: number[],
  shells: SystemShell[],
  shellsByArea: Map<FeaId, number[]>,
  loads: AreaLoad[],
  selfWeight: number,
): void => {
  // kN/m² as a global vector per shell, then N at the corners
  const shellPressure = shells.map((): [number, number, number] => [0, 0, 0]);
  for (const load of loads) {
    // every element of the area
    for (const s of shellsByArea.get(load.areaId) ?? []) {
      const normal = shells[s].element.axes.lambda[2];
      const e = load.direction === "3" ? normal : GLOBAL_DIRECTIONS[load.direction];
      // per projected area → per true area: Aproj / A = |n · e|
      const q = load.projected
        ? load.q * Math.abs(normal[0] * e[0] + normal[1] * e[1] + normal[2] * e[2])
        : load.q;
      for (let k = 0; k < 3; k++) shellPressure[s][k] += q * e[k];
    }
  }
  shells.forEach((shell, s) => {
    if (selfWeight !== 0) {
      // kN/m³ · mm · 10⁻³ = kN/m²
      const { unitWeight = 0, thickness } = shell.section;
      shellPressure[s][2] -=
        selfWeight * unitWeight * thickness * (shell.modifiers.weight ?? 1) * 1e-3;
    }
    const p = shellPressure[s];
    if (p[0] === 0 && p[1] === 0 && p[2] === 0) return;
    shell.nodeIndices.forEach((node, i) => {
      // kN/m² = 10⁻³ N/mm², times mm²
      for (let k = 0; k < 3; k++) F[6 * node + k] += p[k] * 1e-3 * shell.cornerAreas[i];
    });
  });
};
