import {
  FrameAnalysisError,
  FrameErrors,
  type FrameErrorDetails,
  type FrameModelIssue,
} from "@app-core/errors/frame-analysis.error";

import { beam3dLocalStiffnessRightHanded } from "../elements/beam-3d-stiffness";
import { condenseMember } from "../elements/static-condensation";
import { resolveCombinations } from "../solver/combinations";
import type { FrameId, FrameModel, LoadCaseType, MemberEndRelease } from "../types/model.type";

const DOF_KEYS = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
const NODAL_LOAD_KEYS = ["fx", "fy", "fz", "mx", "my", "mz"] as const;
const SECTION_KEYS = ["E", "G", "A", "I22", "I33", "J"] as const;
const RELEASE_KEYS = ["u1", "u2", "u3", "r1", "r2", "r3"] as const;
const DIRECTIONS = new Set(["1", "2", "3", "X", "Y", "Z"]);
const LOAD_CASE_TYPES = new Set<LoadCaseType>([
  "dead",
  "superDead",
  "live",
  "roofLive",
  "snow",
  "wind",
  "seismic",
  "other",
]);

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const describe = (d: FrameErrorDetails): string => {
  const parts: string[] = [];
  if (d.nodeId !== undefined) parts.push(`node "${String(d.nodeId)}"`);
  if (d.memberId !== undefined) parts.push(`member "${String(d.memberId)}"`);
  if (d.loadCaseId !== undefined) parts.push(`load case "${d.loadCaseId}"`);
  if (d.combinationId !== undefined) parts.push(`combination "${d.combinationId}"`);
  if (d.field !== undefined) parts.push(`field "${d.field}"`);
  if (d.dof !== undefined) parts.push(`DOF ${d.dof}`);
  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
};

/** Builds an issue whose message names where the problem is. */
export const frameIssue = (
  std: { code: number; message: string },
  details: FrameErrorDetails = {},
): FrameModelIssue => ({ code: std.code, message: std.message + describe(details), details });

/** Throws the first issue as a `FrameAnalysisError` carrying all of them. */
export const throwIssues = (issues: FrameModelIssue[]): never => {
  const first = issues[0];
  throw new FrameAnalysisError({ code: first.code, message: first.message }, first.details, issues);
};

const releasedIndices = (release: MemberEndRelease | undefined, offset: number): number[] =>
  RELEASE_KEYS.flatMap((key, k) => (release?.[key] ? [offset + k] : []));

/**
 * Checks a frame model without analysing it and returns every problem found, each with the
 * node, member, load case, combination and field it concerns. An empty array means the
 * model can be analysed, apart from an unstable structure (304), which only the solve detects.
 *
 * @param model - The model to check
 * @returns Every problem found (codes 301–303 and 305–314), in model order
 */
