import { FrameAnalysisError, FrameErrors } from "@app-core/errors/frame-analysis.error";
import { solveLinearSystem, type Matrix } from "@app-utils/matrix";

import type { EndReleaseDof } from "./end-releases";

export interface CondensedMember {
  /** 12×12 stiffness in the node DOFs; zero rows and columns at fully released DOFs. */
  k: Matrix;
  /** Condenses a 12-term fixed-end force vector to the node DOFs; zero at full releases. */
  condenseFixedEndForces: (fixed: number[]) => number[];
  /**
   * The member's own 12 end displacements: equal to the node displacements at connected DOFs,
   * recovered from member equilibrium at released DOFs.
   *
   * @param nodeDisplacements - The 12 local displacements of the end nodes
   * @param fixed - The member's (uncondensed) fixed-end forces in the same state
   */
  memberEndDisplacements: (nodeDisplacements: number[], fixed: number[]) => number[];
}

/**
 * Condenses released local DOFs out of a member. Each released DOF r splits into a member-side
 * value u_m and a node-side value u_n, tied by a spring s (s = 0 for a full release):
 *
 * ```
 *        u_c     u_m      u_n
 *     [ k_cc    k_cr       0 ]      A = k_rr + S,  S = diag(s)
 *     [ k_rc    A         −S ]
 *     [  0     −S          S ]
 * ```
 *
 * Eliminating u_m leaves a 12×12 matrix in the node DOFs:
 * `k*_cc = k_cc − k_cr·A⁻¹·k_rc`, `k*_cn = k_cr·A⁻¹·S`, `k*_nn = S·A⁻¹·k_rr`
 * (the stable form of `S − S·A⁻¹·S`), and `f*_c = f_c − k_cr·A⁻¹·f_r`, `f*_n = S·A⁻¹·f_r`.
 * The member side follows from `u_m = A⁻¹·(S·u_n − k_rc·u_c − f_r)`.
 * With every s = 0 this is the classical condensation with zero rows and columns at r.
 *
 * @param k - 12×12 local stiffness (right-hand), N and mm
 * @param releases - Released local DOFs (0–11) with their springs, N/mm or N·mm/rad
 * @throws {FrameAnalysisError} 307 if the full releases make the member a mechanism
 */
export const condenseMember = (k: Matrix, releases: EndReleaseDof[]): CondensedMember => {
  if (releases.length === 0) {
    return {
      k,
      condenseFixedEndForces: (fixed) => [...fixed],
      memberEndDisplacements: (nodeDisplacements) => [...nodeDisplacements],
    };
  }
  const released = releases.map((r) => r.index);
  const s = releases.map((r) => r.spring);
  const retained = Array.from({ length: 12 }, (_, i) => i).filter((i) => !released.includes(i));
  const nr = released.length;
  const nc = retained.length;
  const sub = (rows: number[], cols: number[]) => rows.map((r) => cols.map((c) => k[r][c]));

  const krr = sub(released, released);
  const krc = sub(released, retained);
  // A = k_rr + S, scaled to D·A·D with unit diagonal (D = diag(1/√A_ii)) so the singularity test
  // does not depend on mixing N/mm and N·mm/rad; then A⁻¹·B = D·(D·A·D)⁻¹·(D·B).
  const d = krr.map((row, i) => 1 / Math.sqrt(row[i] + s[i]));
  const scaledA = krr.map((row, i) => row.map((v, j) => d[i] * (i === j ? v + s[i] : v) * d[j]));
  // [A⁻¹·k_rc | A⁻¹·k_rr | A⁻¹]
  const rhs = released.map((_, i) =>
    [...krc[i], ...krr[i], ...released.map((__, j) => (i === j ? 1 : 0))].map((v) => d[i] * v),
  );
  const scaledSolution = solveLinearSystem(scaledA, rhs);
  if (!scaledSolution) throw new FrameAnalysisError(FrameErrors.INVALID_RELEASE);
  const solved = scaledSolution.map((row, i) => row.map((v) => d[i] * v));
  const AinvKrc = solved.map((row) => row.slice(0, nc));
  const AinvKrr = solved.map((row) => row.slice(nc, nc + nr));
  const Ainv = solved.map((row) => row.slice(nc + nr));

  const kStar: Matrix = k.map((row) => row.map(() => 0));
  retained.forEach((r) => {
    retained.forEach((c, ci) => {
      let value = k[r][c];
      for (let j = 0; j < nr; j++) value -= k[r][released[j]] * AinvKrc[j][ci];
      kStar[r][c] = value;
    });
    released.forEach((c, j) => {
      // k*_cn = k_cr·A⁻¹·S, mirrored into k*_nc
      let value = 0;
      for (let m = 0; m < nr; m++) value += k[r][released[m]] * Ainv[m][j];
      kStar[r][c] = value * s[j];
      kStar[c][r] = value * s[j];
    });
  });
  released.forEach((r, i) => {
    released.forEach((c, j) => {
      // k*_nn = S·A⁻¹·k_rr, symmetrised against round-off
      kStar[r][c] = (s[i] * AinvKrr[i][j] + s[j] * AinvKrr[j][i]) / 2;
    });
  });

  // k_cr·A⁻¹, applied to f_r for every load case
  const kcrAinv = retained.map((r) =>
    released.map((_, m) => released.reduce((sum, rj, j) => sum + k[r][rj] * Ainv[j][m], 0)),
  );

  return {
    k: kStar,
    condenseFixedEndForces: (fixed) => {
      const fStar = new Array<number>(12).fill(0);
      const fr = released.map((r) => fixed[r]);
      retained.forEach((r, ri) => {
        fStar[r] = fixed[r] - kcrAinv[ri].reduce((sum, v, m) => sum + v * fr[m], 0);
      });
      released.forEach((r, i) => {
        fStar[r] = s[i] * Ainv[i].reduce((sum, v, m) => sum + v * fr[m], 0);
      });
      return fStar;
    },
    memberEndDisplacements: (nodeDisplacements, fixed) => {
      const u = [...nodeDisplacements];
      released.forEach((r, i) => {
        let value = 0;
        for (let m = 0; m < nr; m++) {
          value += Ainv[i][m] * (s[m] * nodeDisplacements[released[m]] - fixed[released[m]]);
        }
        for (let ci = 0; ci < nc; ci++) value -= AinvKrc[i][ci] * nodeDisplacements[retained[ci]];
        u[r] = value;
      });
      return u;
    },
  };
};
