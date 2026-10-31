import {
  flatShellElement,
  type FlatShellProperties,
} from "@app-fea/frame/elements/shell/flat-shell";
import type { Vec3 } from "@app-fea/frame/elements/shell/shell-axes";
import { choleskySolve, zeros } from "@app-utils/matrix";

/** Global DOF k of node n, 6 per node: [ux uy uz rx ry rz]. */
export const dof6 = (node: number, k: number): number => 6 * node + k;

/**
 * Assembles a mesh of flat shell elements in 3D and solves it densely — a small test oracle,
 * not the engine's solver.
 *
 * @param nodes - Node coordinates in global axes (mm)
 * @param elements - Four node indices per element, in order around it
 * @param prescribed - Prescribed DOF values (supports)
 * @param loads - Nodal forces and moments by DOF (N, N·mm)
 * @returns All DOF values
 */
export const solveShellMesh = (
  nodes: Vec3[],
  elements: number[][],
  properties: FlatShellProperties,
  prescribed: Map<number, number>,
  loads: Map<number, number>,
): number[] => {
  const n = 6 * nodes.length;
  const K = zeros(n, n);
  for (const element of elements) {
    const { kGlobal } = flatShellElement(
      element.map((i) => nodes[i]),
      properties,
    );
    const dofs = element.flatMap((i) => [0, 1, 2, 3, 4, 5].map((k) => 6 * i + k));
    dofs.forEach((p, a) => dofs.forEach((q, b) => (K[p][q] += kGlobal[a][b])));
  }
  const free = [...Array(n).keys()].filter((d) => !prescribed.has(d));
  const rhs = free.map(
    (i) => (loads.get(i) ?? 0) - [...prescribed].reduce((s, [j, v]) => s + K[i][j] * v, 0),
  );
  const solution = choleskySolve(
    free.map((i) => free.map((j) => K[i][j])),
    rhs,
    1e-12,
  );
  if (!solution) throw new Error("singular shell mesh");
  const U = new Array<number>(n).fill(0);
  prescribed.forEach((v, d) => (U[d] = v));
  free.forEach((d, e) => (U[d] = solution[e]));
  return U;
};
