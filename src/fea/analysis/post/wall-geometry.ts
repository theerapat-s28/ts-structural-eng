import { VERTICAL_MEMBER_TOLERANCE, WALL_CUT_TOLERANCE } from "@app-core/constants/fea.constant";
import type { FeaId } from "@app-fea/shared/types/model.type";

import type { PierCutFace, SpandrelCutFace } from "../types/results.type";

/** A point or vector in global axes: X, Y, Z in mm. */
export type Vec3 = [number, number, number];

/** Pier or spandrel axes 1, 2, 3 (rows) in global components. */
export type WallAxes = [Vec3, Vec3, Vec3];

export type WallKind = "pier" | "spandrel";

export type WallCutFace = PierCutFace | SpandrelCutFace;

/** The geometry of a pier or spandrel: its areas' shell elements and its members' pieces. */
export interface WallShape {
  areas: { areaId: FeaId; elements: Vec3[][] }[];
  members: { memberId: FeaId; pieces: [Vec3, Vec3][] }[];
}

/** One cut of a pier or spandrel: its coordinate along axis 1 and the side it is taken from. */
export interface WallCutPosition {
  s: number; // mm, e1 · point
  face: WallCutFace;
  /** Index into the user's `cuts` for an extra cut. */
  cut?: number;
}

export const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
export const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
export const cross = (p: Vec3, q: Vec3): Vec3 => [
  p[1] * q[2] - p[2] * q[1],
  p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0],
];
const norm = (p: Vec3) => Math.hypot(p[0], p[1], p[2]);
const unit = (p: Vec3): Vec3 => {
  const n = norm(p);
  return n > 0 ? [p[0] / n, p[1] / n, p[2] / n] : [0, 0, 0];
};

/** Unit normal of a polygon by Newell's method (zero for a degenerate polygon). */
export const polygonNormal = (points: readonly Vec3[]): Vec3 => {
  const n: Vec3 = [0, 0, 0];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  return unit(n);
};

/** The horizontal direction in a vertical plane of normal `n`, toward +X (+Y if along Y). */
export const horizontalInPlane = (n: Vec3): Vec3 => {
  const d = unit([-n[1], n[0], 0]);
  const flip = Math.abs(d[0]) > VERTICAL_MEMBER_TOLERANCE ? d[0] < 0 : d[1] < 0;
  return flip ? [-d[0], -d[1], -d[2]] : d;
};

/**
 * Axes of a pier or spandrel (see `WallPier`, `WallSpandrel`).
 *
 * - Pier: 1 = +Z; 2 = global X rotated by `angle` about +Z, else the horizontal direction of
 *   the area with the largest horizontal extent (the first wins a tie), else global X; 3 = 1 × 2.
 * - Spandrel: 1 = horizontal in the plane of its first area, toward +X (+Y for a plane parallel
 *   to Y), reversed by `reverse`; 2 = +Z; 3 = 1 × 2.
 */
export const wallAxes = (
  kind: WallKind,
  shape: WallShape,
  options: { angle?: number; reverse?: boolean },
): WallAxes => {
  const up: Vec3 = [0, 0, 1];
  if (kind === "pier") {
    let e2: Vec3 = [1, 0, 0];
    if (options.angle !== undefined) {
      e2 = [Math.cos(options.angle), Math.sin(options.angle), 0];
    } else {
      let best = 0;
      for (const area of shape.areas) {
        if (area.elements.length === 0) continue;
        const d = horizontalInPlane(polygonNormal(area.elements[0]));
        const s = area.elements.flat().map((p) => dot(p, d));
        const extent = Math.max(...s) - Math.min(...s);
        if (extent > best) {
          best = extent;
          e2 = d;
        }
      }
    }
    return [up, e2, cross(up, e2)];
  }
  const first = shape.areas.find((a) => a.elements.length > 0);
  let e1 = first ? horizontalInPlane(polygonNormal(first.elements[0])) : ([1, 0, 0] as Vec3);
  if (options.reverse) e1 = [-e1[0], -e1[1], -e1[2]];
  return [e1, up, cross(e1, up)];
};

/** Smallest and largest coordinate along `e1` of every element corner and member end. */
export const wallExtent = (shape: WallShape, e1: Vec3): { min: number; max: number } => {
  const s = [
    ...shape.areas.flatMap((a) => a.elements.flat()),
    ...shape.members.flatMap((m) => m.pieces.flat()),
  ].map((p) => dot(p, e1));
  return { min: Math.min(...s), max: Math.max(...s) };
};

