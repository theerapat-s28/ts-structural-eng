import { zeros, type Matrix } from "@app-utils/matrix";

/**
 * Local DOF indices (0-based) whose reference-matrix rotation sign is opposite to the
 * right-hand rule: R2 and R3 at the start and end nodes.
 */
const FLIPPED_DOFS = [4, 5, 10, 11];

/**
 * Local stiffness matrix of a 3D prismatic beam element, exactly as in the reference
 * "Complete Beam Stiffness Matrix".
 *
 * DOF order for node i then node j: [U1, U2, U3, R1, R2, R3]. Local 1 runs along the member.
 * The reference matrix measures the bending rotations R2 and R3 opposite to the right-hand
 * rule; use `beam3dLocalStiffnessRightHanded` for the right-handed form.
 *
 * The reference uses one `EI`; here the U2–R3 terms use `E·I33` and the U3–R2 terms use
 * `E·I22`, which reduces to the reference when `I22 = I33`.
 *
 * @param E - Young's modulus in MPa
 * @param G - Shear modulus in MPa
 * @param A - Area in mm²
 * @param I22 - Second moment about local 2 in mm⁴
 * @param I33 - Second moment about local 3 in mm⁴
 * @param J - Torsion constant in mm⁴
 * @param L - Member length in mm
 * @returns 12×12 symmetric matrix in N and mm
 */
export const beam3dLocalStiffness = (
  E: number,
  G: number,
  A: number,
  I22: number,
  I33: number,
  J: number,
  L: number,
): Matrix => {
  const k = zeros(12, 12);
  // 1-based row/column, upper triangle as written in the reference; mirrored for symmetry.
  const set = (row: number, col: number, value: number) => {
    k[row - 1][col - 1] = value;
    k[col - 1][row - 1] = value;
  };

  const ax = (E * A) / L;
  const tor = (G * J) / L;

  // U2–R3 bending (I33)
  const a3 = (12 * E * I33) / L ** 3;
  const b3 = (6 * E * I33) / L ** 2;
  const c3 = (4 * E * I33) / L;
  const d3 = (2 * E * I33) / L;
  // U3–R2 bending (I22)
  const a2 = (12 * E * I22) / L ** 3;
  const b2 = (6 * E * I22) / L ** 2;
  const c2 = (4 * E * I22) / L;
  const d2 = (2 * E * I22) / L;

  set(1, 1, ax);
  set(1, 7, -ax);
  set(7, 7, ax);

  set(2, 2, a3);
  set(2, 6, -b3);
  set(2, 8, -a3);
  set(2, 12, -b3);
  set(6, 6, c3);
  set(6, 8, b3);
  set(6, 12, d3);
  set(8, 8, a3);
  set(8, 12, b3);
  set(12, 12, c3);

  set(3, 3, a2);
  set(3, 5, b2);
  set(3, 9, -a2);
  set(3, 11, b2);
  set(5, 5, c2);
  set(5, 9, -b2);
  set(5, 11, d2);
  set(9, 9, a2);
  set(9, 11, -b2);
  set(11, 11, c2);

  set(4, 4, tor);
  set(4, 10, -tor);
  set(10, 10, tor);

  return k;
};

/**
 * Converts a local matrix between the reference rotation convention and the right-hand rule
 * (`D·k·D`, with `D` flipping the sign of R2 and R3 at both ends). The conversion is its own inverse.
 */
export const flipBendingRotationSigns = (k: Matrix): Matrix => {
  const flipped = new Set(FLIPPED_DOFS);
  return k.map((row, i) =>
    row.map((value, j) => (flipped.has(i) !== flipped.has(j) ? -value : value)),
  );
};

/** Same element as `beam3dLocalStiffness` with all rotations following the right-hand rule. */
export const beam3dLocalStiffnessRightHanded = (
  E: number,
  G: number,
  A: number,
  I22: number,
  I33: number,
  J: number,
  L: number,
): Matrix => flipBendingRotationSigns(beam3dLocalStiffness(E, G, A, I22, I33, J, L));
