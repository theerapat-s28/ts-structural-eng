import {
  choleskySolve,
  identity,
  matMul,
  matVec,
  solveLinearSystem,
  transpose,
  zeros,
} from "@app-utils/matrix";

describe("matrix utilities", () => {
  it("builds zeros and identity matrices", () => {
    expect(zeros(2, 3)).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(identity(2)).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("transposes a rectangular matrix", () => {
    expect(
      transpose([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it("multiplies matrices and matrix–vector products (hand calculation)", () => {
    const A = [
      [1, 2],
      [3, 4],
    ];
    const B = [
      [5, 6],
      [7, 8],
    ];
    expect(matMul(A, B)).toEqual([
      [19, 22],
      [43, 50],
    ]);
    expect(matVec(A, [1, -1])).toEqual([-1, -1]);
  });

  it("solves a symmetric positive-definite system by Cholesky", () => {
    // x = [1, 2, 3]
    const A = [
      [4, 12, -16],
      [12, 37, -43],
      [-16, -43, 98],
    ];
    const b = matVec(A, [1, 2, 3]);
    const x = choleskySolve(A, b) as number[];
    x.forEach((v, i) => expect(v).toBeCloseTo(i + 1, 10));
  });

  it("returns null for a matrix that is not positive definite", () => {
    expect(
      choleskySolve(
        [
          [1, 1],
          [1, 1],
        ],
        [1, 1],
      ),
    ).toBeNull();
    expect(
      choleskySolve(
        [
          [1, 2],
          [2, 1],
        ],
        [1, 1],
      ),
    ).toBeNull();
  });

  it("solves a general system with pivoting and detects singular ones", () => {
    const A = [
      [0, 2],
      [3, 1],
    ];
    const X = solveLinearSystem(A, [[4], [5]]) as number[][];
    expect(X[0][0]).toBeCloseTo(1, 12);
    expect(X[1][0]).toBeCloseTo(2, 12);
    expect(
      solveLinearSystem(
        [
          [1, 1],
          [2, 2],
        ],
        [[1], [2]],
      ),
    ).toBeNull();
  });
});
