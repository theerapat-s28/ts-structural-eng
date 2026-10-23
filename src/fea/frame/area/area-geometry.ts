import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/frame.constant";

import type { AreaDistribution } from "../types/model.type";

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross2 = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const dot2 = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

/**
 * The plane of a valid null area. `u` runs along edge 0 and `v = normal × u`, so the corners
 * in (u, v) coordinates go counter-clockwise.
 */
export interface AreaPlane {
  points: Vec3[]; // corners in global coordinates, mm
  normal: Vec3; // unit local 3, right-hand rule around the corners
  u: Vec3;
  v: Vec3;
  corners: Vec2[]; // corners in (u, v), mm, from the first corner
  area: number; // mm²
  size: number; // longest edge, mm
}

/** What makes a set of corners unusable as a null area. */
export type AreaGeometryProblem =
  | "nodeCount"
  | "repeatedNode"
  | "degenerate"
  | "nonPlanar"
  | "nonConvex";

/** The 2D edge vector i → i + 1 of a polygon. */
export const edgeVector = (corners: Vec2[], i: number): Vec2 => {
  const a = corners[i];
  const b = corners[(i + 1) % corners.length];
  return [b[0] - a[0], b[1] - a[1]];
};

/**
 * Builds the plane of an area from its corners, or names the problem: not 3 or 4 corners,
 * two consecutive corners coinciding, no area, corners off one plane, or a polygon that is
 * not strictly convex (a reflex corner, three corners in line or a crossed quad).
 *
 * @param points - Corner coordinates in mm, in order around the area
 */
export const areaPlane = (points: Vec3[]): AreaPlane | { problem: AreaGeometryProblem } => {
  const n = points.length;
  if (n !== 3 && n !== 4) return { problem: "nodeCount" };
  const edges = points.map((p, i) => sub(points[(i + 1) % n], p));
  const size = Math.max(...edges.map(norm));
  const tolerance = AREA_GEOMETRY_TOLERANCE * size;
  if (!(size > 0) || edges.some((e) => norm(e) <= tolerance)) return { problem: "repeatedNode" };

  // Newell's method: the vector area, exact for a planar polygon
  const vectorArea = points.reduce<Vec3>(
    (sum, p, i) => {
      const c = cross(p, points[(i + 1) % n]);
      return [sum[0] + c[0] / 2, sum[1] + c[1] / 2, sum[2] + c[2] / 2];
    },
    [0, 0, 0],
  );
  const area = norm(vectorArea);
  if (!(area > tolerance * size)) return { problem: "degenerate" };
  const normal = scale(vectorArea, 1 / area);

  const centroid = scale(
    points.reduce<Vec3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]),
    1 / n,
  );
  if (points.some((p) => Math.abs(dot(sub(p, centroid), normal)) > tolerance)) {
    return { problem: "nonPlanar" };
  }

  const along = sub(edges[0], scale(normal, dot(edges[0], normal)));
  const u = scale(along, 1 / norm(along));
  const v = cross(normal, u);
  const corners = points.map((p): Vec2 => [dot(sub(p, points[0]), u), dot(sub(p, points[0]), v)]);

  // Strictly convex: every turn is to the left by more than the tolerance (sine of the turn)
  for (let i = 0; i < n; i++) {
    const a = edgeVector(corners, i);
    const b = edgeVector(corners, (i + 1) % n);
    if (!(cross2(a, b) > AREA_GEOMETRY_TOLERANCE * Math.hypot(...a) * Math.hypot(...b))) {
      return { problem: "nonConvex" };
    }
  }

  return { points, normal, u, v, corners, area, size };
};

/** Whether edges i and j are parallel (either way round) within the tolerance. */
export const edgesParallel = (plane: AreaPlane, i: number, j: number): boolean => {
  const a = edgeVector(plane.corners, i);
  const b = edgeVector(plane.corners, j);
  return Math.abs(cross2(a, b)) <= AREA_GEOMETRY_TOLERANCE * Math.hypot(...a) * Math.hypot(...b);
};

/** Whether a 4-corner area is a rectangle (every corner square within the tolerance). */
export const isRectangle = (plane: AreaPlane): boolean =>
  plane.corners.length === 4 &&
  plane.corners.every((_, i) => {
    const a = edgeVector(plane.corners, i);
    const b = edgeVector(plane.corners, (i + 1) % 4);
    return Math.abs(dot2(a, b)) <= AREA_GEOMETRY_TOLERANCE * Math.hypot(...a) * Math.hypot(...b);
  });

/** Unit vector of edge i in global coordinates. */
export const edgeDirection = (plane: AreaPlane, i: number): Vec3 => {
  const n = plane.points.length;
  const d = sub(plane.points[(i + 1) % n], plane.points[i]);
  return scale(d, 1 / norm(d));
};

/** The edges that receive load, and for one-way the span direction in (u, v). */
export interface AreaSupports {
  loadedEdges: number[];
  span?: Vec2; // one-way only: unit strip direction
}

/**
 * Resolves which edges of an area receive load from its distribution and `supportEdges`.
 * Two-way loads every edge and takes no `supportEdges`. One-way spans parallel to the edges
 * not listed, which must exist and all be parallel; cantilever takes exactly one edge.
 *
 * @returns The loaded edges, or `null` if `supportEdges` does not fit the distribution
 */
export const resolveAreaSupports = (
  plane: AreaPlane,
  distribution: AreaDistribution,
  supportEdges: unknown,
): AreaSupports | null => {
  const n = plane.corners.length;
  if (distribution === "twoWay") {
    return supportEdges === undefined ? { loadedEdges: [...Array(n).keys()] } : null;
  }
  if (
    !Array.isArray(supportEdges) ||
    supportEdges.length === 0 ||
    supportEdges.some((e) => !Number.isInteger(e) || e < 0 || e >= n) ||
    new Set(supportEdges).size !== supportEdges.length
  ) {
    return null;
  }
  const loadedEdges = [...(supportEdges as number[])].sort((a, b) => a - b);
  if (distribution === "cantilever") return loadedEdges.length === 1 ? { loadedEdges } : null;

  const free = [...Array(n).keys()].filter((e) => !loadedEdges.includes(e));
  if (free.length === 0 || free.some((e) => !edgesParallel(plane, free[0], e))) return null;
  const d = edgeVector(plane.corners, free[0]);
  const length = Math.hypot(...d);
  return { loadedEdges, span: [d[0] / length, d[1] / length] };
};

/**
 * Clips a convex polygon to the half-plane `a · p ≤ c` (Sutherland–Hodgman, one plane).
 *
 * @param polygon - Corners in order, mm
 * @returns The clipped polygon, in the same order; empty if nothing remains
 */
export const clipPolygon = (polygon: Vec2[], a: Vec2, c: number): Vec2[] => {
  const out: Vec2[] = [];
  const side = (p: Vec2) => dot2(a, p) - c;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
};
