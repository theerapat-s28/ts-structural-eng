import { WALL_VERTICAL_TOLERANCE } from "@app-core/constants/fea.constant";
import { FeaErrors, type FeaErrorDetails, type FeaModelIssue } from "@app-core/errors/fea.error";
import type { Member } from "@app-fea/frame/types/model.type";
import type { FeaId, FeaNode } from "@app-fea/shared/types/model.type";
import { isFiniteNumber, modelIssue } from "@app-fea/shared/validation/issues";
import type { ShellElement } from "@app-fea/shell/mesh/mesh-shells";
import type { ShellArea } from "@app-fea/shell/types/model.type";

import {
  areasAcrossCut,
  cross,
  dot,
  polygonNormal,
  reachesCut,
  sub,
  wallAxes,
  wallCutPositions,
  wallExtent,
  wallTolerance,
  type Vec3,
  type WallKind,
  type WallShape,
} from "../post/wall-geometry";
import type { WallPier, WallSpandrel } from "../types/model.type";

/** What the pier and spandrel checks need from the rest of the model. */
export interface WallContext {
  shells: ShellArea[];
  members: Member[];
  nodeById: Map<FeaId, FeaNode>;
  /** Length of each member whose geometry is valid (from `validateMembers`). */
  memberLength: Map<FeaId, number>;
  /**
   * The meshed shell elements and every node (generated ones included), when all shells are
   * valid and mesh; without it the geometry is not checked.
   */
  mesh?: { nodes: FeaNode[]; elements: ShellElement[] };
}

const point = (node: FeaNode): Vec3 => [node.x, node.y, node.z];

/**
 * Checks the model's piers and spandrels: unique ids; areas and members that exist, are listed
 * once and are in no other pier (or spandrel); finite `cuts`, `angle` and boolean `reverse`; and,
 * once the shells mesh, the geometry: vertical pier areas and non-horizontal pier members, a
 * spandrel's areas in one vertical plane and its members not normal to its axis 1, extra cuts
 * reaching the group, and every cut on the mesh lines of the areas it meets.
 *
 * @returns Every problem found (codes 303, 314 and 331), in model order, with `pierId` or
 *   `spandrelId`
 */
