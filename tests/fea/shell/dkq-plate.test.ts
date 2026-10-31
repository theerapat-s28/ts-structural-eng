import {
  dkqCurvatureRows,
  dkqPlateStiffness,
  plateRigidity,
  type PlateProperties,
} from "@app-fea/shell/elements/dkq-plate";
import { GAUSS_2X2, type Vec2 } from "@app-fea/shell/elements/quad-geometry";
import { choleskyFactor, matVec, type Matrix } from "@app-utils/matrix";
import { dof, mapMesh, solveQuadMesh } from "./mesh-harness";

const slab = { E: 30000, nu: 0.2, t: 200 }; // MPa, —, mm
// A distorted convex quad, counter-clockwise (mm)
const quad: Vec2[] = [
  [0, 0],
  [2000, 300],
  [2400, 1800],
  [-200, 1500],
];
const rectangle: Vec2[] = [
  [0, 0],
  [1000, 0],
  [1000, 500],
  [0, 500],
];

/** Rows and columns of the rotations scaled by `length`, so all DOFs are in mm. */
const scaleRotations = (k: Matrix, length: number): Matrix =>
  k.map((row, a) => row.map((v, b) => v * (a % 3 ? length : 1) * (b % 3 ? length : 1)));
/** Out-of-plane rigid-body modes over [w θx θy]: w = 1, w = x (θy = −1), w = y (θx = 1). */
const rigidModes = (corners: Vec2[]) => [
  corners.flatMap(() => [1, 0, 0]),
  corners.flatMap(([x]) => [x, 0, -1]),
  corners.flatMap(([, y]) => [y, 1, 0]),
];

describe("dkqPlateStiffness: element properties", () => {
  const k = dkqPlateStiffness(quad, slab);

  it("is symmetric", () => {
    for (let a = 0; a < 12; a++) {
      for (let b = 0; b < 12; b++) {
        expect(Math.abs(k[a][b] - k[b][a])).toBeLessThan(1e-12 * Math.abs(k[a][a] + k[b][b]));
      }
    }
  });

  it("carries no force in the three rigid-body modes", () => {
    for (const mode of rigidModes(quad)) {
      // each residual against the size of the terms that cancel in it
      k.forEach((row) => {
        const residual = row.reduce((sum, v, b) => sum + v * mode[b], 0);
        const terms = row.reduce((sum, v, b) => sum + Math.abs(v * mode[b]), 0);
        expect(Math.abs(residual)).toBeLessThan(1e-12 * terms);
      });
    }
  });

  it("has no other zero-energy mode (positive definite once the rigid modes are held)", () => {
    // w₁, θx₁, θy₁ held: removes the three rigid-body modes
    for (const corners of [quad, rectangle]) {
      const scaled = scaleRotations(dkqPlateStiffness(corners, slab), 1000);
      expect(
        choleskyFactor(
          scaled.slice(3).map((row) => row.slice(3)),
          1e-10,
        ),
      ).not.toBeNull();
    }
  });

  it("transforms as a tensor under an in-plane rotation of the element", () => {
    const alpha = -1.1;
    const c = Math.cos(alpha);
    const s = Math.sin(alpha);
    const rotated = quad.map(([x, y]): Vec2 => [c * x - s * y, s * x + c * y]);
    const kRotated = dkqPlateStiffness(rotated, slab);
    // w' = w and [θx', θy'] = Q·[θx, θy] per node, so k' = T·k·Tᵀ
    const T = (a: number, b: number) => {
      if (Math.floor(a / 3) !== Math.floor(b / 3)) return 0;
      const [i, j] = [a % 3, b % 3];
      if (i === 0 || j === 0) return i === j ? 1 : 0;
      return [
        [c, -s],
        [s, c],
      ][i - 1][j - 1];
    };
    for (let a = 0; a < 12; a++) {
      for (let b = 0; b < 12; b++) {
        let expected = 0;
        for (let p = 0; p < 12; p++) {
          for (let q = 0; q < 12; q++) expected += T(a, p) * k[p][q] * T(b, q);
        }
        expect(Math.abs(kRotated[a][b] - expected)).toBeLessThan(
          1e-10 * Math.sqrt(Math.abs(k[a][a] * k[b][b])),
        );
      }
    }
  });

  it("does not depend on which corner is listed first", () => {
    const kShifted = dkqPlateStiffness([quad[1], quad[2], quad[3], quad[0]], slab);
    const original = (a: number) => 3 * ((Math.floor(a / 3) + 1) % 4) + (a % 3);
    for (let a = 0; a < 12; a++) {
      for (let b = 0; b < 12; b++) {
        expect(Math.abs(kShifted[a][b] - k[original(a)][original(b)])).toBeLessThan(
          1e-10 * Math.sqrt(Math.abs(k[a][a] * k[b][b])),
        );
      }
    }
  });

  it("scales with t³", () => {
    const k2 = dkqPlateStiffness(quad, { ...slab, t: 2 * slab.t });
    for (let a = 0; a < 12; a++) expect(k2[a][a] / k[a][a]).toBeCloseTo(8, 10);
  });
});

