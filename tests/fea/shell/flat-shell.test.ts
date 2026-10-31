import { dkqPlateStiffness } from "@app-fea/shell/elements/dkq-plate";
import {
  flatShellElement,
  flatShellLocalStiffness,
  shellGlobalStiffness,
  shellNodeTransforms,
  type FlatShellProperties,
} from "@app-fea/shell/elements/flat-shell";
import { membraneQuadStiffness } from "@app-fea/shell/elements/membrane-quad";
import type { Vec2 } from "@app-fea/shell/elements/quad-geometry";
import { isotropicRigidity } from "@app-fea/shell/elements/rigidity";
import { shellAxes, type Vec3 } from "@app-fea/shell/elements/shell-axes";
import { choleskyFactor, type Matrix } from "@app-utils/matrix";
import { dof, solveQuadMesh } from "./mesh-harness";
import { dof6, solveShellMesh } from "./shell-harness";

const wall: FlatShellProperties = { E: 30000, nu: 0.2, t: 200, type: "shell" };
const corners: Vec2[] = [
  [0, 0],
  [2000, 300],
  [2400, 1800],
  [-200, 1500],
];
// An inclined, flat element and a warped one (mm)
const inclined: Vec3[] = [
  [0, 0, 0],
  [5000, 1000, 0],
  [4000, 5000, 3000],
  [-1000, 4000, 3000],
];
const warped: Vec3[] = [
  [0, 0, 80],
  [4000, 500, -60],
  [4500, 3500, 120],
  [-300, 3000, -90],
];

/** The six rigid-body modes over [ux uy uz rx ry rz] per node: translations and rotations about the origin. */
const rigidModes = (points: Vec3[]) => [
  ...[0, 1, 2].map((k) => points.flatMap(() => [0, 1, 2, 3, 4, 5].map((d) => (d === k ? 1 : 0)))),
  ...[0, 1, 2].map((k) => {
    const w = [0, 1, 2].map((i) => (i === k ? 1 : 0));
    // u = ω × p, θ = ω
    return points.flatMap(([x, y, z]) => [
      w[1] * z - w[2] * y,
      w[2] * x - w[0] * z,
      w[0] * y - w[1] * x,
      ...w,
    ]);
  }),
];
/** Largest |K·r| relative to the terms that cancel in it, over the rigid-body modes. */
const rigidResidual = (k: Matrix, points: Vec3[]) =>
  Math.max(
    ...rigidModes(points).flatMap((mode) =>
      k.map((row) => {
        const residual = row.reduce((s, v, b) => s + v * mode[b], 0);
        const terms = row.reduce((s, v, b) => s + Math.abs(v * mode[b]), 0);
        return terms > 0 ? Math.abs(residual) / terms : 0;
      }),
    ),
  );
/** Rows and columns of the rotations scaled by `length`, so all DOFs are in mm. */
const scaleRotations = (k: Matrix, length: number): Matrix =>
  k.map((row, a) => row.map((v, b) => v * (a % 6 >= 3 ? length : 1) * (b % 6 >= 3 ? length : 1)));
const blockRotation = (R: Matrix, k: Matrix): Matrix => {
  // k' = Rb·k·Rbᵀ with Rb = blockdiag(R) over all 3-DOF groups
  const n = k.length;
  const Rb = (a: number, b: number) =>
    Math.floor(a / 3) === Math.floor(b / 3) ? R[a % 3][b % 3] : 0;
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      let v = 0;
      for (let p = 3 * Math.floor(a / 3); p < 3 * Math.floor(a / 3) + 3; p++) {
        for (let q = 3 * Math.floor(b / 3); q < 3 * Math.floor(b / 3) + 3; q++) {
          v += Rb(a, p) * k[p][q] * Rb(b, q);
        }
      }
      out[a][b] = v;
    }
  }
  return out;
};
const relativeDifference = (a: Matrix, b: Matrix) => {
  const scale = Math.max(...b.flat().map(Math.abs));
  return Math.max(...a.flatMap((row, i) => row.map((v, j) => Math.abs(v - b[i][j])))) / scale;
};