export const validateWalls = (
  model: { piers?: unknown; spandrels?: unknown },
  context: WallContext,
): FeaModelIssue[] => {
  const issues: FeaModelIssue[] = [];
  const add = (std: { code: number; message: string }, details: FeaErrorDetails) =>
    issues.push(modelIssue(std, details));

  const shellById = new Map(context.shells.map((sh) => [sh.id, sh]));
  const memberById = new Map(context.members.map((m) => [m.id, m]));
  const nodeById = context.mesh
    ? new Map(context.mesh.nodes.map((n) => [n.id, n]))
    : context.nodeById;
  const elementsByArea = new Map<FeaId, Vec3[][]>();
  for (const element of context.mesh?.elements ?? []) {
    const corners = element.nodeIds.map((id) => point(nodeById.get(id) as FeaNode));
    const list = elementsByArea.get(element.areaId);
    if (list) list.push(corners);
    else elementsByArea.set(element.areaId, [corners]);
  }

  const check = (kind: WallKind, list: unknown) => {
    if (list === undefined) return;
    const field = kind === "pier" ? "piers" : "spandrels";
    if (!Array.isArray(list)) {
      add(FeaErrors.INVALID_INPUT_VALUE, { field });
      return;
    }
    const groups = list as (WallPier | WallSpandrel)[];
    const idKey = kind === "pier" ? "pierId" : "spandrelId";

    const ids = groups.map((g) => g?.id);
    for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
      add(FeaErrors.DUPLICATE_ID, { [idKey]: id, field: "id" });
    }

    const owner = new Map<string, FeaId>(); // "area:id" / "member:id" → group id
    for (const group of groups) {
      const at = { [idKey]: group?.id };
      let ok = true;
      const listField = (name: "areaIds" | "memberIds"): FeaId[] => {
        const value: unknown = (group as unknown as Record<string, unknown> | null)?.[name];
        if (value === undefined) return [];
        if (!Array.isArray(value)) {
          add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: name });
          ok = false;
          return [];
        }
        return value as FeaId[];
      };
      const areaIds = listField("areaIds");
      const memberIds = listField("memberIds");
      if (!ok) continue;
      if (areaIds.length === 0 && (kind === "spandrel" || memberIds.length === 0)) {
        add(FeaErrors.INVALID_PIER_GEOMETRY, { ...at, field: "areaIds" });
        continue;
      }

      const refs = [
        ...areaIds.map((id) => ({ id, type: "area" as const })),
        ...memberIds.map((id) => ({ id, type: "member" as const })),
      ];
      for (const [i, { id, type }] of refs.entries()) {
        const where = { ...at, ...(type === "area" ? { areaId: id } : { memberId: id }) };
        const listName = type === "area" ? "areaIds" : "memberIds";
        const exists = type === "area" ? shellById.has(id) : memberById.has(id);
        if (!exists) {
          add(FeaErrors.INVALID_PIER_GEOMETRY, { ...where, field: listName });
          ok = false;
          continue;
        }
        const key = `${type}:${typeof id}:${String(id)}`;
        const twice = refs.slice(0, i).some((r) => r.type === type && r.id === id);
        if (twice || owner.has(key)) {
          add(FeaErrors.INVALID_PIER_GEOMETRY, { ...where, field: listName });
          ok = false;
          continue;
        }
        owner.set(key, group.id);
      }

      const cutsValue: unknown = group.cuts;
      let cuts: number[] = [];
      if (cutsValue !== undefined) {
        if (!Array.isArray(cutsValue)) {
          add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: "cuts" });
          ok = false;
        } else {
          cutsValue.forEach((c: unknown, i) => {
            if (!isFiniteNumber(c)) {
              add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: `cuts[${i}]` });
              ok = false;
            }
          });
          cuts = cutsValue as number[];
        }
      }
      const angle: unknown = (group as WallPier).angle;
      if (kind === "pier" && angle !== undefined && !isFiniteNumber(angle)) {
        add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: "angle" });
        ok = false;
      }
      const reverse: unknown = (group as WallSpandrel).reverse;
      if (kind === "spandrel" && reverse !== undefined && typeof reverse !== "boolean") {
        add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: "reverse" });
        ok = false;
      }

      // ---- Geometry, on the meshed model ----------------------------------------------
      if (!ok || !context.mesh) continue;
      if (memberIds.some((id) => !context.memberLength.has(id))) continue; // reported on it
      const shape: WallShape = {
        areas: areaIds.map((areaId) => ({ areaId, elements: elementsByArea.get(areaId) ?? [] })),
        members: memberIds.map((memberId) => {
          const m = memberById.get(memberId) as Member;
          return {
            memberId,
            pieces: [
              [
                point(nodeById.get(m.startNodeId) as FeaNode),
                point(nodeById.get(m.endNodeId) as FeaNode),
              ],
            ],
          };
        }),
      };
      const before = issues.length;
      const normals = areaIds.map((id) => {
        const shell = shellById.get(id) as ShellArea;
        return polygonNormal(shell.nodeIds.map((n) => point(nodeById.get(n) as FeaNode)));
      });
      if (kind === "pier") {
        normals.forEach((n, i) => {
          if (Math.abs(n[2]) > WALL_VERTICAL_TOLERANCE) {
            add(FeaErrors.INVALID_PIER_GEOMETRY, { ...at, areaId: areaIds[i], field: "areaIds" });
          }
        });
        for (const { memberId, pieces } of shape.members) {
          const d = sub(pieces[0][1], pieces[0][0]);
          const L = context.memberLength.get(memberId) as number;
          if (Math.abs(d[2]) <= WALL_VERTICAL_TOLERANCE * L) {
            add(FeaErrors.INVALID_PIER_GEOMETRY, { ...at, memberId, field: "memberIds" });
          }
        }
      } else {
        const n0 = normals[0];
        const origin = shape.areas[0].elements[0]?.[0];
        const corners = shape.areas.flatMap((a) => a.elements.flat());
        const extent = wallExtent(shape, [1, 0, 0]);
        const size = Math.max(
          extent.max - extent.min,
          ...([1, 2] as const).map((k) => {
            const s = corners.map((p) => p[k]);
            return Math.max(...s) - Math.min(...s);
          }),
          1,
        );
        normals.forEach((n, i) => {
          const parallel = Math.hypot(...cross(n, n0)) <= WALL_VERTICAL_TOLERANCE;
          const inPlane = shape.areas[i].elements
            .flat()
            .every((p) => Math.abs(dot(sub(p, origin), n0)) <= WALL_VERTICAL_TOLERANCE * size);
          if (Math.abs(n[2]) > WALL_VERTICAL_TOLERANCE || !parallel || !inPlane) {
            add(FeaErrors.INVALID_PIER_GEOMETRY, { ...at, areaId: areaIds[i], field: "areaIds" });
          }
        });
      }
      if (issues.length > before) continue;

      const axes = wallAxes(kind, shape, {
        angle: angle as number | undefined,
        reverse: reverse as boolean | undefined,
      });
      const e1 = axes[0];
      if (kind === "spandrel") {
        for (const { memberId, pieces } of shape.members) {
          const d = sub(pieces[0][1], pieces[0][0]);
          const L = context.memberLength.get(memberId) as number;
          if (Math.abs(dot(d, e1)) <= WALL_VERTICAL_TOLERANCE * L) {
            add(FeaErrors.INVALID_PIER_GEOMETRY, { ...at, memberId, field: "memberIds" });
          }
        }
        if (issues.length > before) continue;
      }

      const extent = wallExtent(shape, e1);
      const tol = wallTolerance(extent);
      const offset = kind === "pier" ? 0 : extent.min;
      const extra = cuts.map((c) => c + offset);
      extra.forEach((s, i) => {
        if (!reachesCut(shape, e1, s, tol)) {
          add(FeaErrors.INVALID_PIER_GEOMETRY, { ...at, field: `cuts[${i}]`, position: cuts[i] });
        }
      });
      if (issues.length > before) continue;

      const positions = wallCutPositions(kind, shape, e1, extra);
      for (const [i, cut] of positions.entries()) {
        if (i > 0 && positions[i - 1].s === cut.s) continue; // a level's "top" and "bottom"
        for (const areaId of areasAcrossCut(shape, e1, cut.s, tol)) {
          const position = cut.cut !== undefined ? cuts[cut.cut] : cut.s - offset;
          add(FeaErrors.INVALID_PIER_GEOMETRY, {
            ...at,
            areaId,
            field: cut.cut !== undefined ? `cuts[${cut.cut}]` : "areaIds",
            position: Math.round(position * 1e3) / 1e3,
          });
        }
      }
    }
  };

  check("pier", model.piers);
  check("spandrel", model.spandrels);
  return issues;
};
