import { VERTICAL_MEMBER_TOLERANCE } from "@app-core/constants/frame.constant";
import { FrameAnalysisError, FrameErrors } from "@app-core/errors/frame-analysis.error";
import { zeros, type Matrix } from "@app-utils/matrix";

type Vec3 = [number, number, number];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

/**
 * ETABS-style local axes of a member as the rows of a 3×3 direction-cosine matrix.
 *
 * Local 1 runs from the start to the end node. For a non-vertical member local 3 is
 * horizontal (`1 × Z`) and local 2 lies in the vertical plane pointing up; for a vertical
 * member local 2 is global +X and local 3 is `1 × 2`. `angle` then rotates local 2 and 3
 * about local 1 by the right-hand rule.
 *
 * @param start - Start node coordinates in mm
 * @param end - End node coordinates in mm
 * @param angle - Member angle in rad (default 0)
 * @returns `{ length, lambda }` with `lambda` rows = local 1, 2, 3 in global components
 * @throws {FrameAnalysisError} 301 if the nodes coincide
 */
export const memberAxes = (
  start: [number, number, number],
  end: [number, number, number],
  angle = 0,
): { length: number; lambda: Matrix } => {
  const d: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const length = norm(d);
  if (!(length > 0)) throw new FrameAnalysisError(FrameErrors.ZERO_LENGTH_MEMBER);

  const e1 = scale(d, 1 / length);
  let e2: Vec3;
  let e3: Vec3;
  if (Math.hypot(e1[0], e1[1]) < VERTICAL_MEMBER_TOLERANCE) {
    e2 = [1, 0, 0];
    e3 = cross(e1, e2);
  } else {
    const c = cross(e1, [0, 0, 1]);
    e3 = scale(c, 1 / norm(c));
    e2 = cross(e3, e1);
  }

  if (angle !== 0) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const r2: Vec3 = [
      cos * e2[0] + sin * e3[0],
      cos * e2[1] + sin * e3[1],
      cos * e2[2] + sin * e3[2],
    ];
    const r3: Vec3 = [
      -sin * e2[0] + cos * e3[0],
      -sin * e2[1] + cos * e3[1],
      -sin * e2[2] + cos * e3[2],
    ];
    e2 = r2;
    e3 = r3;
  }

  return { length, lambda: [e1, e2, e3] };
};

/** Builds the 12×12 transformation `T` (global → local) from the 3×3 direction cosines. */
export const transformationMatrix = (lambda: Matrix): Matrix => {
  const T = zeros(12, 12);
  for (let block = 0; block < 4; block++) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) T[3 * block + i][3 * block + j] = lambda[i][j];
    }
  }
  return T;
};
