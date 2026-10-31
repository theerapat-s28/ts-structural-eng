import { VERTICAL_MEMBER_TOLERANCE } from "@app-core/constants/frame.constant";
import type { Matrix } from "@app-utils/matrix";

import type { Vec2 } from "./quad-geometry";

/** A point or vector in global axes: X, Y, Z in mm. */
export type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** A four-node shell element's local axes and its corners on the mean plane. */
export interface ShellAxes {
  /** Direction cosines, rows = local 1, 2, 3 in global components. */
  lambda: Matrix;
  /** Centroid of the four corners (mm), the origin of the local coordinates. */
  origin: Vec3;
  /** Corners projected onto the mean plane, as local 1–2 coordinates (mm). */
  corners: Vec2[];
  /**
   * Distance of each corner from the mean plane along local 3 (mm): +h, −h, +h, −h, with
   * h = ¼(x₁ − x₂ + x₃ − x₄)·n. All zero for a flat element.
   */
  offsets: number[];
}

/**
 * Local axes of a four-node shell element, ETABS-style, and its corners on the mean plane.
 *
 * - Local 3 is the unit normal `n ∥ d₁ × d₂` of the diagonals `d₁ = x₃ − x₁`, `d₂ = x₄ − x₂`: the
 *   right-hand rule around the nodes, as for null areas (for four nodes Newell's vector area is
 *   exactly `½ d₁ × d₂`).
 * - Non-horizontal element: local 2 is +Z projected onto the plane (upward on a wall) and
 *   local 1 = 2 × 3 is horizontal.
 * - Horizontal element (the normal's horizontal part below the vertical-member tolerance):
 *   local 1 = +X and local 2 = 3 × 1, so local 2 = +Y when local 3 = +Z.
 * - `angle` then rotates local 1 and 2 about local 3 by the right-hand rule.
 *
 * The mean plane passes through the centroid with normal n; a warped element's corners lie
 * alternately h above and below it.
 *
 * @param points - The four corners in global axes (mm), in order around the element
 * @param angle - Rotation of local 1 and 2 about local 3 in rad (default 0)
 */
export const shellAxes = (points: readonly Vec3[], angle = 0): ShellAxes => {
  const e3 = unit(cross(sub(points[2], points[0]), sub(points[3], points[1])));
  let e1: Vec3;
  let e2: Vec3;
  if (Math.hypot(e3[0], e3[1]) < VERTICAL_MEMBER_TOLERANCE) {
    e1 = [1, 0, 0];
    e2 = cross(e3, e1);
  } else {
    e2 = unit([-e3[2] * e3[0], -e3[2] * e3[1], 1 - e3[2] * e3[2]]); // Z − (Z·n)·n
    e1 = cross(e2, e3);
  }
  if (angle !== 0) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const r1: Vec3 = [c * e1[0] + s * e2[0], c * e1[1] + s * e2[1], c * e1[2] + s * e2[2]];
    const r2: Vec3 = [-s * e1[0] + c * e2[0], -s * e1[1] + c * e2[1], -s * e1[2] + c * e2[2]];
    e1 = r1;
    e2 = r2;
  }

  const origin: Vec3 = [0, 1, 2].map(
    (k) => (points[0][k] + points[1][k] + points[2][k] + points[3][k]) / 4,
  ) as Vec3;
  const relative = points.map((p) => sub(p, origin));
  return {
    lambda: [e1, e2, e3],
    origin,
    corners: relative.map((r): Vec2 => [dot(r, e1), dot(r, e2)]),
    offsets: relative.map((r) => dot(r, e3)),
  };
};
