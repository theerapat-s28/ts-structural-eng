import { choleskySolve, matVec, zeros } from "@app-utils/matrix";
import {
  createSkyline,
  reverseCuthillMcKee,
  skylineAdd,
  skylineFactor,
  skylineGet,
  skylineSize,
  skylineSolve,
} from "@app-utils/skyline";

/** Deterministic pseudo-random numbers in [0, 1). */
const random = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

/** A symmetric positive-definite matrix with a variable band (diagonally dominant). */
const bandedSpd = (n: number, seed: number) => {
  const rand = random(seed);
  const A = zeros(n, n);
  const first = Array.from({ length: n }, (_, j) => Math.max(0, j - 1 - Math.floor(rand() * 4)));
  for (let j = 0; j < n; j++) {
    for (let i = first[j]; i < j; i++) {
      const v = rand() - 0.5;
      A[i][j] = v;
      A[j][i] = v;
    }
  }
  for (let i = 0; i < n; i++) A[i][i] = 1 + A[i].reduce((s, v) => s + Math.abs(v), 0);
  return { A, first };
};

const bandwidth = (order: number[], edges: [number, number][]) => {
  const position = new Map(order.map((v, i) => [v, i]));
  return Math.max(...edges.map(([a, b]) => Math.abs(position.get(a)! - position.get(b)!)));
};

describe("skyline matrix", () => {
  it("stores, reads and sums entries inside the profile", () => {
    const S = createSkyline([0, 0, 1]);
    skylineAdd(S, 0, 1, 2);
    skylineAdd(S, 1, 0, 3); // same entry
    skylineAdd(S, 2, 2, 7);
    expect(skylineGet(S, 1, 0)).toBe(5);
    expect(skylineGet(S, 2, 2)).toBe(7);
    expect(skylineGet(S, 0, 2)).toBe(0); // outside the profile
    expect(skylineSize(S)).toBe(1 + 2 + 2);
    expect(() => skylineAdd(S, 0, 2, 1)).toThrow();
  });

  it.each([5, 12, 40])("solves like the dense Cholesky for a %i×%i banded SPD matrix", (n) => {
    const { A, first } = bandedSpd(n, n);
    const S = createSkyline(first);
    for (let j = 0; j < n; j++) for (let i = first[j]; i <= j; i++) skylineAdd(S, i, j, A[i][j]);
    expect(skylineFactor(S)).toEqual({ ok: true });
    for (const seed of [1, 2]) {
      const rand = random(seed);
      const x = Array.from({ length: n }, () => rand() * 10 - 5);
      const b = matVec(A, x);
      const fromSkyline = skylineSolve(S, b);
      const fromDense = choleskySolve(A, b)!;
      fromSkyline.forEach((v, i) => {
        expect(v).toBeCloseTo(x[i], 9);
        expect(v).toBeCloseTo(fromDense[i], 9);
      });
    }
  });

  it("reports the first failing pivot of a singular matrix", () => {
    // rows 1 and 2 are equal → singular at pivot 2
    const S = createSkyline([0, 0, 0]);
    const A = [
      [2, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ];
    for (let j = 0; j < 3; j++) for (let i = 0; i <= j; i++) skylineAdd(S, i, j, A[i][j]);
    expect(skylineFactor(S)).toEqual({ ok: false, failedPivot: 2 });
  });
});

describe("reverseCuthillMcKee", () => {
  it("returns a permutation and narrows the band of a scrambled path", () => {
    // path 0-1-2-…-29, but numbered randomly
    const n = 30;
    const rand = random(7);
    const label = Array.from({ length: n }, (_, i) => i).sort(() => rand() - 0.5);
    const edges: [number, number][] = [];
    for (let i = 0; i < n - 1; i++) edges.push([label[i], label[i + 1]]);
    const adjacency: number[][] = Array.from({ length: n }, () => []);
    for (const [a, b] of edges) {
      adjacency[a].push(b);
      adjacency[b].push(a);
    }
    const order = reverseCuthillMcKee(adjacency);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    expect(bandwidth(order, edges)).toBe(1);
    expect(
      bandwidth(
        Array.from({ length: n }, (_, i) => i),
        edges,
      ),
    ).toBeGreaterThan(5);
  });

  it("orders every component of a disconnected graph, including isolated vertices", () => {
    const adjacency = [[1], [0], [], [4], [3]];
    const order = reverseCuthillMcKee(adjacency);
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("gives a 2D grid a band close to the grid width", () => {
    const w = 6;
    const h = 20;
    const id = (i: number, j: number) => j * w + i;
    const adjacency: number[][] = Array.from({ length: w * h }, () => []);
    const edges: [number, number][] = [];
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        if (i + 1 < w) edges.push([id(i, j), id(i + 1, j)]);
        if (j + 1 < h) edges.push([id(i, j), id(i, j + 1)]);
      }
    // scramble the vertex numbers
    const rand = random(3);
    const perm = Array.from({ length: w * h }, (_, i) => i).sort(() => rand() - 0.5);
    const scrambled = edges.map(([a, b]) => [perm[a], perm[b]] as [number, number]);
    for (const [a, b] of scrambled) {
      adjacency[a].push(b);
      adjacency[b].push(a);
    }
    expect(bandwidth(reverseCuthillMcKee(adjacency), scrambled)).toBeLessThanOrEqual(w + 1);
  });
});