describe("MacNeal–Harder plate patch test", () => {
  // 0.24 × 0.12 rectangle with four interior nodes; E = 10⁶, ν = 0.25, t = 0.001
  const properties: PlateProperties = { E: 1e6, nu: 0.25, t: 0.001 };
  const nodes: Vec2[] = [
    [0, 0],
    [0.24, 0],
    [0.24, 0.12],
    [0, 0.12],
    [0.04, 0.02],
    [0.18, 0.03],
    [0.16, 0.08],
    [0.08, 0.08],
  ];
  const elements = [
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
    [4, 5, 6, 7],
  ];
  // w = 10⁻³(1 + x + 2y + x² + xy + y²)/2, θx = w,y, θy = −w,x
  const exact = ([x, y]: Vec2) => [
    (1e-3 * (1 + x + 2 * y + x * x + x * y + y * y)) / 2,
    (1e-3 * (2 + x + 2 * y)) / 2,
    (-1e-3 * (1 + 2 * x + y)) / 2,
  ];
  const prescribed = new Map<number, number>();
  for (let n = 0; n < 4; n++) {
    exact(nodes[n]).forEach((v, k) => prescribed.set(dof(n, k as 0 | 1 | 2), v));
  }
  const U = solveQuadMesh(nodes, elements, (c) => dkqPlateStiffness(c, properties), prescribed);

  it("reproduces the quadratic deflection exactly at the interior nodes", () => {
    for (let n = 4; n < 8; n++) {
      exact(nodes[n]).forEach((v, k) => expect(U[dof(n, k as 0 | 1 | 2)]).toBeCloseTo(v, 14));
    }
  });

  it("gives Mx = My = −1.111 × 10⁻⁷ and Mxy = −3.333 × 10⁻⁸ at every Gauss point", () => {
    const D = plateRigidity(properties);
    for (const element of elements) {
      const u = element.flatMap((n) => [U[dof(n, 0)], U[dof(n, 1)], U[dof(n, 2)]]);
      for (const g of GAUSS_2X2) {
        const { B } = dkqCurvatureRows(
          element.map((n) => nodes[n]),
          g.xi,
          g.eta,
        );
        const [Mx, My, Mxy] = matVec(D, matVec(B, u));
        expect(Mx / 1e-7).toBeCloseTo(-10 / 9, 8);
        expect(My / 1e-7).toBeCloseTo(-10 / 9, 8);
        expect(Mxy / 1e-8).toBeCloseTo(-10 / 3, 8);
      }
    }
  });
});

