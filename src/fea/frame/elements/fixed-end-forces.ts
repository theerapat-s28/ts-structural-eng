import { FrameAnalysisError, FrameErrors } from "@app-core/errors/frame-analysis.error";

/** A member load resolved into local axes, in N and mm. */
export type LocalMemberLoad =
  | { type: "udl"; axis: 1 | 2 | 3; w: number; start: number; end: number } // N/mm
  | { type: "point"; axis: 1 | 2 | 3; P: number; a: number }; // N

// 4-point Gauss–Legendre rule, exact for the cubic integrands used here
const GAUSS_POINTS = [
  -0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526,
];
const GAUSS_WEIGHTS = [
  0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538,
];

/**
 * Equivalent nodal loads of a unit transverse/axial load at distance `x`, from the
 * Euler–Bernoulli shape functions: the exact fixed-end solution for a prismatic member.
 * Returned per unit of load, right-hand local DOF order [i: U1..R3, j: U1..R3].
 */
const unitEquivalentLoad = (axis: 1 | 2 | 3, x: number, L: number): number[] => {
  const xi = x / L;
  const out = new Array<number>(12).fill(0);
  if (axis === 1) {
    out[0] = 1 - xi;
    out[6] = xi;
    return out;
  }
  const n1 = 1 - 3 * xi ** 2 + 2 * xi ** 3;
  const n2 = L * (xi - 2 * xi ** 2 + xi ** 3);
  const n3 = 3 * xi ** 2 - 2 * xi ** 3;
  const n4 = L * (-(xi ** 2) + xi ** 3);
  if (axis === 2) {
    // load along local 2: force U2, moment about 3 (R3 = +dv/dx)
    out[1] = n1;
    out[5] = n2;
    out[7] = n3;
    out[11] = n4;
  } else {
    // load along local 3: force U3, moment about 2 (R2 = −dw/dx)
    out[2] = n1;
    out[4] = -n2;
    out[8] = n3;
    out[10] = -n4;
  }
  return out;
};

/**
 * Fixed-end forces of a member under local loads: the end forces (right-hand local axes,
 * N and N·mm) that hold both ends fully fixed. Equivalent nodal loads are the negative.
 *
 * @param loads - Loads in local axes, N and mm
 * @param L - Member length in mm
 * @throws {FrameAnalysisError} 308 if a load lies outside the member
 */
export const fixedEndForces = (loads: LocalMemberLoad[], L: number): number[] => {
  const equivalent = new Array<number>(12).fill(0);
  const add = (unit: number[], factor: number) => {
    for (let i = 0; i < 12; i++) equivalent[i] += unit[i] * factor;
  };

  for (const load of loads) {
    if (load.type === "point") {
      if (!(load.a >= 0 && load.a <= L))
        throw new FrameAnalysisError(FrameErrors.LOAD_OUTSIDE_MEMBER);
      add(unitEquivalentLoad(load.axis, load.a, L), load.P);
    } else {
      if (!(load.start >= 0 && load.end <= L && load.start < load.end)) {
        throw new FrameAnalysisError(FrameErrors.LOAD_OUTSIDE_MEMBER);
      }
      const half = (load.end - load.start) / 2;
      const mid = (load.end + load.start) / 2;
      GAUSS_POINTS.forEach((p, index) => {
        add(unitEquivalentLoad(load.axis, mid + half * p, L), load.w * half * GAUSS_WEIGHTS[index]);
      });
    }
  }
  return equivalent.map((v) => -v);
};
