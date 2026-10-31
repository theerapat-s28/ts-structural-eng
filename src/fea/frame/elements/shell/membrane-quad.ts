import { DRILLING_PENALTY_RATIO } from "@app-core/constants/frame.constant";
import { zeros, type Matrix } from "@app-utils/matrix";

import {
  bilinearShape,
  cartesianDerivatives,
  GAUSS_3X3,
  midsideShape,
  quadJacobian,
  type Vec2,
} from "./quad-geometry";
import { isotropicRigidity, type RigidityModifiers } from "./rigidity";

/** Material and thickness of a membrane: E in MPa, ν, t in mm. */
export interface MembraneProperties {
  E: number;
  nu: number;
  t: number;
  /** Stiffness modifiers on the 11, 22 and 12 components of the rigidity (default all 1). */
  modifiers?: RigidityModifiers;
}

/** Strain rows of the drilling membrane at one point, over the 12 DOFs `[u₁ v₁ θ₁ … u₄ v₄ θ₄]`. */
export interface MembraneStrainRows {
  /** Rows of εx, εy and γxy (1/mm, or 1/mm per rad for the θ columns). */
  B: Matrix;
  /** Row of θ − ω, the drilling rotation minus the material rotation ω = ½(v,x − u,y). */
  rotation: number[];
  detJ: number; // mm²
}

/**
 * Strain–displacement rows of the four-node membrane with drilling rotations at (ξ, η).
 *
 * Displacements are bilinear plus Allman-type edge terms: for the edge from corner i to corner
 * j (counter-clockwise) with mid-side function N_k,
 * `u += N_k·(y_j − y_i)/8·(θ_j − θ_i)` and `v += N_k·(x_i − x_j)/8·(θ_j − θ_i)`, a quadratic
 * bulge along the edge's outward normal that matches the difference of the corner rotations.
 *
 * @param corners - The four corners in the element plane (mm), counter-clockwise
 * @param xi - Natural coordinate ξ
 * @param eta - Natural coordinate η
 */
export const membraneStrainRows = (
  corners: readonly Vec2[],
  xi: number,
  eta: number,
): MembraneStrainRows => {
  const jacobian = quadJacobian(corners, xi, eta);
  const corner = bilinearShape(xi, eta);
  const cornerD = cartesianDerivatives(jacobian, corner);
  const edgeD = cartesianDerivatives(jacobian, midsideShape(xi, eta));

  // u,x  u,y  v,x  v,y over the 12 DOFs
  const ux = new Array<number>(12).fill(0);
  const uy = new Array<number>(12).fill(0);
  const vx = new Array<number>(12).fill(0);
  const vy = new Array<number>(12).fill(0);
  const rotation = new Array<number>(12).fill(0);
  for (let i = 0; i < 4; i++) {
    ux[3 * i] = cornerD.dX[i];
    uy[3 * i] = cornerD.dY[i];
    vx[3 * i + 1] = cornerD.dX[i];
    vy[3 * i + 1] = cornerD.dY[i];
    rotation[3 * i + 2] = corner.N[i];
  }
  for (let k = 0; k < 4; k++) {
    const i = k;
    const j = (k + 1) % 4;
    // (y_j − y_i, x_i − x_j) is the edge length times its outward normal
    const cu = (corners[j][1] - corners[i][1]) / 8;
    const cv = (corners[i][0] - corners[j][0]) / 8;
    for (const [node, sign] of [
      [j, 1],
      [i, -1],
    ]) {
      const theta = 3 * node + 2;
      ux[theta] += sign * cu * edgeD.dX[k];
      uy[theta] += sign * cu * edgeD.dY[k];
      vx[theta] += sign * cv * edgeD.dX[k];
      vy[theta] += sign * cv * edgeD.dY[k];
    }
  }
  for (let a = 0; a < 12; a++) rotation[a] -= 0.5 * (vx[a] - uy[a]);

  return { B: [ux, vy, uy.map((v, a) => v + vx[a])], rotation, detJ: jacobian.detJ };
};

/**
 * Plane-stress membrane rigidity `E·t/(1 − ν²)·[[1, ν, 0], [ν, 1, 0], [0, 0, (1 − ν)/2]]`
 * (N/mm), with the stiffness modifiers applied (see `isotropicRigidity`).
 */
export const membraneRigidity = ({ E, nu, t, modifiers }: MembraneProperties): Matrix =>
  isotropicRigidity((E * t) / (1 - nu * nu), nu, modifiers);

/**
 * Local stiffness of the four-node membrane with drilling rotations (after Ibrahimbegovic,
 * Taylor & Wilson 1990): bilinear displacements plus Allman-type edge terms, and the
 * Hughes–Brezzi penalty `½·γ·t·∫(θ − ω)² dA` with `γ = penaltyRatio · G`.
 *
 * - The strain energy is integrated with 3×3 Gauss points. With 2×2 the edge terms leave a
 *   spurious zero-energy mode in rectangular elements (alternating corner rotations whose
 *   normal strains vanish exactly at the 2×2 points).
 * - The penalty is integrated at the centre (one point). With 2×2 it over-constrains distorted
 *   elements and they lock as γ grows; at the centre it only ties the element's mean rotation
 *   to the material, so results hardly change with γ.
 * - Stiffness modifiers scale the rigidity only; the penalty keeps the unmodified G.
 *
 * The DOFs are `[u₁ v₁ θ₁ … u₄ v₄ θ₄]`: in-plane displacements along the element's x and y and
 * the rotation about its normal, right-handed, at corners listed counter-clockwise about that
 * normal. The quad must be convex (det J > 0 throughout), which validation guarantees.
 *
 * @param corners - The four corners in the element plane (mm)
 * @param properties - E (MPa), ν and thickness t (mm)
 * @param penaltyRatio - γ / G (default `DRILLING_PENALTY_RATIO`)
 * @returns The symmetric 12×12 stiffness in N and mm (N/mm, N, N·mm/rad); exactly three
 *   zero-energy modes, the in-plane rigid-body motions
 */
export const membraneQuadStiffness = (
  corners: readonly Vec2[],
  properties: MembraneProperties,
  penaltyRatio = DRILLING_PENALTY_RATIO,
): Matrix => {
  const D = membraneRigidity(properties);
  const k = zeros(12, 12);
  for (const { xi, eta, weight } of GAUSS_3X3) {
    const { B, detJ } = membraneStrainRows(corners, xi, eta);
    const scale = detJ * weight;
    // Bᵀ·D·B via D·B
    const DB = D.map((row) =>
      B[0].map((_, a) => row[0] * B[0][a] + row[1] * B[1][a] + row[2] * B[2][a]),
    );
    for (let a = 0; a < 12; a++) {
      for (let b = 0; b < 12; b++) {
        k[a][b] += (B[0][a] * DB[0][b] + B[1][a] * DB[1][b] + B[2][a] * DB[2][b]) * scale;
      }
    }
  }

  // one-point rule at the centre: weight 4
  const { rotation, detJ } = membraneStrainRows(corners, 0, 0);
  const penalty =
    ((penaltyRatio * properties.E * properties.t) / (2 * (1 + properties.nu))) * detJ * 4;
  for (let a = 0; a < 12; a++) {
    for (let b = 0; b < 12; b++) k[a][b] += penalty * rotation[a] * rotation[b];
  }
  return k;
};
