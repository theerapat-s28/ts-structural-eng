import { memberAxes, transformationMatrix } from "@app-frame/transformation/coordinate-transform";
import { FrameAnalysisError } from "@app-core/errors/frame-analysis.error";
import { matMul, transpose } from "@app-utils/matrix";

const expectRows = (lambda: number[][], rows: number[][]) =>
  rows.forEach((row, i) => row.forEach((v, j) => expect(lambda[i][j]).toBeCloseTo(v, 10)));

describe("memberAxes (ETABS-style local axes)", () => {
  it("beam along +X: local 2 = +Z, local 3 = −Y", () => {
    const { length, lambda } = memberAxes([0, 0, 0], [5000, 0, 0]);
    expect(length).toBeCloseTo(5000, 10);
    expectRows(lambda, [
      [1, 0, 0],
      [0, 0, 1],
      [0, -1, 0],
    ]);
  });

  it("beam along +Y: local 3 is horizontal and local 2 points up", () => {
    const { lambda } = memberAxes([0, 0, 0], [0, 4000, 0]);
    expectRows(lambda, [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ]);
  });

  it("column along +Z: local 2 = +X, local 3 = +Y", () => {
    const { lambda } = memberAxes([0, 0, 0], [0, 0, 3000]);
    expectRows(lambda, [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it("member angle of 90° swaps local 2 and 3 (about local 1, right-hand rule)", () => {
    const { lambda } = memberAxes([0, 0, 0], [5000, 0, 0], Math.PI / 2);
    expectRows(lambda, [
      [1, 0, 0],
      [0, -1, 0], // old local 3
      [0, 0, -1], // −old local 2
    ]);
  });

  it("returns an orthonormal right-handed triad for an inclined member", () => {
    const { lambda } = memberAxes([100, -200, 50], [3100, 1800, 2050], 0.3);
    const product = matMul(lambda, transpose(lambda));
    product.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 10)));
    const [e1, e2, e3] = lambda;
    const cross = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    cross.forEach((v, i) => expect(v).toBeCloseTo(e3[i], 10));
  });

  it("throws 301 for a zero-length member", () => {
    expect(() => memberAxes([1, 2, 3], [1, 2, 3])).toThrow(FrameAnalysisError);
    try {
      memberAxes([1, 2, 3], [1, 2, 3]);
    } catch (e) {
      expect((e as FrameAnalysisError).code).toBe(301);
    }
  });
});

describe("transformationMatrix", () => {
  it("repeats λ on the diagonal and is orthogonal", () => {
    const { lambda } = memberAxes([0, 0, 0], [1000, 2000, 2000]);
    const T = transformationMatrix(lambda);
    expect(T).toHaveLength(12);
    const product = matMul(transpose(T), T);
    product.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 10)));
    expect(T[3][3]).toBe(lambda[0][0]);
    expect(T[9][11]).toBe(lambda[0][2]);
    expect(T[0][3]).toBe(0);
  });
});
