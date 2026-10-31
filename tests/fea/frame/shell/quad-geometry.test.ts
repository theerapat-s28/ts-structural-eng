import {
  bilinearShape,
  cartesianDerivatives,
  GAUSS_2X2,
  midsideShape,
  quadJacobian,
  type Vec2,
} from "@app-fea/frame/elements/shell/quad-geometry";

const CORNERS_XI_ETA: Vec2[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
const MIDSIDES_XI_ETA: Vec2[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
// A distorted convex quad, counter-clockwise
const quad: Vec2[] = [
  [0, 0],
  [2000, 300],
  [2400, 1800],
  [-200, 1500],
];

describe("bilinearShape", () => {
  it("is 1 at its own corner and 0 at the others", () => {
    CORNERS_XI_ETA.forEach(([xi, eta], c) => {
      expect(bilinearShape(xi, eta).N).toEqual([0, 1, 2, 3].map((i) => (i === c ? 1 : 0)));
    });
  });

  it("sums to 1 with derivatives summing to 0 (partition of unity)", () => {
    const { N, dXi, dEta } = bilinearShape(0.3, -0.7);
    expect(N.reduce((a, b) => a + b)).toBeCloseTo(1, 14);
    expect(dXi.reduce((a, b) => a + b)).toBeCloseTo(0, 14);
    expect(dEta.reduce((a, b) => a + b)).toBeCloseTo(0, 14);
  });

  it("has derivatives matching finite differences", () => {
    const h = 1e-6;
    const { dXi, dEta } = bilinearShape(0.2, 0.4);
    const fx = bilinearShape(0.2 + h, 0.4).N;
    const bx = bilinearShape(0.2 - h, 0.4).N;
    const fy = bilinearShape(0.2, 0.4 + h).N;
    const by = bilinearShape(0.2, 0.4 - h).N;
    dXi.forEach((d, i) => expect(d).toBeCloseTo((fx[i] - bx[i]) / (2 * h), 8));
    dEta.forEach((d, i) => expect(d).toBeCloseTo((fy[i] - by[i]) / (2 * h), 8));
  });
});

describe("midsideShape", () => {
  it("is 1 at its own edge midpoint and 0 at every other midpoint and corner", () => {
    MIDSIDES_XI_ETA.forEach(([xi, eta], m) => {
      expect(midsideShape(xi, eta).N.map((v) => v + 0)).toEqual(
        [0, 1, 2, 3].map((k) => (k === m ? 1 : 0)),
      );
    });
    for (const [xi, eta] of CORNERS_XI_ETA) {
      expect(midsideShape(xi, eta).N.map((v) => v + 0)).toEqual([0, 0, 0, 0]);
    }
  });

  it("has derivatives matching finite differences", () => {
    const h = 1e-6;
    const { dXi, dEta } = midsideShape(-0.35, 0.55);
    const fx = midsideShape(-0.35 + h, 0.55).N;
    const bx = midsideShape(-0.35 - h, 0.55).N;
    const fy = midsideShape(-0.35, 0.55 + h).N;
    const by = midsideShape(-0.35, 0.55 - h).N;
    dXi.forEach((d, k) => expect(d).toBeCloseTo((fx[k] - bx[k]) / (2 * h), 8));
    dEta.forEach((d, k) => expect(d).toBeCloseTo((fy[k] - by[k]) / (2 * h), 8));
  });
});

describe("quadJacobian", () => {
  it("integrates det J over the 2×2 Gauss points to the quad's area", () => {
    const area = GAUSS_2X2.reduce(
      (sum, g) => sum + quadJacobian(quad, g.xi, g.eta).detJ * g.weight,
      0,
    );
    // shoelace formula
    const shoelace =
      0.5 *
      quad.reduce((s, p, i) => {
        const q = quad[(i + 1) % 4];
        return s + p[0] * q[1] - q[0] * p[1];
      }, 0);
    expect(area).toBeCloseTo(shoelace, 6);
  });

  it("gives x, y derivatives that reproduce a linear field exactly", () => {
    // f = 3x − 2y + 7 at the corners; ∂f/∂x = 3, ∂f/∂y = −2 everywhere
    const f = quad.map(([x, y]) => 3 * x - 2 * y + 7);
    for (const g of GAUSS_2X2) {
      const { dX, dY } = cartesianDerivatives(
        quadJacobian(quad, g.xi, g.eta),
        bilinearShape(g.xi, g.eta),
      );
      expect(dX.reduce((s, d, i) => s + d * f[i], 0)).toBeCloseTo(3, 10);
      expect(dY.reduce((s, d, i) => s + d * f[i], 0)).toBeCloseTo(-2, 10);
    }
  });

  it("is negative for corners listed clockwise", () => {
    const clockwise = [...quad].reverse();
    expect(quadJacobian(clockwise, 0, 0).detJ).toBeLessThan(0);
  });
});