describe("flatShellLocalStiffness", () => {
  const MEMBRANE = [0, 1, 5];
  const PLATE = [2, 3, 4];
  const at = (part: number[], a: number) => 6 * Math.floor(a / 3) + part[a % 3];

  it("puts the membrane on u₁, u₂, r₃ and the plate on u₃, r₁, r₂, uncoupled", () => {
    const k = flatShellLocalStiffness(corners, wall);
    const membrane = membraneQuadStiffness(corners, wall);
    const plate = dkqPlateStiffness(corners, wall);
    for (let a = 0; a < 12; a++) {
      for (let b = 0; b < 12; b++) {
        expect(k[at(MEMBRANE, a)][at(MEMBRANE, b)]).toBe(membrane[a][b]);
        expect(k[at(PLATE, a)][at(PLATE, b)]).toBe(plate[a][b]);
        expect(k[at(MEMBRANE, a)][at(PLATE, b)]).toBe(0);
      }
    }
  });

  it("keeps only the membrane part for type membrane and only the plate part for type plate", () => {
    const membrane = flatShellLocalStiffness(corners, { ...wall, type: "membrane" });
    const plate = flatShellLocalStiffness(corners, { ...wall, type: "plate" });
    for (let a = 0; a < 12; a++) {
      for (let b = 0; b < 24; b++) {
        expect(membrane[at(PLATE, a)][b]).toBe(0);
        expect(plate[at(MEMBRANE, a)][b]).toBe(0);
      }
    }
    expect(membrane[0][0]).toBeGreaterThan(0);
    expect(plate[2][2]).toBeGreaterThan(0);
  });
});

describe("flatShellElement: global stiffness", () => {
  it("is symmetric", () => {
    const { kGlobal } = flatShellElement(warped, wall);
    for (let a = 0; a < 24; a++) {
      for (let b = 0; b < 24; b++) {
        expect(Math.abs(kGlobal[a][b] - kGlobal[b][a])).toBeLessThan(
          1e-12 * (Math.abs(kGlobal[a][a]) + Math.abs(kGlobal[b][b])),
        );
      }
    }
  });

  it("carries no force in the six rigid-body modes, flat or warped", () => {
    expect(rigidResidual(flatShellElement(inclined, wall).kGlobal, inclined)).toBeLessThan(1e-12);
    expect(rigidResidual(flatShellElement(warped, wall).kGlobal, warped)).toBeLessThan(1e-12);
  });

  it("needs the rigid links on a warped element: without them a rigid rotation is resisted", () => {
    const axes = shellAxes(warped);
    const flatOnly = shellNodeTransforms({ ...axes, offsets: [0, 0, 0, 0] });
    const k = shellGlobalStiffness(flatShellLocalStiffness(axes.corners, wall), flatOnly);
    expect(rigidResidual(k, warped)).toBeGreaterThan(1e-3);
  });

  it("has no other zero-energy mode (positive definite once one corner is held)", () => {
    for (const points of [inclined, warped]) {
      const k = scaleRotations(flatShellElement(points, wall).kGlobal, 1000);
      expect(
        choleskyFactor(
          k.slice(6).map((row) => row.slice(6)),
          1e-10,
        ),
      ).not.toBeNull();
    }
  });

  it("rotates with the element: k(R·x) = R·k(x)·Rᵀ for any rotation R", () => {
    // R from rotations of 0.4 rad about X, then 0.9 about Y, then −1.3 about Z
    const rx = [
      [1, 0, 0],
      [0, Math.cos(0.4), -Math.sin(0.4)],
      [0, Math.sin(0.4), Math.cos(0.4)],
    ];
    const ry = [
      [Math.cos(0.9), 0, Math.sin(0.9)],
      [0, 1, 0],
      [-Math.sin(0.9), 0, Math.cos(0.9)],
    ];
    const rz = [
      [Math.cos(-1.3), -Math.sin(-1.3), 0],
      [Math.sin(-1.3), Math.cos(-1.3), 0],
      [0, 0, 1],
    ];
    const mul = (A: Matrix, B: Matrix) =>
      A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
    const R = mul(rz, mul(ry, rx));
    const rotate = (p: Vec3): Vec3 => R.map((r) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2]) as Vec3;
    const k = flatShellElement(warped, wall).kGlobal;
    const kRotated = flatShellElement(warped.map(rotate), wall).kGlobal;
    expect(relativeDifference(kRotated, blockRotation(R, k))).toBeLessThan(1e-10);
  });

  it("does not depend on angle without modifiers", () => {
    const k0 = flatShellElement(inclined, wall).kGlobal;
    const k1 = flatShellElement(inclined, wall, 0.8).kGlobal;
    expect(relativeDifference(k1, k0)).toBeLessThan(1e-10);
  });

  it("applies modifiers along local 1 and 2: angle 90° swaps the 11 and 22 modifiers", () => {
    const modified = {
      ...wall,
      membraneModifiers: [0.4, 1, 0.7],
      bendingModifiers: [0.25, 1, 0.5],
    } as const;
    const swapped = {
      ...wall,
      membraneModifiers: [1, 0.4, 0.7],
      bendingModifiers: [1, 0.25, 0.5],
    } as const;
    const k90 = flatShellElement(inclined, modified, Math.PI / 2).kGlobal;
    const k0 = flatShellElement(inclined, swapped).kGlobal;
    expect(relativeDifference(k90, k0)).toBeLessThan(1e-10);
    expect(relativeDifference(flatShellElement(inclined, modified).kGlobal, k0)).toBeGreaterThan(
      1e-3,
    );
  });

  it("scales the bending part by m when m11 = m22 = m12 = m", () => {
    const plain = flatShellLocalStiffness(corners, { ...wall, type: "plate" });
    const cracked = flatShellLocalStiffness(corners, {
      ...wall,
      type: "plate",
      bendingModifiers: [0.25, 0.25, 0.25],
    });
    plain.forEach((row, a) =>
      row.forEach((v, b) => expect(cracked[a][b]).toBeCloseTo(0.25 * v, 6)),
    );
  });
});

