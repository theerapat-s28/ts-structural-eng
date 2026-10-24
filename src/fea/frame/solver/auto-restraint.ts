import { SINGULARITY_TOLERANCE } from "@app-core/constants/frame.constant";
import type { Matrix } from "@app-utils/matrix";

import type { BoundaryConditions } from "./boundary-conditions";

/** A rotation direction at a node that no member, restraint or spring resists. */
export interface AutoRestraint {
  node: number; // node index
  axis: [number, number, number]; // unit vector, global; zero on fixed rotations
  stiffness: number; // N·mm/rad of the holding spring k·axis·axisᵀ
}

/**
 * Eigen-decomposition of a small symmetric matrix by cyclic Jacobi rotations.
 *
 * @returns Eigenvalues and the matching unit eigenvectors
 */
const symmetricEigen = (M: Matrix): { values: number[]; vectors: number[][] } => {
  const n = M.length;
  const a = M.map((row) => [...row]);
  const v: Matrix = M.map((_, i) => M.map((__, j) => (i === j ? 1 : 0)));
  const norm = Math.hypot(...a.flat());
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (Math.sqrt(off) <= 1e-15 * norm) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (a[p][q] === 0) continue;
        // rotation angle that zeroes a[p][q]
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: a.map((_, j) => v.map((row) => row[j])) };
};

/**
 * Finds the joint rotations that nothing resists, so they can be held instead of making the
 * stiffness singular — e.g. a truss joint where every member releases its end moments.
 *
 * For each node with members, the free rotational block `B` (3×3, global) of the assembled
 * member stiffness plus rotational springs is decomposed; every eigenvector whose eigenvalue
 * is below `SINGULARITY_TOLERANCE` times the block's largest diagonal is a null direction `n`.
 * Each member's global stiffness is positive semi-definite, so `nᵀ·B·n = 0` makes the whole
 * stiffness column of `n` zero: the rotation along `n` is decoupled from every other DOF, and a
 * spring `k·n·nᵀ` there carries no force unless a load has a moment component along `n`.
 *
 * @param nodeCount - Number of nodes
 * @param members - Node indices and global 12×12 stiffness of every member (N and mm)
 * @param boundary - Fixed DOFs and spring stiffnesses
 */
export const findAutoRestraints = (
  nodeCount: number,
  members: { startIndex: number; endIndex: number; kGlobal: Matrix }[],
  boundary: BoundaryConditions,
): AutoRestraint[] => {
  const blocks: (Matrix | null)[] = new Array(nodeCount).fill(null);
  for (const m of members) {
    [m.startIndex, m.endIndex].forEach((node, end) => {
      const block = (blocks[node] ??= [0, 1, 2].map(() => [0, 0, 0]));
      const base = 6 * end + 3;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) block[i][j] += m.kGlobal[base + i][base + j];
      }
    });
  }

  // fallback spring for a node whose whole rotational block is zero (pure truss joints)
  const modelScale = Math.max(
    1,
    ...blocks.flatMap((b) => (b ? [Math.abs(b[0][0]), Math.abs(b[1][1]), Math.abs(b[2][2])] : [])),
  );

  const restraints: AutoRestraint[] = [];
  blocks.forEach((block, node) => {
    if (!block) return; // a node without members is a mechanism, left for the factorisation
    const free = [0, 1, 2].filter((i) => !boundary.fixed[6 * node + 3 + i]);
    if (free.length === 0) return;
    const sub = free.map((i) =>
      free.map((j) => block[i][j] + (i === j ? boundary.spring[6 * node + 3 + i] : 0)),
    );
    const scale = Math.max(...sub.map((row, i) => Math.abs(row[i])));
    const { values, vectors } = symmetricEigen(sub);
    values.forEach((value, e) => {
      if (scale > 0 && value > SINGULARITY_TOLERANCE * scale) return;
      const axis: [number, number, number] = [0, 0, 0];
      free.forEach((i, k) => (axis[i] = vectors[e][k]));
      // deterministic sign: largest component positive
      const lead = axis.reduce((best, c, i) => (Math.abs(c) > Math.abs(axis[best]) ? i : best), 0);
      if (axis[lead] < 0) axis.forEach((c, i) => (axis[i] = -c));
      restraints.push({ node, axis, stiffness: scale > 0 ? scale : modelScale });
    });
  });
  return restraints;
};