/** The distance within which a point counts as on a cut (see `WALL_CUT_TOLERANCE`). */
export const wallTolerance = (extent: { min: number; max: number }) =>
  WALL_CUT_TOLERANCE * Math.max(extent.max - extent.min, 1);

const range = (points: readonly Vec3[], e1: Vec3) => {
  const s = points.map((p) => dot(p, e1));
  return { min: Math.min(...s), max: Math.max(...s) };
};

/** Whether anything of the shape lies on the negative / positive side touching the cut at s. */
const touching = (shape: WallShape, e1: Vec3, s: number, tol: number) => {
  let negative = false;
  let positive = false;
  const check = (points: readonly Vec3[]) => {
    const r = range(points, e1);
    if (r.max - r.min <= tol) return; // lies in the cut plane
    if (Math.abs(r.max - s) <= tol) negative = true;
    if (Math.abs(r.min - s) <= tol) positive = true;
  };
  shape.areas.forEach((a) => a.elements.forEach(check));
  shape.members.forEach((m) => m.pieces.forEach(check));
  return { negative, positive };
};

/**
 * The cuts of a pier or spandrel, in order along axis 1.
 *
 * - Pier: at each elevation where one of its areas or members starts or ends, a `"top"` cut
 *   when something of the pier ends there from below and a `"bottom"` cut when something starts
 *   there going up (the top first); then each extra cut not at such an elevation, as `"cut"`.
 * - Spandrel: `"left"` at its smallest coordinate, `"right"` at its largest, and each extra cut
 *   strictly between them as `"cut"`.
 *
 * @param extra - The extra cuts as coordinates along axis 1 (mm)
 */
export const wallCutPositions = (
  kind: WallKind,
  shape: WallShape,
  e1: Vec3,
  extra: readonly number[] = [],
): WallCutPosition[] => {
  const extent = wallExtent(shape, e1);
  const tol = wallTolerance(extent);
  const auto: number[] = [];
  const addAuto = (s: number) => {
    if (!auto.some((a) => Math.abs(a - s) <= tol)) auto.push(s);
  };
  if (kind === "pier") {
    for (const area of shape.areas) {
      if (area.elements.length === 0) continue;
      const r = range(area.elements.flat(), e1);
      addAuto(r.min);
      addAuto(r.max);
    }
    for (const member of shape.members) {
      const r = range(member.pieces.flat(), e1);
      addAuto(r.min);
      addAuto(r.max);
    }
  } else {
    addAuto(extent.min);
    addAuto(extent.max);
  }
  auto.sort((a, b) => a - b);

  const cuts: WallCutPosition[] = [];
  for (const s of auto) {
    if (kind === "spandrel") {
      cuts.push({ s, face: s === extent.min ? "left" : "right" });
      continue;
    }
    const side = touching(shape, e1, s, tol);
    if (side.negative) cuts.push({ s, face: "top" });
    if (side.positive) cuts.push({ s, face: "bottom" });
  }
  extra.forEach((s, cut) => {
    if (auto.some((a) => Math.abs(a - s) <= tol)) return;
    if (cuts.some((c) => c.face === "cut" && Math.abs(c.s - s) <= tol)) return;
    cuts.push({ s, face: "cut", cut });
  });
  // stable: a "top" stays before the "bottom" at the same level
  return cuts.sort((a, b) => a.s - b.s);
};

/** Whether a face takes the elements on the negative side of its cut (below, or to the left). */
export const fromNegativeSide = (face: WallCutFace) =>
  face === "top" || face === "right" || face === "cut";

/** Areas with a shell element on both sides of the cut at s (no mesh line there). */
export const areasAcrossCut = (shape: WallShape, e1: Vec3, s: number, tol: number): FeaId[] =>
  shape.areas
    .filter((a) =>
      a.elements.some((el) => {
        const r = range(el, e1);
        return r.min < s - tol && r.max > s + tol;
      }),
    )
    .map((a) => a.areaId);

/** Whether some element or member of the shape reaches the cut at s. */
export const reachesCut = (shape: WallShape, e1: Vec3, s: number, tol: number): boolean =>
  [...shape.areas.flatMap((a) => a.elements), ...shape.members.flatMap((m) => m.pieces)].some(
    (points) => {
      const r = range(points, e1);
      return r.min <= s + tol && r.max >= s - tol;
    },
  );
