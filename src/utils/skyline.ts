/**
 * Symmetric matrix in skyline (variable-band, column profile) storage: column `j` holds rows
 * `first[j]` … `j` of the upper triangle, so memory follows the band of each column instead of
 * n². Cholesky factorisation stays inside this profile.
 */
export interface SkylineMatrix {
  n: number;
  /** First stored row of each column. */
  first: Int32Array;
  /** `columns[j][i − first[j]]` = A[i][j] for `first[j] ≤ i ≤ j`. */
  columns: Float64Array[];
}

/** Creates a zero skyline matrix with the given first row of each column (`first[j] ≤ j`). */
export const createSkyline = (first: ArrayLike<number>): SkylineMatrix => {
  const n = first.length;
  const firstRows = Int32Array.from(first);
  const columns = Array.from({ length: n }, (_, j) => new Float64Array(j - firstRows[j] + 1));
  return { n, first: firstRows, columns };
};

/** Adds `value` to A[i][j] (and so to A[j][i]); the entry must lie inside the profile. */
export const skylineAdd = (S: SkylineMatrix, i: number, j: number, value: number): void => {
  const row = Math.min(i, j);
  const col = Math.max(i, j);
  const offset = row - S.first[col];
  if (offset < 0) throw new Error(`Skyline entry (${row}, ${col}) is outside the profile.`);
  S.columns[col][offset] += value;
};

/** Reads A[i][j] (0 outside the profile). */
export const skylineGet = (S: SkylineMatrix, i: number, j: number): number => {
  const row = Math.min(i, j);
  const col = Math.max(i, j);
  const offset = row - S.first[col];
  return offset < 0 ? 0 : S.columns[col][offset];
};

/** Number of stored entries, a measure of memory and of factorisation work. */
export const skylineSize = (S: SkylineMatrix): number =>
  S.columns.reduce((sum, column) => sum + column.length, 0);

/**
 * Factorises a symmetric positive-definite skyline matrix in place as A = Uᵀ·U (U upper
 * triangular, same profile).
 *
 * @param S - Matrix, overwritten by U
 * @param tolerance - A pivot at or below `tolerance` times its own diagonal term is treated as zero
 * @returns `{ ok: true }`, or `{ ok: false, failedPivot }` with the index of the first pivot that
 *   failed (A is singular or indefinite there — for a structure, a mechanism involving that DOF)
 */
export const skylineFactor = (
  S: SkylineMatrix,
  tolerance = 1e-12,
): { ok: true } | { ok: false; failedPivot: number } => {
  const { n, first, columns } = S;
  for (let j = 0; j < n; j++) {
    const colJ = columns[j];
    const fj = first[j];
    for (let i = fj; i < j; i++) {
      const colI = columns[i];
      const fi = first[i];
      const k0 = Math.max(fi, fj);
      let sum = colJ[i - fj];
      for (let k = k0; k < i; k++) sum -= colI[k - fi] * colJ[k - fj];
      colJ[i - fj] = sum / colI[i - fi];
    }
    const diagonal = colJ[j - fj];
    let sum = diagonal;
    for (let k = fj; k < j; k++) sum -= colJ[k - fj] * colJ[k - fj];
    if (!(sum > tolerance * diagonal)) return { ok: false, failedPivot: j };
    colJ[j - fj] = Math.sqrt(sum);
  }
  return { ok: true };
};

/**
 * Solves A·x = b from the factor produced by `skylineFactor` (forward then back substitution).
 * One factorisation serves any number of right-hand sides.
 */
export const skylineSolve = (U: SkylineMatrix, b: ArrayLike<number>): number[] => {
  const { n, first, columns } = U;
  const y = Array.from(b);
  // Uᵀ·y = b
  for (let j = 0; j < n; j++) {
    const col = columns[j];
    const fj = first[j];
    let sum = y[j];
    for (let k = fj; k < j; k++) sum -= col[k - fj] * y[k];
    y[j] = sum / col[j - fj];
  }
  // U·x = y
  for (let j = n - 1; j >= 0; j--) {
    const col = columns[j];
    const fj = first[j];
    y[j] /= col[j - fj];
    const xj = y[j];
    for (let k = fj; k < j; k++) y[k] -= col[k - fj] * xj;
  }
  return y;
};

/**
 * Reverse Cuthill–McKee ordering of a graph, which keeps connected vertices close together and
 * so narrows the band of the matrix built on it. Each connected component starts from a
 * pseudo-peripheral vertex.
 *
 * @param adjacency - Neighbours of each vertex (undirected)
 * @returns The vertices in their new order (`order[k]` = original index of the k-th vertex)
 */
export const reverseCuthillMcKee = (adjacency: number[][]): number[] => {
  const n = adjacency.length;
  const degree = adjacency.map((neighbours) => neighbours.length);
  const visited = new Uint8Array(n);
  const order: number[] = [];

  /** Breadth-first levels from `start`, within unvisited vertices. */
  const levels = (start: number) => {
    const level = new Int32Array(n).fill(-1);
    level[start] = 0;
    const queue = [start];
    let last = start;
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q];
      for (const w of adjacency[v]) {
        if (!visited[w] && level[w] < 0) {
          level[w] = level[v] + 1;
          queue.push(w);
          if (level[w] > level[last] || (level[w] === level[last] && degree[w] < degree[last])) {
            last = w;
          }
        }
      }
    }
    return { depth: level[last], last };
  };

  const byDegree = Array.from({ length: n }, (_, i) => i).sort((a, b) => degree[a] - degree[b]);
  for (const seed of byDegree) {
    if (visited[seed]) continue;
    // pseudo-peripheral start: move to the far end of the BFS until the depth stops growing
    let start = seed;
    let { depth, last } = levels(start);
    for (let iteration = 0; iteration < 8; iteration++) {
      const next = levels(last);
      if (next.depth <= depth) break;
      start = last;
      depth = next.depth;
      last = next.last;
    }

    const component: number[] = [start];
    visited[start] = 1;
    for (let q = 0; q < component.length; q++) {
      const neighbours = adjacency[component[q]]
        .filter((w) => !visited[w])
        .sort((a, b) => degree[a] - degree[b]);
      for (const w of neighbours) {
        if (!visited[w]) {
          visited[w] = 1;
          component.push(w);
        }
      }
    }
    order.push(...component);
  }
  return order.reverse();
};
