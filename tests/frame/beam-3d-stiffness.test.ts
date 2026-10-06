import {
  beam3dLocalStiffness,
  beam3dLocalStiffnessRightHanded,
} from "@app-frame/elements/beam-3d-stiffness";
import { matVec } from "@app-utils/matrix";

// Distinct values so a swapped property shows up as a wrong cell
const E = 210;
const G = 11;
const A = 3;
const I22 = 7;
const I33 = 5;
const J = 13;
const L = 2;

const EA = (E * A) / L;
const GJ = (G * J) / L;
// Reference "Complete Beam Stiffness Matrix"; I33 for U2–R3 terms, I22 for U3–R2 terms
const t12 = (I: number) => (12 * E * I) / L ** 3;
const t6 = (I: number) => (6 * E * I) / L ** 2;
const t4 = (I: number) => (4 * E * I) / L;
const t2 = (I: number) => (2 * E * I) / L;

// Rows and columns in the order [U1 U2 U3 R1 R2 R3] at i, then at j, transcribed row by row from the reference image
const reference = [
  [EA, 0, 0, 0, 0, 0, -EA, 0, 0, 0, 0, 0],
  [0, t12(I33), 0, 0, 0, -t6(I33), 0, -t12(I33), 0, 0, 0, -t6(I33)],
  [0, 0, t12(I22), 0, t6(I22), 0, 0, 0, -t12(I22), 0, t6(I22), 0],
  [0, 0, 0, GJ, 0, 0, 0, 0, 0, -GJ, 0, 0],
  [0, 0, t6(I22), 0, t4(I22), 0, 0, 0, -t6(I22), 0, t2(I22), 0],
  [0, -t6(I33), 0, 0, 0, t4(I33), 0, t6(I33), 0, 0, 0, t2(I33)],
  [-EA, 0, 0, 0, 0, 0, EA, 0, 0, 0, 0, 0],
  [0, -t12(I33), 0, 0, 0, t6(I33), 0, t12(I33), 0, 0, 0, t6(I33)],
  [0, 0, -t12(I22), 0, -t6(I22), 0, 0, 0, t12(I22), 0, -t6(I22), 0],
  [0, 0, 0, -GJ, 0, 0, 0, 0, 0, GJ, 0, 0],
  [0, 0, t6(I22), 0, t2(I22), 0, 0, 0, -t6(I22), 0, t4(I22), 0],
  [0, -t6(I33), 0, 0, 0, t2(I33), 0, t6(I33), 0, 0, 0, t4(I33)],
];

describe("beam3dLocalStiffness (reference matrix)", () => {
  const k = beam3dLocalStiffness(E, G, A, I22, I33, J, L);

  it("matches the reference matrix cell by cell", () => {
    expect(k).toHaveLength(12);
    reference.forEach((row, i) =>
      row.forEach((expected, j) => expect(k[i][j]).toBeCloseTo(expected, 10)),
    );
  });

  it("is symmetric", () => {
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) expect(k[i][j]).toBeCloseTo(k[j][i], 10);
    }
  });

  it("reduces to a single-EI matrix when I22 = I33", () => {
    const sym = beam3dLocalStiffness(E, G, A, 5, 5, J, L);
    expect(sym[1][1]).toBeCloseTo(sym[2][2], 12);
    expect(sym[5][5]).toBeCloseTo(sym[4][4], 12);
    expect(sym[1][5]).toBeCloseTo(-sym[2][4], 12); // reference sign pattern
  });

  it("is free of force for rigid-body motion in the reference rotation convention", () => {
    const rigid: number[][] = [];
    // translations along 1, 2, 3
    for (const axis of [0, 1, 2]) {
      const u = new Array<number>(12).fill(0);
      u[axis] = 1;
      u[6 + axis] = 1;
      rigid.push(u);
    }
    // rotation about 1 (R1 equal at both ends)
    const rx = new Array<number>(12).fill(0);
    rx[3] = 1;
    rx[9] = 1;
    rigid.push(rx);
    // reference convention: positive R3 gives U2,j = −R3·L and positive R2 gives U3,j = +R2·L
    const r3 = new Array<number>(12).fill(0);
    r3[5] = 1;
    r3[11] = 1;
    r3[7] = -L;
    rigid.push(r3);
    const r2 = new Array<number>(12).fill(0);
    r2[4] = 1;
    r2[10] = 1;
    r2[8] = L;
    rigid.push(r2);
    rigid.forEach((u) => matVec(k, u).forEach((f) => expect(Math.abs(f)).toBeLessThan(1e-9)));
  });

  it("is not rigid-body free for right-hand rotations (documents the convention)", () => {
    const r3 = new Array<number>(12).fill(0);
    r3[5] = 1;
    r3[11] = 1;
    r3[7] = L; // right-hand rule
    expect(Math.max(...matVec(k, r3).map(Math.abs))).toBeGreaterThan(1);
  });
});

describe("beam3dLocalStiffnessRightHanded", () => {
  const kRH = beam3dLocalStiffnessRightHanded(E, G, A, I22, I33, J, L);

  it("equals the standard right-hand-rule beam matrix", () => {
    expect(kRH[1][5]).toBeCloseTo(t6(I33), 10); // F2,i from R3,i  (+6EI/L²)
    expect(kRH[2][4]).toBeCloseTo(-t6(I22), 10); // F3,i from R2,i  (−6EI/L²)
    expect(kRH[1][11]).toBeCloseTo(t6(I33), 10);
    expect(kRH[2][10]).toBeCloseTo(-t6(I22), 10);
    expect(kRH[4][4]).toBeCloseTo(t4(I22), 10);
    expect(kRH[5][5]).toBeCloseTo(t4(I33), 10);
    expect(kRH[0][0]).toBeCloseTo(EA, 10);
    expect(kRH[3][3]).toBeCloseTo(GJ, 10);
  });

  it("is free of force for all six right-handed rigid-body modes", () => {
    const modes: number[][] = [];
    const rot = (rotIndex: number, transIndex: number, sign: number) => {
      const u = new Array<number>(12).fill(0);
      u[rotIndex] = 1;
      u[6 + rotIndex] = 1;
      u[6 + transIndex] = sign * L;
      return u;
    };
    modes.push(rot(5, 1, 1)); // R3: U2,j = +R3·L
    modes.push(rot(4, 2, -1)); // R2: U3,j = −R2·L
    modes.forEach((u) => matVec(kRH, u).forEach((f) => expect(Math.abs(f)).toBeLessThan(1e-9)));
  });
});
