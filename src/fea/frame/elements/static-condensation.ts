import { FrameAnalysisError, FrameErrors } from "@app-core/errors/frame-analysis.error";
import { solveLinearSystem, type Matrix } from "@app-utils/matrix";

export interface CondensedMember {
  k: Matrix; // 12×12, zero rows and columns at released DOFs
  /** Condenses a 12-term fixed-end force vector; the result is zero at released DOFs. */
  condenseFixedEndForces: (fixed: number[]) => number[];
}

/**
 * Statically condenses released local DOFs out of a member, so those DOFs carry no force.
 *
 * With released set r and retained set c:
 * `k* = k_cc − k_cr·k_rr⁻¹·k_rc`, `f* = f_c − k_cr·k_rr⁻¹·f_r`.
 * The stiffness is condensed once; the returned function condenses the fixed-end forces of
 * each load case.
 *
 * @param k - 12×12 local stiffness (right-hand)
 * @param released - Local DOF indices (0–11) to release
 * @throws {FrameAnalysisError} 307 if the released set makes the member a mechanism
 */
export const condenseMember = (k: Matrix, released: number[]): CondensedMember => {
  if (released.length === 0) {
    return { k, condenseFixedEndForces: (fixed) => [...fixed] };
  }
  const retained = Array.from({ length: 12 }, (_, i) => i).filter((i) => !released.includes(i));
  const sub = (rows: number[], cols: number[]) => rows.map((r) => cols.map((c) => k[r][c]));

  const krr = sub(released, released);
  const krc = sub(released, retained);
  const kcr = sub(retained, released);
  const kcc = sub(retained, retained);
  // [k_rr⁻¹·k_rc | k_rr⁻¹]
  const rhs = released.map((_, i) => [...krc[i], ...released.map((__, j) => (i === j ? 1 : 0))]);
  const solved = solveLinearSystem(krr, rhs);
  if (!solved) throw new FrameAnalysisError(FrameErrors.INVALID_RELEASE);
  const nc = retained.length;

  const kStar: Matrix = k.map((row) => row.map(() => 0));
  retained.forEach((r, ri) => {
    retained.forEach((c, ci) => {
      let value = kcc[ri][ci];
      released.forEach((_, j) => {
        value -= kcr[ri][j] * solved[j][ci];
      });
      kStar[r][c] = value;
    });
  });

  // k_cr·k_rr⁻¹, applied to f_r for every load case
  const kcrKrrInv = retained.map((_, ri) =>
    released.map((__, m) => released.reduce((s, ___, j) => s + kcr[ri][j] * solved[j][nc + m], 0)),
  );

  return {
    k: kStar,
    condenseFixedEndForces: (fixed) => {
      const fStar = new Array<number>(12).fill(0);
      const fr = released.map((r) => fixed[r]);
      retained.forEach((r, ri) => {
        fStar[r] = fixed[r] - kcrKrrInv[ri].reduce((s, v, m) => s + v * fr[m], 0);
      });
      return fStar;
    },
  };
};