describe("isotropicRigidity", () => {
  it("applies modifiers as S·D·S with S = diag(√f11, √f22, √f12)", () => {
    const D = isotropicRigidity(100, 0.25, [0.36, 0.64, 0.5]);
    expect(D[0][0]).toBeCloseTo(36, 12);
    expect(D[1][1]).toBeCloseTo(64, 12);
    expect(D[0][1]).toBeCloseTo(100 * 0.25 * 0.6 * 0.8, 12);
    expect(D[1][0]).toBeCloseTo(D[0][1], 14);
    expect(D[2][2]).toBeCloseTo(((100 * 0.75) / 2) * 0.5, 12);
  });
});

describe("MacNeal–Harder straight cantilever as a 3D shell", () => {
  // L = 6, width 0.2, t = 0.1, E = 10⁷, ν = 0.3, unit tip load, 6 elements
  const properties: FlatShellProperties = { E: 1e7, nu: 0.3, t: 0.1, type: "shell" };
  const strip = (place: (p: Vec3) => Vec3) => {
    const nodes: Vec3[] = [];
    for (let i = 0; i <= 6; i++) nodes.push(place([i, 0, 0]), place([i, 0.2, 0]));
    const elements = [0, 1, 2, 3, 4, 5].map((i) => [2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1]);
    return { nodes, elements };
  };
  const tip = (U: number[], direction: number[]) =>
    [12, 13].reduce((s, n) => s + direction.reduce((d, c, k) => d + c * U[dof6(n, k)], 0) / 2, 0);
  const load = (direction: number[]) =>
    new Map(
      [12, 13].flatMap((n) =>
        [0, 1, 2].map((k): [number, number] => [dof6(n, k), direction[k] / 2]),
      ),
    );

  it("matches the 2D membrane and plate elements in the XY plane", () => {
    const { nodes, elements } = strip((p) => p);
    // root: everything held except the drilling rotation, as in the 2D membrane test
    const root = new Map(
      [0, 1].flatMap((n) => [0, 1, 2, 3, 4].map((k): [number, number] => [dof6(n, k), 0])),
    );
    const inPlane = tip(
      solveShellMesh(nodes, elements, properties, root, load([0, 1, 0])),
      [0, 1, 0],
    );
    const outOfPlane = tip(
      solveShellMesh(nodes, elements, properties, root, load([0, 0, 1])),
      [0, 0, 1],
    );

    const nodes2: Vec2[] = nodes.map(([x, y]) => [x, y]);
    const membrane = solveQuadMesh(
      nodes2,
      elements,
      (c) => membraneQuadStiffness(c, properties),
      new Map([0, 1].flatMap((n) => [0, 1].map((k): [number, number] => [dof(n, k as 0 | 1), 0]))),
      new Map([
        [dof(12, 1), 0.5],
        [dof(13, 1), 0.5],
      ]),
    );
    const plate = solveQuadMesh(
      nodes2,
      elements,
      (c) => dkqPlateStiffness(c, properties),
      new Map([0, 1, 2, 3, 4, 5].map((d): [number, number] => [d, 0])),
      new Map([
        [dof(12, 0), 0.5],
        [dof(13, 0), 0.5],
      ]),
    );
    expect(inPlane / ((membrane[dof(12, 1)] + membrane[dof(13, 1)]) / 2)).toBeCloseTo(1, 8);
    expect(outOfPlane / ((plate[dof(12, 0)] + plate[dof(13, 0)]) / 2)).toBeCloseTo(1, 8);
    expect(inPlane).toBeCloseTo(0.0977, 4);
    expect(outOfPlane).toBeCloseTo(0.4263, 4);
  });

  it("gives the same tip deflections when the whole strip is rotated in 3D", () => {
    const c = Math.cos(0.7);
    const s = Math.sin(0.7);
    // rotation of 0.7 rad about the axis (1, 1, 1)/√3
    const n = 1 / Math.sqrt(3);
    const R = [0, 1, 2].map((i) =>
      [0, 1, 2].map(
        (j) =>
          (i === j ? c : 0) +
          (1 - c) * n * n +
          s *
            [
              [0, -n, n],
              [n, 0, -n],
              [-n, n, 0],
            ][i][j],
      ),
    );
    const rotate = (p: Vec3): Vec3 => R.map((r) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2]) as Vec3;
    const clamped = new Map(
      [0, 1].flatMap((m) => [0, 1, 2, 3, 4, 5].map((k): [number, number] => [dof6(m, k), 0])),
    );
    for (const direction of [[0, 1, 0] as Vec3, [0, 0, 1] as Vec3]) {
      const flat = strip((p) => p);
      const turned = strip(rotate);
      const d = rotate(direction);
      const expected = tip(
        solveShellMesh(flat.nodes, flat.elements, properties, clamped, load(direction)),
        direction,
      );
      const actual = tip(
        solveShellMesh(turned.nodes, turned.elements, properties, clamped, load(d)),
        d,
      );
      expect(actual / expected).toBeCloseTo(1, 8);
    }
  });
});

