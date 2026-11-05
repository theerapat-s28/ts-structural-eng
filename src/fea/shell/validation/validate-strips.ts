import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/frame.constant";
import { FeaErrors, type FeaErrorDetails, type FeaModelIssue } from "@app-core/errors/fea.error";
import { isFiniteNumber, modelIssue } from "@app-fea/shared/validation/issues";

import type { ShellStrip } from "../types/model.type";

type V3 = [number, number, number];

/**
 * Checks the model's strips: unique ids, finite points, widths, normal and spacing, and the
 * geometry (at least 2 points in one plane normal to `normal`, no zero-length segment, no
 * segment turning straight back, widths not negative and not both 0).
 *
 * @param strips - The model's strips
 * @returns Every problem found (codes 303, 314 and 330), in model order, with `stripId`
 */
export const validateStrips = (strips: ShellStrip[]): FeaModelIssue[] => {
  const issues: FeaModelIssue[] = [];
  const add = (std: { code: number; message: string }, details: FeaErrorDetails) =>
    issues.push(modelIssue(std, details));

  const ids = strips.map((s) => s.id);
  for (const stripId of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
    add(FeaErrors.DUPLICATE_ID, { stripId, field: "id" });
  }

  for (const strip of strips) {
    const at = { stripId: strip.id };

    let pointsOk = true;
    const points: unknown = strip.points;
    if (!Array.isArray(points) || points.length < 2) {
      add(FeaErrors.INVALID_STRIP_GEOMETRY, { ...at, field: "points" });
      pointsOk = false;
    } else {
      points.forEach((p: unknown, i) => {
        for (const key of ["x", "y", "z"] as const) {
          const value: unknown = (p as Record<string, unknown> | null)?.[key];
          if (!isFiniteNumber(value)) {
            add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: `points[${i}].${key}` });
            pointsOk = false;
          }
        }
      });
    }

    let normal: V3 | undefined = [0, 0, 1];
    const given: unknown = strip.normal;
    if (given !== undefined) {
      if (!Array.isArray(given) || given.length !== 3 || !given.every(isFiniteNumber)) {
        add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: "normal" });
        normal = undefined;
      } else if (Math.hypot(given[0], given[1], given[2]) === 0) {
        add(FeaErrors.INVALID_STRIP_GEOMETRY, { ...at, field: "normal" });
        normal = undefined;
      } else {
        normal = given as V3;
      }
    }

    let widthsOk = true;
    for (const field of ["widthLeft", "widthRight"] as const) {
      const value: unknown = strip[field];
      if (!isFiniteNumber(value)) {
        add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field });
        widthsOk = false;
      } else if (value < 0) {
        add(FeaErrors.INVALID_STRIP_GEOMETRY, { ...at, field });
        widthsOk = false;
      }
    }
    if (widthsOk && strip.widthLeft + strip.widthRight === 0) {
      add(FeaErrors.INVALID_STRIP_GEOMETRY, { ...at, field: "widthLeft" });
    }

    const spacing: unknown = strip.maxSpacing;
    if (spacing !== undefined && !(isFiniteNumber(spacing) && spacing > 0)) {
      add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: "maxSpacing" });
    }

    if (!pointsOk || !normal) continue;
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    const n = normal.map((c) => c / length) as V3;
    const xyz = strip.points.map((p): V3 => [p.x, p.y, p.z]);
    const along = xyz.slice(1).map((q, i) => {
      const d = [0, 1, 2].map((k) => q[k] - xyz[i][k]) as V3;
      const out = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
      return [d[0] - out * n[0], d[1] - out * n[1], d[2] - out * n[2]] as V3;
    });
    const lengths = along.map((d) => Math.hypot(d[0], d[1], d[2]));
    const total = lengths.reduce((sum, l) => sum + l, 0);
    const tolerance = AREA_GEOMETRY_TOLERANCE * total;
    const offPlane = xyz.some(
      (p) =>
        Math.abs(
          (p[0] - xyz[0][0]) * n[0] + (p[1] - xyz[0][1]) * n[1] + (p[2] - xyz[0][2]) * n[2],
        ) > tolerance,
    );
    const zeroSegment = lengths.some((l) => !(l > tolerance));
    const foldsBack =
      !zeroSegment &&
      along.slice(1).some((d, i) => {
        const e = along[i];
        const cos = (d[0] * e[0] + d[1] * e[1] + d[2] * e[2]) / (lengths[i] * lengths[i + 1]);
        return cos <= -1 + AREA_GEOMETRY_TOLERANCE;
      });
    if (offPlane || zeroSegment || foldsBack) {
      add(FeaErrors.INVALID_STRIP_GEOMETRY, { ...at, field: "points" });
    }
  }
  return issues;
};
