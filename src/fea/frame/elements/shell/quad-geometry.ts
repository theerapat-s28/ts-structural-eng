/** A point in an element's own plane: local x, y in mm. */
export type Vec2 = [number, number];

/** Natural coordinates (ξ, η) of the four corners, counter-clockwise about the normal. */
const CORNER_XI = [-1, 1, 1, -1] as const;
const CORNER_ETA = [-1, -1, 1, 1] as const;

const GAUSS = 1 / Math.sqrt(3);

/**
 * 2×2 Gauss rule over the parent square −1 ≤ ξ, η ≤ 1: points (±1/√3, ±1/√3), weight 1 each.
 * Exact for polynomials up to cubic in each of ξ and η.
 */
export const GAUSS_2X2: readonly { xi: number; eta: number; weight: number }[] = [
  { xi: -GAUSS, eta: -GAUSS, weight: 1 },
  { xi: GAUSS, eta: -GAUSS, weight: 1 },
  { xi: GAUSS, eta: GAUSS, weight: 1 },
  { xi: -GAUSS, eta: GAUSS, weight: 1 },
];

const GAUSS_3 = Math.sqrt(0.6);
const GAUSS_3_POINTS = [
  { at: -GAUSS_3, weight: 5 / 9 },
  { at: 0, weight: 8 / 9 },
  { at: GAUSS_3, weight: 5 / 9 },
];

/**
 * 3×3 Gauss rule over the parent square: points 0 and ±√0.6 in each direction, weights the
 * products of 5/9, 8/9, 5/9. Exact for polynomials up to quintic in each of ξ and η.
 */
export const GAUSS_3X3: readonly { xi: number; eta: number; weight: number }[] =
  GAUSS_3_POINTS.flatMap((p) =>
    GAUSS_3_POINTS.map((q) => ({ xi: p.at, eta: q.at, weight: p.weight * q.weight })),
  );

/** Shape-function values and their derivatives with respect to ξ and η at one point. */
export interface ShapeValues {
  N: number[];
  dXi: number[];
  dEta: number[];
}

/** Bilinear corner functions `Nᵢ = ¼(1 + ξᵢξ)(1 + ηᵢη)`, i = 1…4. */
export const bilinearShape = (xi: number, eta: number): ShapeValues => {
  const N: number[] = [];
  const dXi: number[] = [];
  const dEta: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = CORNER_XI[i];
    const b = CORNER_ETA[i];
    N.push(0.25 * (1 + a * xi) * (1 + b * eta));
    dXi.push(0.25 * a * (1 + b * eta));
    dEta.push(0.25 * b * (1 + a * xi));
  }
  return { N, dXi, dEta };
};

/**
 * Mid-side functions N₅…N₈, one per edge 1→2, 2→3, 3→4, 4→1 (index k = edge from corner k to
 * corner k + 1): 1 at the edge's midpoint and 0 at every corner and every other midpoint.
 */
export const midsideShape = (xi: number, eta: number): ShapeValues => ({
  N: [
    0.5 * (1 - xi * xi) * (1 - eta),
    0.5 * (1 + xi) * (1 - eta * eta),
    0.5 * (1 - xi * xi) * (1 + eta),
    0.5 * (1 - xi) * (1 - eta * eta),
  ],
  dXi: [-xi * (1 - eta), 0.5 * (1 - eta * eta), -xi * (1 + eta), -0.5 * (1 - eta * eta)],
  dEta: [-0.5 * (1 - xi * xi), -(1 + xi) * eta, 0.5 * (1 - xi * xi), -(1 - xi) * eta],
});

/** The bilinear map's Jacobian at one point, as needed to turn ξ, η derivatives into x, y ones. */
export interface QuadJacobian {
  detJ: number; // mm², dA = det J · dξ · dη
  inverse: [Vec2, Vec2]; // J⁻¹, with J = [[x,ξ, y,ξ], [x,η, y,η]]
}

/**
 * Jacobian of the bilinear map from the parent square to a quadrilateral.
 *
 * @param corners - The four corners in the element plane (mm), counter-clockwise
 * @param xi - Natural coordinate ξ
 * @param eta - Natural coordinate η
 * @returns `det J` and `J⁻¹`; `det J > 0` everywhere for a convex, counter-clockwise quad
 */
export const quadJacobian = (corners: readonly Vec2[], xi: number, eta: number): QuadJacobian => {
  const { dXi, dEta } = bilinearShape(xi, eta);
  let xXi = 0;
  let yXi = 0;
  let xEta = 0;
  let yEta = 0;
  for (let i = 0; i < 4; i++) {
    xXi += dXi[i] * corners[i][0];
    yXi += dXi[i] * corners[i][1];
    xEta += dEta[i] * corners[i][0];
    yEta += dEta[i] * corners[i][1];
  }
  const detJ = xXi * yEta - yXi * xEta;
  return {
    detJ,
    inverse: [
      [yEta / detJ, -yXi / detJ],
      [-xEta / detJ, xXi / detJ],
    ],
  };
};

/**
 * Converts ξ, η derivatives of shape functions to x, y derivatives: `[N,x; N,y] = J⁻¹·[N,ξ; N,η]`.
 *
 * @returns `dX[i]` and `dY[i]` for every function i of `shape`
 */
export const cartesianDerivatives = (
  { inverse }: QuadJacobian,
  shape: Pick<ShapeValues, "dXi" | "dEta">,
): { dX: number[]; dY: number[] } => ({
  dX: shape.dXi.map((d, i) => inverse[0][0] * d + inverse[0][1] * shape.dEta[i]),
  dY: shape.dXi.map((d, i) => inverse[1][0] * d + inverse[1][1] * shape.dEta[i]),
});
