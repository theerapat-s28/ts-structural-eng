import {
  FeaError,
  FeaErrors,
  type FeaErrorDetails,
  type FeaModelIssue,
} from "@app-core/errors/fea.error";
import type { Vec3 } from "@app-fea/frame/area/area-geometry";
import { validateMemberLoads, validateMembers } from "@app-fea/frame/validation/validate-members";
import {
  loadsAlongCantileverSupport,
  validateNullAreas,
} from "@app-fea/frame/validation/validate-null-areas";
import type { FeaId } from "@app-fea/shared/types/model.type";
import { modelIssue, isFiniteNumber } from "@app-fea/shared/validation/issues";
import { validateShellMesh, validateShells } from "@app-fea/shell/validation/validate-shells";

import { resolveCombinations } from "../solver/combinations";
import type { FeaModel, LoadCaseType } from "../types/model.type";

const DOF_KEYS = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
const NODAL_LOAD_KEYS = ["fx", "fy", "fz", "mx", "my", "mz"] as const;
const GLOBAL_DIRECTIONS = new Set(["X", "Y", "Z"]);
const AREA_DIRECTIONS: Record<string, Vec3 | "normal"> = {
  "3": "normal",
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
};
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

/**
 * Checks a model without analysing it and returns every problem found, each with the
 * node, member, load case, combination and field it concerns. An empty array means the
 * model can be analysed, apart from an unstable structure (304) and a translation that nothing
 * resists at a node connected only to shells (328), which only assembling the stiffness detects.
 *
 * @param model - The model to check
 * @returns Every problem found (codes 301–303, 305–317 and 326–327, 329), in model order
 */
