import {
  membraneQuadStiffness,
  type MembraneProperties,
} from "@app-fea/frame/elements/shell/membrane-quad";
import type { Vec2 } from "@app-fea/frame/elements/shell/quad-geometry";
import { choleskySolve, zeros } from "@app-utils/matrix";

/** DOF of node n: 0 = u, 1 = v, 2 = θ (3 per node). */
export const dof = (node: number, k: 0 | 1 | 2): number => 3 * node + k;

/**
 * Assembles a mesh of drilling membrane quads and solves it densely — a small test oracle, not
 * the engine's solver.
 *
 * @param nodes - Node coordinates (mm)
 * @param elements - Four node indices per element, counter-clockwise
 * @param prescribed - Prescribed DOF values (supports, or displacements in a patch test)
 * @param loads - Nodal forces by DOF (N, N·mm)
 * @param penaltyRatio - γ / G of the drilling penalty (default: the engine's)
 * @returns All DOF values
 */
export const solveMembraneMesh = (
  nodes: Vec2[],
  elements: number[][],
  properties: MembraneProperties,
  prescribed: Map<number, number>,
  loads: Map<number, number> = new Map(),
  penaltyRatio?: number,
): number[] => {
  const n = 3 * nodes.length;
  const K = zeros(n, n);
  for (const element of elements) {
    const k = membraneQuadStiffness(
      element.map((i) => nodes[i]),
      properties,
      penaltyRatio,
    );
    const dofs = element.flatMap((i) => [3 * i, 3 * i + 1, 3 * i + 2]);
    dofs.forEach((p, a) => dofs.forEach((q, b) => (K[p][q] += k[a][b])));
  }
  const free = [...Array(n).keys()].filter((d) => !prescribed.has(d));
  const rhs = free.map(
    (i) => (loads.get(i) ?? 0) - [...prescribed].reduce((s, [j, v]) => s + K[i][j] * v, 0),
  );
  const solution = choleskySolve(
    free.map((i) => free.map((j) => K[i][j])),
    rhs,
  );
  if (!solution) throw new Error("singular membrane mesh");
  const U = new Array<number>(n).fill(0);
  prescribed.forEach((v, d) => (U[d] = v));
  free.forEach((d, e) => (U[d] = solution[e]));
  return U;
};

/** Structured n₁ × n₂ mesh of the bilinear map of four corners (mm). */
export const mapMesh = (corners: Vec2[], n1: number, n2: number) => {
  const nodes: Vec2[] = [];
  for (let j = 0; j <= n2; j++) {
    for (let i = 0; i <= n1; i++) {
      const s = i / n1;
      const r = j / n2;
      const w = [(1 - s) * (1 - r), s * (1 - r), s * r, (1 - s) * r];
      nodes.push([
        w.reduce((sum, wk, k) => sum + wk * corners[k][0], 0),
        w.reduce((sum, wk, k) => sum + wk * corners[k][1], 0),
      ]);
    }
  }
  const id = (i: number, j: number) => j * (n1 + 1) + i;
  const elements: number[][] = [];
  for (let j = 0; j < n2; j++) {
    for (let i = 0; i < n1; i++) {
      elements.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
    }
  }
  return { nodes, elements, id };
};
