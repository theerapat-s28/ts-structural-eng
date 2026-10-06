export type Matrix = number[][];

/** Returns an m×n zero matrix. */
export const zeros = (m: number, n: number): Matrix =>
  Array.from({ length: m }, () => new Array<number>(n).fill(0));

/** Returns the n×n identity matrix. */
export const identity = (n: number): Matrix => {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
};

/** Returns the transpose of a matrix. */
export const transpose = (A: Matrix): Matrix => {
  const m = A.length;
  const n = A[0].length;
  const T = zeros(n, m);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) T[j][i] = A[i][j];
  }
  return T;
};

/** Returns the product A·B of an m×n and an n×p matrix. */
export const matMul = (A: Matrix, B: Matrix): Matrix => {
  const m = A.length;
  const n = B.length;
  const p = B[0].length;
  const C = zeros(m, p);
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < n; k++) {
      const aik = A[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < p; j++) C[i][j] += aik * B[k][j];
    }
  }
  return C;
};

/** Returns the product A·x of an m×n matrix and an n-vector. */
export const matVec = (A: Matrix, x: number[]): number[] =>
  A.map((row) => row.reduce((sum, a, j) => sum + a * x[j], 0));

/**
 * Solves A·x = b for a symmetric positive-definite A by Cholesky factorisation.
 *
 * @param A - Symmetric matrix (only the lower triangle is read)
 * @param b - Right-hand side
 * @param tolerance - A pivot at or below `tolerance` times its own diagonal term is treated as zero
 * @returns The solution, or `null` when A is not positive definite (singular or a mechanism)
 */
export const choleskySolve = (A: Matrix, b: number[], tolerance = 1e-12): number[] | null => {
  const n = A.length;
  const L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(sum > tolerance * A[i][i])) return null;
        L[i][i] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i][k] * y[k];
    y[i] = sum / L[i][i];
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
    x[i] = sum / L[i][i];
  }
  return x;
};

/**
 * Solves A·X = B for a general square A by Gaussian elimination with partial pivoting.
 *
 * @param A - n×n matrix
 * @param B - n×p right-hand-side matrix
 * @param tolerance - A pivot at or below `tolerance` times the largest entry of A is treated as zero
 * @returns The n×p solution, or `null` when A is singular
 */
export const solveLinearSystem = (A: Matrix, B: Matrix, tolerance = 1e-12): Matrix | null => {
  const n = A.length;
  const p = B[0].length;
  const M = A.map((row, i) => [...row, ...B[i]]);
  const scale = Math.max(...A.map((row) => Math.max(...row.map(Math.abs))));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (!(Math.abs(M[pivot][col]) > tolerance * scale)) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c < n + p; c++) M[r][c] -= factor * M[col][c];
    }
  }
  const X = zeros(n, p);
  for (let c = 0; c < p; c++) {
    for (let i = n - 1; i >= 0; i--) {
      let sum = M[i][n + c];
      for (let k = i + 1; k < n; k++) sum -= M[i][k] * X[k][c];
      X[i][c] = sum / M[i][i];
    }
  }
  return X;
};
