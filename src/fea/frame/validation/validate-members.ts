import {
  FrameErrors,
  type FrameErrorDetails,
  type FrameModelIssue,
} from "@app-core/errors/frame-analysis.error";
import type { FrameId, FrameNode } from "@app-fea/shared/types/model.type";
import { frameIssue, isFiniteNumber } from "@app-fea/shared/validation/issues";

import { beam3dLocalStiffnessRightHanded } from "../elements/beam-3d-stiffness";
import { memberEndReleases, RELEASE_KEYS } from "../elements/end-releases";
import { condenseMember } from "../elements/static-condensation";
import type { Member, MemberLoad } from "../types/model.type";

const SECTION_KEYS = ["E", "G", "A", "I22", "I33", "J"] as const;
const DIRECTIONS = new Set(["1", "2", "3", "X", "Y", "Z"]);
const GLOBAL_DIRECTIONS = new Set(["X", "Y", "Z"]);

/**
 * Checks each member on its own: its end nodes, section, `angle` and release values, a
 * non-zero length, and end releases that leave it stable. Ends at nodes with invalid
 * coordinates are not checked further; those are reported on the node.
 *
 * @param members - The model's members
 * @param nodeById - Model nodes by id
 * @param validNode - Ids of the nodes whose coordinates are valid
 * @returns `issues` (codes 301, 302, 305, 307 and 314), in model order, with `memberId`, and the
 *   length (mm) of every member whose geometry is valid
 */
export const validateMembers = (
  members: Member[],
  nodeById: Map<FrameId, FrameNode>,
  validNode: Set<FrameId>,
): { issues: FrameModelIssue[]; memberLength: Map<FrameId, number> } => {
  const issues: FrameModelIssue[] = [];
  const add = (std: { code: number; message: string }, details: FrameErrorDetails = {}) =>
    issues.push(frameIssue(std, details));
  const memberLength = new Map<FrameId, number>(); // only for members whose geometry is valid
  for (const member of members) {
    const at = { memberId: member.id };
    let geometryOk = true;
    for (const field of ["startNodeId", "endNodeId"] as const) {
      if (!nodeById.has(member[field])) {
        add(FrameErrors.UNKNOWN_NODE_REFERENCE, { ...at, field });
        geometryOk = false;
      } else if (!validNode.has(member[field])) {
        geometryOk = false; // reported on the node
      }
    }

    const section = member.section ?? ({} as typeof member.section);
    let sectionOk = true;
    for (const field of SECTION_KEYS) {
      const v = section[field];
      if (!isFiniteNumber(v) || v <= 0) {
        add(FrameErrors.INVALID_SECTION_PROPERTIES, { ...at, field });
        sectionOk = false;
      }
    }
    if (
      section.unitWeight !== undefined &&
      (!isFiniteNumber(section.unitWeight) || section.unitWeight < 0)
    ) {
      add(FrameErrors.INVALID_SECTION_PROPERTIES, { ...at, field: "unitWeight" });
    }

    if (member.angle !== undefined && !isFiniteNumber(member.angle)) {
      add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "angle" });
    }

    // each release value: true/false, or a spring stiffness ≥ 0 (0 = full release)
    let releasesOk = true;
    for (const end of ["start", "end"] as const) {
      const release = member.releases?.[end];
      if (release === undefined) continue;
      for (const key of RELEASE_KEYS) {
        const v: unknown = release[key];
        if (v === undefined || typeof v === "boolean" || (isFiniteNumber(v) && v >= 0)) continue;
        add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: `releases.${end}.${key}` });
        releasesOk = false;
      }
    }

    if (!geometryOk) continue;
    const a = nodeById.get(member.startNodeId)!;
    const b = nodeById.get(member.endNodeId)!;
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (!(L > 0)) {
      add(FrameErrors.ZERO_LENGTH_MEMBER, at);
      continue;
    }
    memberLength.set(member.id, L);

    const releases = releasesOk ? memberEndReleases(member.releases) : [];
    if (sectionOk && releases.length > 0) {
      const { E, G, A, I22, I33, J } = section;
      try {
        condenseMember(beam3dLocalStiffnessRightHanded(E, G, A, I22, I33, J, L), releases);
      } catch {
        add(FrameErrors.INVALID_RELEASE, at);
      }
    }
  }

  return { issues, memberLength };
};

/**
 * Checks member loads: their load case and member, `type`, direction and `projected`, finite
 * intensities and positions, and an extent that lies within the member.
 *
 * @param loads - The model's member loads
 * @param members - The model's members
 * @param memberLength - Length of each member whose geometry is valid (from `validateMembers`)
 * @param caseIds - Ids of the model's load cases
 * @returns Every problem found (codes 302, 308, 309 and 314), in model order, with `memberId`
 *   and `loadCaseId`
 */
export const validateMemberLoads = (
  loads: MemberLoad[],
  members: Member[],
  memberLength: Map<FrameId, number>,
  caseIds: Set<string>,
): FrameModelIssue[] => {
  const issues: FrameModelIssue[] = [];
  const add = (std: { code: number; message: string }, details: FrameErrorDetails = {}) =>
    issues.push(frameIssue(std, details));
  for (const load of loads) {
    const at = { loadCaseId: load.loadCase, memberId: load.memberId };
    if (!caseIds.has(load.loadCase))
      add(FrameErrors.UNKNOWN_LOAD_CASE, { ...at, field: "loadCase" });
    const memberKnown = members.some((m) => m.id === load.memberId);
    if (!memberKnown) add(FrameErrors.UNKNOWN_NODE_REFERENCE, { ...at, field: "memberId" });
    if (load.type !== "torque" && !DIRECTIONS.has(load.direction))
      add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "direction" });
    // a projected length needs a distributed load in a global direction
    const projected = (load as { projected?: unknown }).projected;
    if (
      (projected !== undefined && typeof projected !== "boolean") ||
      (projected === true &&
        ((load.type !== "udl" && load.type !== "trapezoidal") ||
          !GLOBAL_DIRECTIONS.has(load.direction)))
    ) {
      add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "projected" });
    }

    const L = memberLength.get(load.memberId);
    if (load.type === "udl" || load.type === "trapezoidal" || load.type === "torque") {
      const intensities =
        load.type === "udl"
          ? { w: load.w }
          : load.type === "trapezoidal"
            ? { w1: load.w1, w2: load.w2 }
            : { t: load.t };
      const extent = { start: load.start, end: load.end };
      let ok = true;
      for (const [field, v] of [...Object.entries(intensities), ...Object.entries(extent)]) {
        if ((field in intensities || v !== undefined) && !isFiniteNumber(v)) {
          add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field });
          ok = false;
        }
      }
      if (ok && L !== undefined) {
        const start = load.start ?? 0;
        const end = load.end ?? L;
        if (!(start >= 0 && end <= L && start < end)) add(FrameErrors.LOAD_OUTSIDE_MEMBER, at);
      }
    } else if (load.type === "point") {
      let ok = true;
      for (const field of ["P", "a"] as const) {
        if (!isFiniteNumber(load[field])) {
          add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field });
          ok = false;
        }
      }
      if (ok && L !== undefined && !(load.a >= 0 && load.a <= L)) {
        add(FrameErrors.LOAD_OUTSIDE_MEMBER, at);
      }
    } else {
      add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "type" });
    }
  }

  return issues;
};
