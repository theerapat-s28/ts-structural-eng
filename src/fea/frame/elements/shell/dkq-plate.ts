import { zeros, type Matrix } from "@app-utils/matrix";

import { GAUSS_2X2, quadJacobian, serendipityShape, type Vec2 } from "./quad-geometry";
import { isotropicRigidity, type RigidityModifiers } from "./rigidity";

/** Material and thickness of a plate: E in MPa, ν, t in mm. */
export interface PlateProperties {
  E: number;
  nu: number;
  t: number;
  /** Stiffness modifiers on the 11, 22 and 12 components of the rigidity (default all 1). */
  modifiers?: RigidityModifiers;
}

/** Curvature rows of the DKQ plate at one point, over the 12 DOFs `[w₁ θx₁ θy₁ … w₄ θx₄ θy₄]`. */
export interface PlateCurvatureRows {
  /** Rows of κx = βx,x, κy = βy,y and κxy = βx,y + βy,x (1/mm² for w, 1/mm per rad). */
  B: Matrix;
  detJ: number; // mm²
}

/** Edge coefficients a…e of the DKQ for the edge from corner i to corner j. */
interface EdgeCoefficients {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
}

const edgeCoefficients = (corners: readonly Vec2[]): EdgeCoefficients[] =>
  [0, 1, 2, 3].map((k) => {
    const [xi, yi] = corners[k];
    const [xj, yj] = corners[(k + 1) % 4];
    const x = xi - xj;
    const y = yi - yj;
    const l2 = x * x + y * y;
    return {
      a: -x / l2,
      b: (0.75 * x * y) / l2,
      c: (0.25 * x * x - 0.5 * y * y) / l2,
      d: -y / l2,
      e: (0.25 * y * y - 0.5 * x * x) / l2,
    };
  });

/**
 * The rotations of the normal `βx = Hxᵀ·U`, `βy = Hyᵀ·U` (or a derivative of them), given the
 * eight serendipity values `F` (or the same derivative of them): corners in `F[0…3]`, mid-sides
 * of edges 1→2, 2→3, 3→4, 4→1 in `F[4…7]`.
 */
const rotationRows = (edges: EdgeCoefficients[], F: number[]): { Hx: number[]; Hy: number[] } => {
  const Hx = new Array<number>(12).fill(0);
  const Hy = new Array<number>(12).fill(0);
  for (let i = 0; i < 4; i++) {
    // m: the edge that starts at corner i; k: the edge that ends at it
    const m = i;
    const k = (i + 3) % 4;
    const Fm = F[4 + m];
    const Fk = F[4 + k];
    const em = edges[m];
    const ek = edges[k];
    Hx[3 * i] = 1.5 * (em.a * Fm - ek.a * Fk);
    Hx[3 * i + 1] = em.b * Fm + ek.b * Fk;
    Hx[3 * i + 2] = F[i] - em.c * Fm - ek.c * Fk;
    Hy[3 * i] = 1.5 * (em.d * Fm - ek.d * Fk);
    Hy[3 * i + 1] = -F[i] + em.e * Fm + ek.e * Fk;
    Hy[3 * i + 2] = -Hx[3 * i + 1];
  }
  return { Hx, Hy };
};

/**
 * Curvature–displacement rows of the discrete Kirchhoff quadrilateral (DKQ) at (ξ, η).
 *
 * The rotations of the normal βx, βy (with u = z·βx, v = z·βy) are interpolated over the 8
 * serendipity nodes; the Kirchhoff condition at the corners (βx = −w,x, βy = −w,y), a cubic w
 * along each edge with ∫(w,s + βs) ds = 0, and a normal rotation linear along each edge
 * eliminate the mid-side values (Batoz & Ben Tahar 1982). The geometry map stays bilinear.
 *
 * @param corners - The four corners in the element plane (mm), counter-clockwise
 * @param xi - Natural coordinate ξ
 * @param eta - Natural coordinate η
 */
export const dkqCurvatureRows = (
  corners: readonly Vec2[],
  xi: number,
  eta: number,
): PlateCurvatureRows => {
  const jacobian = quadJacobian(corners, xi, eta);
  const shape = serendipityShape(xi, eta);
  const edges = edgeCoefficients(corners);
  const dXi = rotationRows(edges, shape.dXi);
  const dEta = rotationRows(edges, shape.dEta);
  const [[j11, j12], [j21, j22]] = jacobian.inverse;
  const B: Matrix = [[], [], []];
  for (let p = 0; p < 12; p++) {
    const HxX = j11 * dXi.Hx[p] + j12 * dEta.Hx[p];
    const HxY = j21 * dXi.Hx[p] + j22 * dEta.Hx[p];
    const HyX = j11 * dXi.Hy[p] + j12 * dEta.Hy[p];
    const HyY = j21 * dXi.Hy[p] + j22 * dEta.Hy[p];
    B[0].push(HxX);
    B[1].push(HyY);
    B[2].push(HxY + HyX);
  }
  return { B, detJ: jacobian.detJ };
};

/**
 * Plate bending rigidity `E·t³/(12(1 − ν²))·[[1, ν, 0], [ν, 1, 0], [0, 0, (1 − ν)/2]]`
 * (N·mm), with the stiffness modifiers applied (see `isotropicRigidity`).
 */
export const plateRigidity = ({ E, nu, t, modifiers }: PlateProperties): Matrix =>
  isotropicRigidity((E * t ** 3) / (12 * (1 - nu * nu)), nu, modifiers);

/**
 * Local stiffness of the discrete Kirchhoff quadrilateral (DKQ, Batoz & Ben Tahar 1982), a thin
 * plate element without transverse shear deformation, integrated with 2×2 Gauss points.
 *
 * The DOFs are `[w₁ θx₁ θy₁ … w₄ θx₄ θy₄]`: the deflection along the element normal and the
 * right-handed rotations about the element's x and y axes (θx = w,y, θy = −w,x), at corners listed
 * counter-clockwise about the normal. The quad must be convex (det J > 0 throughout), which
 * validation guarantees.
 *
 * @param corners - The four corners in the element plane (mm)
 * @param properties - E (MPa), ν and thickness t (mm)
 * @returns The symmetric 12×12 stiffness in N and mm (N/mm, N, N·mm/rad); exactly three
 *   zero-energy modes, the out-of-plane rigid-body motions
 */
export const dkqPlateStiffness = (
  corners: readonly Vec2[],
  properties: PlateProperties,
): Matrix => {
  const D = plateRigidity(properties);
  const k = zeros(12, 12);
  for (const { xi, eta, weight } of GAUSS_2X2) {
    const { B, detJ } = dkqCurvatureRows(corners, xi, eta);
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
  return k;
};
