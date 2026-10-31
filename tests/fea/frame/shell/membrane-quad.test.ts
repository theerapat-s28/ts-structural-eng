import {
  membraneQuadStiffness,
  membraneRigidity,
  membraneStrainRows,
} from "@app-fea/frame/elements/shell/membrane-quad";
import { GAUSS_2X2, type Vec2 } from "@app-fea/frame/elements/shell/quad-geometry";
import { choleskyFactor, matVec, type Matrix } from "@app-utils/matrix";
import { dof, mapMesh, solveQuadMesh } from "./mesh-harness";

const wall = { E: 30000, nu: 0.2, t: 200 }; // MPa, —, mm
// A distorted convex quad, counter-clockwise (mm)
const quad: Vec2[] = [
  [0, 0],
  [2000, 300],
  [2400, 1800],
  [-200, 1500],
];

const maxAbs = (k: Matrix) => Math.max(...k.flat().map(Math.abs));
/** Rigid-body modes over [u v θ] per node: translations along x and y, and rotation about z. */
const rigidModes = (corners: Vec2[]) => [
  corners.flatMap(() => [1, 0, 0]),
  corners.flatMap(() => [0, 1, 0]),
  corners.flatMap(([x, y]) => [-y, x, 1]),
];

describe("membraneQuadStiffness: element properties", () => {
  const k = membraneQuadStiffness(quad, wall);
  const scale = maxAbs(k);

  it("is symmetric", () => {
    for (let a = 0; a < 12; a++) {
      for (let b = 0; b < 12; b++) expect(Math.abs(k[a][b] - k[b][a])).toBeLessThan(1e-12 * scale);
    }
  });

  it("carries no force in the three rigid-body modes", () => {
    for (const mode of rigidModes(quad)) {
      const size = Math.max(...mode.map(Math.abs));
      for (const f of matVec(k, mode)) expect(Math.abs(f)).toBeLessThan(1e-9 * scale * size);
    }
  });

  it("has no other zero-energy mode (positive definite once the rigid modes are held)", () => {
    // u₁, v₁, θ₁ held: removes both translations and the rotation
    for (const corners of [
      quad,
      [
        [0, 0],
        [1000, 0],
        [1000, 500],
        [0, 500],
      ] as Vec2[],
    ]) {
      const kk = membraneQuadStiffness(corners, wall);
      const reduced = kk.slice(3).map((row) => row.slice(3));
      expect(choleskyFactor(reduced, 1e-8)).not.toBeNull();
    }
  });

  it("transforms as a tensor under an in-plane rotation of the element", () => {
    const alpha = 0.7;
    const c = Math.cos(alpha);
    const s = Math.sin(alpha);
    const rotated = quad.map(([x, y]): Vec2 => [c * x - s * y, s * x + c * y]);
    const kRotated = membraneQuadStiffness(rotated, wall);
    // u' = Q·u per node, θ' = θ, so k' = T·k·Tᵀ with T = blockdiag(Q, 1)
    const T = (a: number, b: number) => {
      if (Math.floor(a / 3) !== Math.floor(b / 3)) return 0;
      const [i, j] = [a % 3, b % 3];
      if (i === 2 || j === 2) return i === j ? 1 : 0;
      return [
        [c, -s],
        [s, c],
      ][i][j];
    };
    for (let a = 0; a < 12; a++) {
      for (let b = 0; b < 12; b++) {
        let expected = 0;
        for (let p = 0; p < 12; p++) {
          for (let q = 0; q < 12; q++) expected += T(a, p) * k[p][q] * T(b, q);
        }
        expect(Math.abs(kRotated[a][b] - expected)).toBeLessThan(1e-10 * scale);
      }
    }
  });

  it("does not depend on which corner is listed first", () => {
    const shifted = [quad[1], quad[2], quad[3], quad[0]];
    const kShifted = membraneQuadStiffness(shifted, wall);
    const original = (a: number) => 3 * ((Math.floor(a / 3) + 1) % 4) + (a % 3);
    for (let a = 0; a < 12; a++) {
      for (let b = 0; b < 12; b++) {
        expect(Math.abs(kShifted[a][b] - k[original(a)][original(b)])).toBeLessThan(1e-10 * scale);
      }
    }
  });
});

describe("MacNeal–Harder membrane patch test", () => {
  // 0.24 × 0.12 rectangle with four interior nodes; E = 10⁶, ν = 0.25, t = 0.001
  const properties = { E: 1e6, nu: 0.25, t: 0.001 };
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

  const run = (rotation: number) => {
    // u = 10⁻³(x + y/2), v = 10⁻³(y + x/2) plus a rigid rotation, so θ = ω = rotation; every
    // boundary DOF is prescribed (a free θ there would let the boundary edges bulge)
    const exact = ([x, y]: Vec2) => [
      1e-3 * (x + y / 2) - rotation * y,
      1e-3 * (y + x / 2) + rotation * x,
    ];
    const prescribed = new Map<number, number>();
    for (let n = 0; n < 4; n++) {
      const [u, v] = exact(nodes[n]);
      prescribed.set(dof(n, 0), u);
      prescribed.set(dof(n, 1), v);
      prescribed.set(dof(n, 2), rotation);
    }
    const U = solveQuadMesh(
      nodes,
      elements,
      (c) => membraneQuadStiffness(c, properties),
      prescribed,
    );
    return { U, exact };
  };

  it("reproduces the linear field exactly, with θ equal to the material rotation", () => {
    for (const rotation of [0, 2e-4]) {
      const { U, exact } = run(rotation);
      for (let n = 0; n < nodes.length; n++) {
        const [u, v] = exact(nodes[n]);
        expect(U[dof(n, 0)]).toBeCloseTo(u, 14);
        expect(U[dof(n, 1)]).toBeCloseTo(v, 14);
        expect(U[dof(n, 2)]).toBeCloseTo(rotation, 14);
      }
    }
  });

  it("gives σx = σy = 1333.3 and τxy = 400 at every Gauss point", () => {
    const { U } = run(0);
    const D = membraneRigidity(properties);
    for (const element of elements) {
      const u = element.flatMap((n) => [U[dof(n, 0)], U[dof(n, 1)], U[dof(n, 2)]]);
      for (const g of GAUSS_2X2) {
        const { B } = membraneStrainRows(
          element.map((n) => nodes[n]),
          g.xi,
          g.eta,
        );
        const stress = matVec(D, matVec(B, u)).map((f) => f / properties.t);
        expect(stress[0]).toBeCloseTo(4000 / 3, 6);
        expect(stress[1]).toBeCloseTo(4000 / 3, 6);
        expect(stress[2]).toBeCloseTo(400, 6);
      }
    }
  });
});

