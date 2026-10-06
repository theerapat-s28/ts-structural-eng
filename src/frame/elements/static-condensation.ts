import { FrameAnalysisError, FrameErrors } from "@app-core/errors/frame-analysis.error";
import { solveLinearSystem, type Matrix } from "@app-utils/matrix";

export interface CondensedMember {
  k: Matrix; // 12×12, zero rows and columns at released DOFs
  fixedEndForces: number[]; // 12, zero at released DOFs
  /** Recovers released DOF displacements from the local displacements (released entries ignored). */
  recoverReleased: (u: number[]) => number[];
}

/**
 * Statically condenses released local DOFs out of a member, so those DOFs carry no force.
 *
 * With released set r and retained set c:
 * `k* = k_cc − k_cr·k_rr⁻¹·k_rc`, `f* = f_c − k_cr·k_rr⁻¹·f_r`.
 *
 * @param k - 12×12 local stiffness (right-hand)
 * @param fixed - 12 local fixed-end forces
 * @param released - Local DOF indices (0–11) to release
 * @throws {FrameAnalysisError} 307 if the released set makes the member a mechanism
 */
export const condenseMember = (k: Matrix, fixed: number[], released: number[]): CondensedMember => {
  if (released.length === 0) {
    return { k, fixedEndForces: fixed, recoverReleased: (u) => u };
  }
  const retained = Array.from({ length: 12 }, (_, i) => i).filter((i) => !released.includes(i));
  const sub = (rows: number[], cols: number[]) => rows.map((r) => cols.map((c) => k[r][c]));

  const krr = sub(released, released);
  const krc = sub(released, retained);
  const kcr = sub(retained, released);
  const kcc = sub(retained, retained);
  // [k_rr⁻¹·k_rc | k_rr⁻¹·f_r]
  const rhs = released.map((_, i) => [...krc[i], fixed[released[i]]]);
  const solved = solveLinearSystem(krr, rhs);
  if (!solved) throw new FrameAnalysisError(FrameErrors.INVALID_RELEASE);

  const kStar: Matrix = k.map((row) => row.map(() => 0));
  const fStar = new Array<number>(12).fill(0);
  retained.forEach((r, ri) => {
    retained.forEach((c, ci) => {
      let value = kcc[ri][ci];
      released.forEach((_, j) => {
        value -= kcr[ri][j] * solved[j][ci];
      });
      kStar[r][c] = value;
    });
    let f = fixed[r];
    released.forEach((_, j) => {
      f -= kcr[ri][j] * solved[j][retained.length];
    });
    fStar[r] = f;
  });

  return {
    k: kStar,
    fixedEndForces: fStar,
    recoverReleased: (u) => {
      const out = [...u];
      released.forEach((rIndex, j) => {
        let value = -solved[j][retained.length];
        retained.forEach((c, ci) => {
          value -= solved[j][ci] * u[c];
        });
        out[rIndex] = value;
      });
      return out;
    },
  };
};