describe("square plate (Timoshenko & Woinowsky-Krieger), ν = 0.3", () => {
  /**
   * Full a × a plate on an n × n mesh, uniform load lumped as ∫Nᵢ q dA, or a unit point load at
   * the centre. Simply supported edges hold w and the rotation w = 0 along the edge implies.
   * Returns w_c·D/(q·a⁴) (or w_c·D/(P·a²)) and Mx at the centre / (q·a²), averaged over the four
   * elements meeting there.
   */
  const square = (
    n: number,
    support: "simple" | "clamped",
    { t = 0.01, load = "uniform" }: { t?: number; load?: "uniform" | "point" } = {},
  ) => {
    const properties = { E: 1, nu: 0.3, t };
    const { nodes, elements, id } = mapMesh(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      n,
      n,
    );
    const prescribed = new Map<number, number>();
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const xEdge = i === 0 || i === n;
        const yEdge = j === 0 || j === n;
        if (!xEdge && !yEdge) continue;
        prescribed.set(dof(id(i, j), 0), 0);
        if (support === "clamped" || xEdge) prescribed.set(dof(id(i, j), 1), 0);
        if (support === "clamped" || yEdge) prescribed.set(dof(id(i, j), 2), 0);
      }
    }
    const loads = new Map<number, number>();
    const centre = id(n / 2, n / 2);
    if (load === "point") loads.set(dof(centre, 0), 1);
    else {
      for (const element of elements) {
        for (const node of element)
          loads.set(dof(node, 0), (loads.get(dof(node, 0)) ?? 0) + 1 / (4 * n * n));
      }
    }
    const U = solveQuadMesh(
      nodes,
      elements,
      (c) => dkqPlateStiffness(c, properties),
      prescribed,
      loads,
    );
    const D = plateRigidity(properties);
    let moment = 0;
    for (const element of elements) {
      const corner = element.indexOf(centre);
      if (corner < 0) continue;
      const { B } = dkqCurvatureRows(
        element.map((m) => nodes[m]),
        [-1, 1, 1, -1][corner],
        [-1, -1, 1, 1][corner],
      );
      const u = element.flatMap((m) => [U[dof(m, 0)], U[dof(m, 1)], U[dof(m, 2)]]);
      moment += matVec(D, matVec(B, u))[0] / 4;
    }
    return { w: U[dof(centre, 0)] * D[0][0], M: moment };
  };

  it("simply supported, uniform load: w_c → 0.00406 qa⁴/D and M_c → 0.0479 qa²", () => {
    const w = [2, 4, 8, 16].map((n) => square(n, "simple").w);
    expect(w.map((v) => +v.toFixed(6))).toEqual([0.003785, 0.004046, 0.00406, 0.004062]);
    expect(Math.abs(square(16, "simple").M / 0.0479 - 1)).toBeLessThan(0.005);
  });

  it("clamped, uniform load: w_c converges from above to 0.00126 qa⁴/D, M_c → 0.0231 qa²", () => {
    const results = [4, 8, 16].map((n) => square(n, "clamped"));
    const w = results.map((r) => r.w);
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[1]).toBeGreaterThan(w[2]);
    expect(w[2]).toBeGreaterThan(0.00126);
    expect(Math.abs(w[2] / 0.00126 - 1)).toBeLessThan(0.02);
    expect(Math.abs(results[2].M / 0.0231 - 1)).toBeLessThan(0.01);
  });

  it("simply supported, centre point load: w_c → 0.0116 Pa²/D", () => {
    const w = [4, 8, 16].map((n) => square(n, "simple", { load: "point" }).w);
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[1]).toBeGreaterThan(w[2]);
    expect(Math.abs(w[2] / 0.0116 - 1)).toBeLessThan(0.01);
  });

  it("does not lock: w_c·D is the same for t/a = 0.01 and 0.3 (thin-plate theory)", () => {
    expect(square(8, "simple", { t: 0.3 }).w).toBeCloseTo(square(8, "simple", { t: 0.01 }).w, 12);
  });
});

describe("MacNeal–Harder straight cantilever, out-of-plane tip shear", () => {
  // L = 6, width 0.2, t = 0.1, E = 10⁷, ν = 0.3, unit load at the tip; reference 0.4321
  const tipDeflection = (shape: (i: number) => [number, number]) => {
    const nodes: Vec2[] = [];
    for (let i = 0; i <= 6; i++) {
      const [bottom, top] = shape(i);
      nodes.push([bottom, 0], [top, 0.2]);
    }
    const elements = [0, 1, 2, 3, 4, 5].map((i) => [2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1]);
    const prescribed = new Map([0, 1, 2, 3, 4, 5].map((d) => [d, 0]));
    const loads = new Map([
      [dof(12, 0), 0.5],
      [dof(13, 0), 0.5],
    ]);
    const U = solveQuadMesh(
      nodes,
      elements,
      (c) => dkqPlateStiffness(c, { E: 1e7, nu: 0.3, t: 0.1 }),
      prescribed,
      loads,
    );
    return (U[dof(12, 0)] + U[dof(13, 0)]) / 2;
  };

  it("is within 2 % of the reference on regular, trapezoidal and parallelogram meshes", () => {
    const shapes: ((i: number) => [number, number])[] = [
      (i) => [i, i],
      (i) => (i === 0 || i === 6 ? [i, i] : [i + (i % 2 ? 0.1 : -0.1), i - (i % 2 ? 0.1 : -0.1)]),
      (i) => [i, i === 0 || i === 6 ? i : i + 0.2],
    ];
    const results = shapes.map(tipDeflection);
    expect(results.map((v) => +v.toFixed(4))).toEqual([0.4263, 0.4266, 0.4261]);
    for (const v of results) expect(Math.abs(v / 0.4321 - 1)).toBeLessThan(0.02);
  });
});