describe("MacNeal–Harder straight cantilever, in-plane tip shear", () => {
  // L = 6, depth 0.2, t = 0.1, E = 10⁷, ν = 0.3, unit shear at the tip; reference 0.1081
  const REFERENCE = 0.1081;
  const tipDeflection = (shape: (i: number) => [number, number], penaltyRatio?: number) => {
    const nodes: Vec2[] = [];
    for (let i = 0; i <= 6; i++) {
      const [bottom, top] = shape(i);
      nodes.push([bottom, 0], [top, 0.2]);
    }
    const elements = [0, 1, 2, 3, 4, 5].map((i) => [2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1]);
    const prescribed = new Map([
      [dof(0, 0), 0],
      [dof(0, 1), 0],
      [dof(1, 0), 0],
      [dof(1, 1), 0],
    ]);
    const loads = new Map([
      [dof(12, 1), 0.5],
      [dof(13, 1), 0.5],
    ]);
    const U = solveQuadMesh(
      nodes,
      elements,
      (c) => membraneQuadStiffness(c, { E: 1e7, nu: 0.3, t: 0.1 }, penaltyRatio),
      prescribed,
      loads,
    );
    return (U[dof(12, 1)] + U[dof(13, 1)]) / 2;
  };
  const regular = (i: number): [number, number] => [i, i];
  // interior edges skewed 45° alternately, and all leaning 45°
  const trapezoidal = (i: number): [number, number] =>
    i === 0 || i === 6 ? [i, i] : [i + (i % 2 ? 0.1 : -0.1), i - (i % 2 ? 0.1 : -0.1)];
  const parallelogram = (i: number): [number, number] => [i, i === 0 || i === 6 ? i : i + 0.2];

  it("is about 90 % of the reference on a regular mesh (the bilinear quad gives 9 %)", () => {
    // A flipped sign on the Allman edge term still passes the patch test but gives 0.0031 here
    const v = tipDeflection(regular);
    expect(v).toBeCloseTo(0.0977, 4);
    expect(v / REFERENCE).toBeGreaterThan(0.9);
  });

  it("keeps 75 % (trapezoidal) and 85 % (parallelogram) of the reference on distorted meshes", () => {
    expect(tipDeflection(trapezoidal)).toBeCloseTo(0.0829, 4);
    expect(tipDeflection(parallelogram)).toBeCloseTo(0.0931, 4);
    expect(tipDeflection(trapezoidal) / REFERENCE).toBeGreaterThan(0.75);
    expect(tipDeflection(parallelogram) / REFERENCE).toBeGreaterThan(0.85);
  });

  it("is insensitive to the drilling penalty factor over γ = 0.01 G … 100 G", () => {
    for (const shape of [regular, trapezoidal, parallelogram]) {
      const base = tipDeflection(shape);
      for (const ratio of [0.01, 100]) {
        expect(Math.abs(tipDeflection(shape, ratio) / base - 1)).toBeLessThan(0.01);
      }
    }
  });
});

describe("Cook's membrane (tapered panel, plane stress)", () => {
  // Corners (0,0), (48,44), (48,60), (0,44); left edge clamped; unit total shear, uniform, on
  // the right edge; E = 1, ν = 1/3, t = 1. A bilinear quad, this element and an independent
  // 9-node element all converge to about 25.2 for the top-right corner.
  const corner = (n: number) => {
    const { nodes, elements, id } = mapMesh(
      [
        [0, 0],
        [48, 44],
        [48, 60],
        [0, 44],
      ],
      n,
      n,
    );
    const prescribed = new Map<number, number>();
    const loads = new Map<number, number>();
    for (let j = 0; j <= n; j++) {
      prescribed.set(dof(id(0, j), 0), 0);
      prescribed.set(dof(id(0, j), 1), 0);
      loads.set(dof(id(n, j), 1), j === 0 || j === n ? 0.5 / n : 1 / n);
    }
    const U = solveQuadMesh(
      nodes,
      elements,
      (c) => membraneQuadStiffness(c, { E: 1, nu: 1 / 3, t: 1 }),
      prescribed,
      loads,
    );
    return U[dof(id(n, n), 1)];
  };

  it("converges from below and is within 1.5 % on a 16 × 16 mesh", () => {
    const v = [4, 8, 16].map(corner);
    expect(v[0]).toBeCloseTo(23.8, 1);
    expect(v[1]).toBeGreaterThan(v[0]);
    expect(v[2]).toBeGreaterThan(v[1]);
    expect(v[2] - v[1]).toBeLessThan(v[1] - v[0]);
    expect(Math.abs(v[2] / 25.2 - 1)).toBeLessThan(0.015);
  });
});