export const validateFrameModel = (model: FrameModel): FrameModelIssue[] => {
  const issues: FrameModelIssue[] = [];
  const add = (std: { code: number; message: string }, details: FrameErrorDetails = {}) =>
    issues.push(frameIssue(std, details));

  const nodes = Array.isArray(model.nodes) ? model.nodes : [];
  const members = Array.isArray(model.members) ? model.members : [];
  const restraints = Array.isArray(model.restraints) ? model.restraints : [];
  const loadCases = Array.isArray(model.loadCases) ? model.loadCases : [];
  const combinations = Array.isArray(model.combinations) ? model.combinations : [];
  const nodalLoads = Array.isArray(model.nodalLoads) ? model.nodalLoads : [];
  const memberLoads = Array.isArray(model.memberLoads) ? model.memberLoads : [];

  // ---- Ids -------------------------------------------------------------------------
  const duplicates = <T>(ids: T[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const nodeId of new Set(duplicates(nodes.map((n) => n.id)))) {
    add(FrameErrors.DUPLICATE_ID, { nodeId, field: "id" });
  }
  for (const memberId of new Set(duplicates(members.map((m) => m.id)))) {
    add(FrameErrors.DUPLICATE_ID, { memberId, field: "id" });
  }
  for (const nodeId of new Set(duplicates(restraints.map((r) => r.nodeId)))) {
    add(FrameErrors.DUPLICATE_ID, { nodeId, field: "restraints" });
  }
  const caseIds = new Set(loadCases.map((c) => c.id));
  const combinationIds = new Set(combinations.map((c) => c.id));
  for (const id of new Set(
    duplicates([...loadCases.map((c) => c.id), ...combinations.map((c) => c.id)]),
  )) {
    add(
      FrameErrors.DUPLICATE_ID,
      combinationIds.has(id) && !caseIds.has(id) ? { combinationId: id } : { loadCaseId: id },
    );
  }

  // ---- Nodes -----------------------------------------------------------------------
  const nodeById = new Map<FrameId, (typeof nodes)[number]>();
  const validNode = new Set<FrameId>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
    let ok = true;
    for (const field of ["x", "y", "z"] as const) {
      if (!isFiniteNumber(node[field])) {
        add(FrameErrors.INVALID_INPUT_VALUE, { nodeId: node.id, field });
        ok = false;
      }
    }
    if (ok) validNode.add(node.id);
  }

  // ---- Members ---------------------------------------------------------------------
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

    if (!geometryOk) continue;
    const a = nodeById.get(member.startNodeId)!;
    const b = nodeById.get(member.endNodeId)!;
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (!(L > 0)) {
      add(FrameErrors.ZERO_LENGTH_MEMBER, at);
      continue;
    }
    memberLength.set(member.id, L);

    const released = [
      ...releasedIndices(member.releases?.start, 0),
      ...releasedIndices(member.releases?.end, 6),
    ];
    if (sectionOk && released.length > 0) {
      const { E, G, A, I22, I33, J } = section;
      try {
        condenseMember(beam3dLocalStiffnessRightHanded(E, G, A, I22, I33, J, L), released);
      } catch {
        add(FrameErrors.INVALID_RELEASE, at);
      }
    }
  }

  // ---- Restraints ------------------------------------------------------------------
  let anyRestrained = false;
  for (const restraint of restraints) {
    if (!nodeById.has(restraint.nodeId)) {
      add(FrameErrors.UNKNOWN_NODE_REFERENCE, { nodeId: restraint.nodeId, field: "restraints" });
    }
    for (const field of DOF_KEYS) {
      const v = restraint[field];
      if (v === undefined || v === false) continue;
      if (v === true) {
        anyRestrained = true;
      } else if (isFiniteNumber(v) && v >= 0) {
        if (v > 0) anyRestrained = true;
      } else {
        add(FrameErrors.INVALID_INPUT_VALUE, { nodeId: restraint.nodeId, field });
      }
    }
  }
  if (!anyRestrained) add(FrameErrors.NO_RESTRAINTS);

  // ---- Load cases ------------------------------------------------------------------
  if (loadCases.length === 0) add(FrameErrors.NO_LOAD_CASES);
  for (const loadCase of loadCases) {
    const at = { loadCaseId: loadCase.id };
    if (loadCase.type !== undefined && !LOAD_CASE_TYPES.has(loadCase.type)) {
      add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "type" });
    }
    if (loadCase.selfWeight === undefined) continue;
    if (!isFiniteNumber(loadCase.selfWeight)) {
      add(FrameErrors.INVALID_LOAD_FACTOR, { ...at, field: "selfWeight" });
      continue;
    }
    if (loadCase.selfWeight !== 0) {
      for (const member of members) {
        if (member.section?.unitWeight === undefined) {
          add(FrameErrors.MISSING_UNIT_WEIGHT, { ...at, memberId: member.id, field: "unitWeight" });
        }
      }
    }
  }

  // ---- Loads -----------------------------------------------------------------------
  for (const load of nodalLoads) {
    const at = { loadCaseId: load.loadCase, nodeId: load.nodeId };
    if (!caseIds.has(load.loadCase))
      add(FrameErrors.UNKNOWN_LOAD_CASE, { ...at, field: "loadCase" });
    if (!nodeById.has(load.nodeId))
      add(FrameErrors.UNKNOWN_NODE_REFERENCE, { ...at, field: "nodeId" });
    for (const field of NODAL_LOAD_KEYS) {
      if (load[field] !== undefined && !isFiniteNumber(load[field])) {
        add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field });
      }
    }
  }

  for (const load of memberLoads) {
    const at = { loadCaseId: load.loadCase, memberId: load.memberId };
    if (!caseIds.has(load.loadCase))
      add(FrameErrors.UNKNOWN_LOAD_CASE, { ...at, field: "loadCase" });
    const memberKnown = members.some((m) => m.id === load.memberId);
    if (!memberKnown) add(FrameErrors.UNKNOWN_NODE_REFERENCE, { ...at, field: "memberId" });
    if (!DIRECTIONS.has(load.direction))
      add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "direction" });

    const L = memberLength.get(load.memberId);
    if (load.type === "udl") {
      let ok = true;
      for (const field of ["w", "start", "end"] as const) {
        const v = load[field];
        if ((field === "w" || v !== undefined) && !isFiniteNumber(v)) {
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

  // ---- Combinations ----------------------------------------------------------------
  let referencesOk = true;
  for (const combination of combinations) {
    const at = { combinationId: combination.id };
    if (!Array.isArray(combination.terms) || combination.terms.length === 0) {
      add(FrameErrors.INVALID_LOAD_FACTOR, { ...at, field: "terms" });
      referencesOk = false;
      continue;
    }
    for (const term of combination.terms) {
      if (!isFiniteNumber(term.factor)) {
        add(FrameErrors.INVALID_LOAD_FACTOR, { ...at, field: "factor" });
        referencesOk = false;
      }
      const caseRef = "case" in term ? term.case : undefined;
      const comboRef = "combination" in term ? term.combination : undefined;
      if ((caseRef === undefined) === (comboRef === undefined)) {
        add(FrameErrors.UNKNOWN_LOAD_CASE, { ...at, field: "terms" });
        referencesOk = false;
      } else if (caseRef !== undefined && !caseIds.has(caseRef)) {
        add(FrameErrors.UNKNOWN_LOAD_CASE, { ...at, loadCaseId: caseRef, field: "case" });
        referencesOk = false;
      } else if (comboRef !== undefined && !combinationIds.has(comboRef)) {
        add(FrameErrors.UNKNOWN_LOAD_CASE, { ...at, field: "combination" });
        referencesOk = false;
      }
    }
  }
  if (referencesOk && combinations.length > 0) {
    try {
      resolveCombinations(combinations, caseIds);
    } catch (e) {
      if (e instanceof FrameAnalysisError) issues.push({ ...frameIssue(e, e.details) });
      else throw e;
    }
  }

  return issues;
};