describe("MacNeal–Harder twisted beam (every element warped)", () => {
  // L = 12, width 1.1, twisted 90° from root to tip, E = 29·10⁶, ν = 0.22, 12 × 2 mesh, clamped root
  const tipDeflection = (t: number, P: number, direction: "width" | "normal") => {
    const nodes: Vec3[] = [];
    for (let i = 0; i <= 12; i++) {
      const phi = (Math.PI / 2) * (i / 12);
      for (let j = 0; j <= 2; j++) {
        const s = -0.55 + 0.55 * j;
        nodes.push([i, s * Math.cos(phi), s * Math.sin(phi)]);
      }
    }
    const id = (i: number, j: number) => 3 * i + j;
    const elements: number[][] = [];
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 2; j++)
        elements.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
    }
    const clamped = new Map(
      [0, 1, 2].flatMap((m) => [0, 1, 2, 3, 4, 5].map((k): [number, number] => [dof6(m, k), 0])),
    );
    // at the tip the width runs along Z and the normal along −Y
    const k = direction === "width" ? 2 : 1;
    const loads = new Map([0, 1, 2].map((j): [number, number] => [dof6(id(12, j), k), P / 3]));
    const U = solveShellMesh(
      nodes,
      elements,
      { E: 29e6, nu: 0.22, t, type: "shell" },
      clamped,
      loads,
    );
    return [0, 1, 2].reduce((sum, j) => sum + U[dof6(id(12, j), k)] / 3, 0);
  };

  it("t = 0.32: within 1 % of 5.424·10⁻³ (in-plane) and 1.754·10⁻³ (out-of-plane)", () => {
    expect(Math.abs(tipDeflection(0.32, 1, "width") / 5.424e-3 - 1)).toBeLessThan(0.01);
    expect(Math.abs(tipDeflection(0.32, 1, "normal") / 1.754e-3 - 1)).toBeLessThan(0.01);
  });

  it("t = 0.0032, P = 10⁻⁶: within 1 % of 5.256·10⁻³ and 1.294·10⁻³", () => {
    expect(Math.abs(tipDeflection(0.0032, 1e-6, "width") / 5.256e-3 - 1)).toBeLessThan(0.01);
    expect(Math.abs(tipDeflection(0.0032, 1e-6, "normal") / 1.294e-3 - 1)).toBeLessThan(0.01);
  });
});