export const validateModel = (model: FeaModel): FeaModelIssue[] => {
  const issues: FeaModelIssue[] = [];
  const add = (std: { code: number; message: string }, details: FeaErrorDetails = {}) =>
    issues.push(modelIssue(std, details));

  const nodes = Array.isArray(model.nodes) ? model.nodes : [];
  const members = Array.isArray(model.members) ? model.members : [];
  const restraints = Array.isArray(model.restraints) ? model.restraints : [];
  const loadCases = Array.isArray(model.loadCases) ? model.loadCases : [];
  const combinations = Array.isArray(model.combinations) ? model.combinations : [];
  const nodalLoads = Array.isArray(model.nodalLoads) ? model.nodalLoads : [];
  const memberLoads = Array.isArray(model.memberLoads) ? model.memberLoads : [];
  const areas = Array.isArray(model.areas) ? model.areas : [];
  const shells = Array.isArray(model.shells) ? model.shells : [];
  const lineRestraints = Array.isArray(model.lineRestraints) ? model.lineRestraints : [];
  const areaLoads = Array.isArray(model.areaLoads) ? model.areaLoads : [];

  // ---- Ids -------------------------------------------------------------------------
  const duplicates = <T>(ids: T[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const nodeId of new Set(duplicates(nodes.map((n) => n.id)))) {
    add(FeaErrors.DUPLICATE_ID, { nodeId, field: "id" });
  }
  for (const memberId of new Set(duplicates(members.map((m) => m.id)))) {
    add(FeaErrors.DUPLICATE_ID, { memberId, field: "id" });
  }
  for (const areaId of new Set(duplicates(areas.map((a) => a.id)))) {
    add(FeaErrors.DUPLICATE_ID, { areaId, field: "id" });
  }
  // shells share the area id namespace: a duplicate within shells or with a null area
  const nullAreaIds = new Set(areas.map((a) => a.id));
  for (const shellId of new Set([
    ...duplicates(shells.map((sh) => sh.id)),
    ...shells.map((sh) => sh.id).filter((id) => nullAreaIds.has(id)),
  ])) {
    add(FeaErrors.DUPLICATE_ID, { shellId, field: "id" });
  }
  for (const nodeId of new Set(duplicates(restraints.map((r) => r.nodeId)))) {
    add(FeaErrors.DUPLICATE_ID, { nodeId, field: "restraints" });
  }
  const caseIds = new Set(loadCases.map((c) => c.id));
  const combinationIds = new Set(combinations.map((c) => c.id));
  for (const id of new Set(
    duplicates([...loadCases.map((c) => c.id), ...combinations.map((c) => c.id)]),
  )) {
    add(
      FeaErrors.DUPLICATE_ID,
      combinationIds.has(id) && !caseIds.has(id) ? { combinationId: id } : { loadCaseId: id },
    );
  }

  // ---- Nodes -----------------------------------------------------------------------
  const nodeById = new Map<FeaId, (typeof nodes)[number]>();
  const validNode = new Set<FeaId>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
    let ok = true;
    for (const field of ["x", "y", "z"] as const) {
      if (!isFiniteNumber(node[field])) {
        add(FeaErrors.INVALID_INPUT_VALUE, { nodeId: node.id, field });
        ok = false;
      }
    }
    if (ok) validNode.add(node.id);
  }

  // ---- Members ---------------------------------------------------------------------
  const checkedMembers = validateMembers(members, nodeById, validNode);
  issues.push(...checkedMembers.issues);
  const { memberLength } = checkedMembers;

  // ---- Restraints ------------------------------------------------------------------
  let anyRestrained = false;
  for (const restraint of restraints) {
    if (!nodeById.has(restraint.nodeId)) {
      add(FeaErrors.UNKNOWN_NODE_REFERENCE, { nodeId: restraint.nodeId, field: "restraints" });
    }
    for (const field of DOF_KEYS) {
      const v = restraint[field];
      if (v === undefined || v === false) continue;
      if (v === true) {
        anyRestrained = true;
      } else if (isFiniteNumber(v) && v >= 0) {
        if (v > 0) anyRestrained = true;
      } else {
        add(FeaErrors.INVALID_INPUT_VALUE, { nodeId: restraint.nodeId, field });
      }
    }
  }
  for (const line of lineRestraints) {
    const ids = Array.isArray(line.nodeIds) ? line.nodeIds : [];
    const at = { nodeId: ids[0], field: "lineRestraints.nodeIds" };
    if (ids.length !== 2 || ids[0] === ids[1]) add(FeaErrors.INVALID_INPUT_VALUE, at);
    else if (ids.some((id) => !nodeById.has(id))) add(FeaErrors.UNKNOWN_NODE_REFERENCE, at);
    for (const field of DOF_KEYS) {
      const v: unknown = line[field];
      if (v === undefined || v === false) continue;
      if (v === true) anyRestrained = true;
      else add(FeaErrors.INVALID_INPUT_VALUE, { nodeId: ids[0], field: `lineRestraints.${field}` });
    }
  }
  if (!anyRestrained) add(FeaErrors.NO_RESTRAINTS);

  // ---- Load cases ------------------------------------------------------------------
  if (loadCases.length === 0) add(FeaErrors.NO_LOAD_CASES);
  for (const loadCase of loadCases) {
    const at = { loadCaseId: loadCase.id };
    if (loadCase.type !== undefined && !LOAD_CASE_TYPES.has(loadCase.type)) {
      add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: "type" });
    }
    if (loadCase.selfWeight === undefined) continue;
    if (!isFiniteNumber(loadCase.selfWeight)) {
      add(FeaErrors.INVALID_LOAD_FACTOR, { ...at, field: "selfWeight" });
      continue;
    }
    if (loadCase.selfWeight !== 0) {
      for (const member of members) {
        if (member.section?.unitWeight === undefined) {
          add(FeaErrors.MISSING_UNIT_WEIGHT, { ...at, memberId: member.id, field: "unitWeight" });
        }
      }
      for (const shell of shells) {
        if (shell.section?.unitWeight === undefined) {
          add(FeaErrors.MISSING_UNIT_WEIGHT, {
            ...at,
            shellId: shell.id,
            field: "section.unitWeight",
          });
        }
      }
    }
  }

  // ---- Loads -----------------------------------------------------------------------
  for (const load of nodalLoads) {
    const at = { loadCaseId: load.loadCase, nodeId: load.nodeId };
    if (!caseIds.has(load.loadCase)) add(FeaErrors.UNKNOWN_LOAD_CASE, { ...at, field: "loadCase" });
    if (!nodeById.has(load.nodeId))
      add(FeaErrors.UNKNOWN_NODE_REFERENCE, { ...at, field: "nodeId" });
    for (const field of NODAL_LOAD_KEYS) {
      if (load[field] !== undefined && !isFiniteNumber(load[field])) {
        add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field });
      }
    }
  }

  issues.push(...validateMemberLoads(memberLoads, members, memberLength, caseIds));

  // ---- Areas -----------------------------------------------------------------------
  const checkedAreas = validateNullAreas(areas, members, memberLength, nodeById, validNode);
  issues.push(...checkedAreas.issues);
  const { areaInfo } = checkedAreas;

  // ---- Shells ----------------------------------------------------------------------
  issues.push(...validateShells(shells, nodeById, validNode));
  // the mesh, once every shell and its mesh settings are valid
  const shellProblem = issues.some((i) => i.details.shellId !== undefined);
  const nodeProblem = nodes.length !== validNode.size;
  if (shells.length > 0 && !shellProblem && !nodeProblem) {
    issues.push(...validateShellMesh(nodes, shells));
  }

  const areaIds = new Set([...areas.map((a) => a.id), ...shells.map((sh) => sh.id)]);
  for (const load of areaLoads) {
    const at = { loadCaseId: load.loadCase, areaId: load.areaId };
    if (!caseIds.has(load.loadCase)) add(FeaErrors.UNKNOWN_LOAD_CASE, { ...at, field: "loadCase" });
    if (!areaIds.has(load.areaId)) {
      add(FeaErrors.UNKNOWN_NODE_REFERENCE, { ...at, field: "areaId" });
    }
    const direction = Object.prototype.hasOwnProperty.call(AREA_DIRECTIONS, load.direction)
      ? AREA_DIRECTIONS[load.direction]
      : undefined;
    if (!direction) add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: "direction" });
    if (!isFiniteNumber(load.q)) add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: "q" });
    if (
      (load.projected !== undefined && typeof load.projected !== "boolean") ||
      (load.projected === true && !GLOBAL_DIRECTIONS.has(load.direction))
    ) {
      add(FeaErrors.INVALID_INPUT_VALUE, { ...at, field: "projected" });
    }

    const info = areaInfo.get(load.areaId);
    if (
      direction &&
      direction !== "normal" &&
      info &&
      loadsAlongCantileverSupport(info, direction)
    ) {
      add(FeaErrors.INVALID_AREA_DISTRIBUTION, { ...at, field: "direction" });
    }
  }

  // ---- Combinations ----------------------------------------------------------------
  let referencesOk = true;
  for (const combination of combinations) {
    const at = { combinationId: combination.id };
    if (!Array.isArray(combination.terms) || combination.terms.length === 0) {
      add(FeaErrors.INVALID_LOAD_FACTOR, { ...at, field: "terms" });
      referencesOk = false;
      continue;
    }
    for (const term of combination.terms) {
      if (!isFiniteNumber(term.factor)) {
        add(FeaErrors.INVALID_LOAD_FACTOR, { ...at, field: "factor" });
        referencesOk = false;
      }
      const caseRef = "case" in term ? term.case : undefined;
      const comboRef = "combination" in term ? term.combination : undefined;
      if ((caseRef === undefined) === (comboRef === undefined)) {
        add(FeaErrors.UNKNOWN_LOAD_CASE, { ...at, field: "terms" });
        referencesOk = false;
      } else if (caseRef !== undefined && !caseIds.has(caseRef)) {
        add(FeaErrors.UNKNOWN_LOAD_CASE, { ...at, loadCaseId: caseRef, field: "case" });
        referencesOk = false;
      } else if (comboRef !== undefined && !combinationIds.has(comboRef)) {
        add(FeaErrors.UNKNOWN_LOAD_CASE, { ...at, field: "combination" });
        referencesOk = false;
      }
    }
  }
  if (referencesOk && combinations.length > 0) {
    try {
      resolveCombinations(combinations, caseIds);
    } catch (e) {
      if (e instanceof FeaError) issues.push({ ...modelIssue(e, e.details) });
      else throw e;
    }
  }

  return issues;
};
