import { FeaError, FeaErrors } from "@app-core/errors/fea.error";
import type { FeaId } from "@app-fea/shared/types/model.type";
import type { Matrix } from "@app-utils/matrix";

import { loadIntensity, type LocalMemberLoad } from "../elements/fixed-end-forces";
import type { LoadDirection, MemberLoad } from "../types/model.type";
import type { MemberGroup, SystemMember } from "./system-member";

const GLOBAL_DIRECTIONS: Record<"X" | "Y" | "Z", [number, number, number]> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
};

/** Resolves a member load into local-axis loads in N and mm. */
const toLocalLoads = (load: MemberLoad, lambda: Matrix, L: number): LocalMemberLoad[] => {
  const components = (direction: LoadDirection): { axis: 1 | 2 | 3; factor: number }[] => {
    if (direction === "1" || direction === "2" || direction === "3") {
      return [{ axis: Number(direction) as 1 | 2 | 3, factor: 1 }];
    }
    const v = GLOBAL_DIRECTIONS[direction];
    return ([1, 2, 3] as const)
      .map((axis) => ({
        axis,
        factor:
          lambda[axis - 1][0] * v[0] + lambda[axis - 1][1] * v[1] + lambda[axis - 1][2] * v[2],
      }))
      .filter((c) => Math.abs(c.factor) > 1e-12);
  };

  if (load.type === "torque") {
    // kN·m/m = 10³ N·mm/mm
    return [{ type: "torque", t: load.t * 1e3, start: load.start ?? 0, end: load.end ?? L }];
  }
  // per projected length → per member length: Lproj / L = |local 1 × d| = √(1 − (local 1 · d)²)
  let projection = 1;
  if (load.type !== "point" && load.projected) {
    const v = GLOBAL_DIRECTIONS[load.direction as "X" | "Y" | "Z"];
    const c = lambda[0][0] * v[0] + lambda[0][1] * v[1] + lambda[0][2] * v[2];
    projection = Math.sqrt(Math.max(0, 1 - c * c));
  }
  return components(load.direction).map(({ axis, factor }): LocalMemberLoad => {
    if (load.type === "point") return { type: "point", axis, P: load.P * factor * 1e3, a: load.a };
    const [w1, w2] = load.type === "udl" ? [load.w, load.w] : [load.w1, load.w2];
    return {
      type: "distributed",
      axis,
      w1: w1 * factor * projection, // kN/m = N/mm
      w2: w2 * factor * projection,
      start: load.start ?? 0,
      end: load.end ?? L,
    };
  });
};

/**
 * The part of a member's local loads that falls on one of its pieces, `[offset, offset + L]`,
 * in the piece's own positions. A distributed load or torque is cut at the piece ends; a point
 * load goes to the piece it lies in (at an interior node, to the piece that starts there).
 */
const clipLoads = (
  loads: LocalMemberLoad[],
  offset: number,
  L: number,
  last: boolean,
): LocalMemberLoad[] => {
  const end = offset + L;
  const tolerance = 1e-9 * end;
  const out: LocalMemberLoad[] = [];
  for (const load of loads) {
    if (load.type === "point") {
      const inside = load.a >= offset - tolerance && (load.a < end - tolerance || last);
      if (inside) out.push({ ...load, a: Math.min(L, Math.max(0, load.a - offset)) });
      continue;
    }
    const from = Math.max(load.start, offset);
    const to = Math.min(load.end, end);
    if (to - from <= tolerance) continue;
    if (load.type === "torque") {
      out.push({ ...load, start: from - offset, end: to - offset });
    } else {
      out.push({
        ...load,
        w1: loadIntensity(load, from),
        w2: loadIntensity(load, to),
        start: from - offset,
        end: to - offset,
      });
    }
  }
  return out;
};

/**
 * The local loads (N and mm) on every member piece in one load case: each member load, and the
 * self-weight `selfWeight · unitWeight · A` per unit length along global −Z, resolved in the
 * whole member's local axes, then cut at its pieces.
 *
 * @param groups - Model members and the pieces each is analysed as
 * @param pieces - Every member piece
 * @param memberIndex - Index into `groups` of each member id
 * @param loads - The load case's member loads
 * @param loadCaseId - The load case, which tags the self-weight load
 * @param selfWeight - The load case's self-weight multiplier
 * @returns The local loads of each piece, in the order of `pieces`
 * @throws {FeaError} 313 if self-weight is requested for a member without `unitWeight`
 */
export const memberPieceLoads = (
  groups: MemberGroup[],
  pieces: SystemMember[],
  memberIndex: Map<FeaId, number>,
  loads: MemberLoad[],
  loadCaseId: string,
  selfWeight: number,
): LocalMemberLoad[][] => {
  const loadsByMember: MemberLoad[][] = groups.map(() => []);
  for (const load of loads) {
    loadsByMember[memberIndex.get(load.memberId) as number].push(load);
  }

  // local loads of each model member, then of each piece it is analysed as
  const memberLoads: LocalMemberLoad[][] = pieces.map(() => []);
  groups.forEach((group, g) => {
    const memberLoadsHere = [...loadsByMember[g]];
    if (selfWeight !== 0) {
      const { unitWeight, A } = group.section;
      if (unitWeight === undefined) throw new FeaError(FeaErrors.MISSING_UNIT_WEIGHT);
      // kN/m³ · m² = kN/m
      const w = -selfWeight * unitWeight * A * 1e-6;
      if (w !== 0) {
        memberLoadsHere.push({
          loadCase: loadCaseId,
          type: "udl",
          memberId: group.id,
          direction: "Z",
          w,
        });
      }
    }
    const local = memberLoadsHere.flatMap((load) => toLocalLoads(load, group.lambda, group.length));
    if (group.pieces.length === 1) {
      memberLoads[group.pieces[0]] = local;
      return;
    }
    group.pieces.forEach((p, k) => {
      const piece = pieces[p];
      memberLoads[p] = clipLoads(local, piece.offset, piece.length, k === group.pieces.length - 1);
    });
  });

  return memberLoads;
};

/** A local member load scaled by `factor`, e.g. for a load combination. */
export const scaleMemberLoad = (load: LocalMemberLoad, factor: number): LocalMemberLoad => {
  if (load.type === "distributed") return { ...load, w1: load.w1 * factor, w2: load.w2 * factor };
  if (load.type === "torque") return { ...load, t: load.t * factor };
  return { ...load, P: load.P * factor };
};
