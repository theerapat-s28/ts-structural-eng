import type { Warnings } from "@app-core/types/output-message.type";
import { areaMemberLoads } from "@app-fea/frame/area/area-member-loads";
import type { MemberLoad } from "@app-fea/frame/types/model.type";
import type { MemberDiagram } from "@app-fea/frame/types/results.type";
import type { AreaLoad, FeaId } from "@app-fea/shared/types/model.type";
import { prepareStrips } from "@app-fea/shell/post/strip-forces";
import { throwIssues } from "@app-fea/shared/validation/issues";
import { roundToDecimalPlaces } from "@app-utils/math";

import { buildEnvelope } from "../post/envelope";
import { prepareWalls } from "../post/wall-forces";
import { presentMemberDiagram, presentState } from "../post/present-state";
import type { FeaModel, NodalLoad } from "../types/model.type";
import { expandModel } from "../mesh/expand-model";
import type {
  AutoRestrainedDof,
  AutoRestrainedTranslation,
  FeaCaseResult,
  FeaResult,
} from "../types/results.type";
import { validateModel } from "../validation/validate-model";
import { resolveCombinations } from "./combinations";
import { prepareAnalysisSystem, type AnalysisSystem } from "./analysis-system";
import { combineStates, solveLoadCase, type RawState } from "./load-case-solver";
import { membraneTributaryLoads } from "./membrane-tributary-loads";

export interface AnalyzeOptions {
  /** Number of evenly spaced stations per member diagram (default 21). */
  stations?: number;
  /**
   * `"full"` (default) returns every member diagram with its `stations`; `"extremes"` keeps
   * each diagram's `extremes` (so the envelope and `memberDemandEnvelope` still work) but leaves
   * `stations` empty, which makes large results far smaller. Full diagrams are then available on
   * demand from `createAnalysis(...).memberDiagram`.
   */
  diagrams?: "full" | "extremes";
}

/** An analysed model whose member diagrams can be computed on demand. */
export interface Analysis {
  /** The same result `analyze` returns. */
  result: FeaResult;
  /**
   * The full diagram (stations and extremes) of one member for one load case or combination,
   * computed from the stored solution without re-analysing.
   *
   * @param resultId - Load case or combination id
   * @param memberId - Member id
   * @param stations - Evenly spaced stations (default: the analysis option, else 21)
   * @throws {Error} if either id is not in the model
   */
  memberDiagram: (resultId: string, memberId: FeaId, stations?: number) => MemberDiagram;
}

const ROTATION_DOFS = ["rx", "ry", "rz"] as const;
const TRANSLATION_DOFS = ["ux", "uy", "uz"] as const;

/** The presented form of a held direction: rounded axis, and its DOF when it is a global axis. */
const presentHeld = <Dof extends string>(
  system: AnalysisSystem,
  { node, axis }: { node: number; axis: [number, number, number] },
  dofs: readonly [Dof, Dof, Dof],
) => {
  const rounded = axis.map((c) => roundToDecimalPlaces(c, 9) + 0) as [number, number, number];
  const aligned = rounded.findIndex((c) => Math.abs(c) === 1);
  return {
    nodeId: system.nodes[node].id,
    axis: rounded,
    ...(aligned >= 0 ? { dof: dofs[aligned] } : {}),
  };
};

/** The presented form of the joint rotations held by the solver. */
const autoRestrainedDofs = (system: AnalysisSystem): AutoRestrainedDof[] =>
  system.autoRestraints.map((held) => presentHeld(system, held, ROTATION_DOFS));

/** The presented form of the translations held at generated mesh nodes. */
const autoRestrainedTranslations = (system: AnalysisSystem): AutoRestrainedTranslation[] =>
  system.heldTranslations.map((held) => presentHeld(system, held, TRANSLATION_DOFS));

/** Groups loads by their load case id, keeping the input order within each case. */
/** The nodes where something other than the shells acts: supports, members and nodal loads. */
const forceNodes = (model: FeaModel, system: AnalysisSystem): Set<number> => {
  const nodes = new Set<number>();
  system.boundary.restrained.forEach((restrained, dof) => {
    if (restrained) nodes.add(Math.floor(dof / 6));
  });
  for (const member of system.members) {
    nodes.add(member.startIndex);
    nodes.add(member.endIndex);
  }
  for (const load of model.nodalLoads ?? []) {
    nodes.add(system.nodeIndex.get(load.nodeId) as number);
  }
  return nodes;
};

const groupByCase = <T extends { loadCase: string }>(loads: T[] = []): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const load of loads) {
    const group = groups.get(load.loadCase);
    if (group) group.push(load);
    else groups.set(load.loadCase, [load]);
  }
  return groups;
};

/**
 * Analyses a model like `analyze` and keeps the solution, so that full member diagrams
 * can be requested later one member at a time — e.g. analyse with `diagrams: "extremes"` and
 * draw a member's diagram when the user selects it. Run it in a Web Worker for large models.
 *
 * @param model - Nodes, members, shells, restraints, load cases, loads tagged with their load
 *   case, null areas, and combinations
 * @param options - Diagram station count and detail
 * @returns `{ result, memberDiagram }`
 * @throws {FeaError} 301–317, 326, 327 and 329–331 for an invalid model (with `details` and
 *   every problem in `issues`), 328 for a translation nothing resists at a model node connected
 *   only to shells, 332 for a load along a translation held at a generated mesh node, 304 for an
 *   unstable structure
 */
export const createAnalysis = (model: FeaModel, options: AnalyzeOptions = {}): Analysis => {
  const issues = validateModel(model);
  if (issues.length > 0) throwIssues(issues);

  const expanded = expandModel(model);
  const system = prepareAnalysisSystem(
    expanded.model,
    new Set(expanded.mesh?.nodes.map((n) => n.id)),
  );
  const combinations = model.combinations ?? [];
  const resolved = resolveCombinations(combinations, new Set(model.loadCases.map((c) => c.id)));
  const withStations = (options.diagrams ?? "full") === "full";
  const fromAreas = areaMemberLoads(model);
  const fromMembranes = membraneTributaryLoads(model, system);
  const strips = prepareStrips(model.strips ?? [], system.shells, forceNodes(model, system));
  const walls = prepareWalls(model, system);

  const states = new Map<string, RawState>();
  const cases: Record<string, FeaCaseResult> = {};
  const nodalByCase = groupByCase<NodalLoad>(model.nodalLoads);
  const memberByCase = groupByCase<MemberLoad>([
    ...(model.memberLoads ?? []),
    ...fromAreas.memberLoads,
    ...fromMembranes.memberLoads,
  ]);
  // area loads on shells load the shell elements; those on null areas became member loads
  const shellByCase = groupByCase<AreaLoad>(
    (model.areaLoads ?? []).filter((load) => system.shellsByArea.has(load.areaId)),
  );
  for (const loadCase of model.loadCases) {
    const state = solveLoadCase(system, loadCase, {
      nodalLoads: nodalByCase.get(loadCase.id) ?? [],
      memberLoads: memberByCase.get(loadCase.id) ?? [],
      shellLoads: shellByCase.get(loadCase.id) ?? [],
      tributaryShells: fromMembranes.shells,
    });
    states.set(loadCase.id, state);
    cases[loadCase.id] = presentState(
      system,
      state,
      { id: loadCase.id, kind: "case", name: loadCase.name, type: loadCase.type },
      { stations: options.stations, withStations },
      strips.strips,
      walls,
    );
  }

  const combinationStates = new Map<string, RawState>();
  const combinationResults: Record<string, FeaCaseResult> = {};
  for (const combination of combinations) {
    // Non-empty: validation rejects combinations without terms
    const terms = [...(resolved.get(combination.id) as Map<string, number>)].map(
      ([caseId, factor]) => ({ state: states.get(caseId) as RawState, factor }),
    );
    const state = combineStates(terms);
    combinationStates.set(combination.id, state);
    combinationResults[combination.id] = presentState(
      system,
      state,
      { id: combination.id, kind: "combination", name: combination.name },
      { stations: options.stations, withStations },
      strips.strips,
      walls,
    );
  }

  const warnings: Warnings = [
    ...fromAreas.warnings,
    ...fromMembranes.warnings,
    ...expanded.warnings,
    ...strips.warnings,
    ...[...Object.values(cases), ...Object.values(combinationResults)].flatMap((r) =>
      r.warnings.map((w) => ({
        ...w,
        message: `${r.kind === "case" ? "Load case" : "Load combination"} "${r.id}": ${w.message}`,
      })),
    ),
  ];

  const combinationList = combinations.map((c) => combinationResults[c.id]);
  const result: FeaResult = {
    cases,
    combinations: combinationResults,
    envelope: combinationList.length > 0 ? buildEnvelope(combinationList) : undefined,
    ...(expanded.mesh ? { mesh: expanded.mesh } : {}),
    calculationDetails: {
      nodeCount: system.nodes.length,
      memberCount: system.memberGroups.length,
      shellCount: system.shells.length,
      dofCount: system.dofCount,
      freeDofCount: system.free.length,
      profileSize: system.profileSize,
      loadCaseCount: model.loadCases.length,
      combinationCount: combinations.length,
      autoRestrainedDofs: autoRestrainedDofs(system),
      autoRestrainedTranslations: autoRestrainedTranslations(system),
      intermediateNodes: expanded.connectivity.intermediateNodes,
      nearMissNodes: expanded.connectivity.nearMissNodes,
    },
    units: {
      force: "kN",
      moment: "kN·m",
      length: "mm",
      rotation: "rad",
      forcePerLength: "kN/m",
      momentPerLength: "kN·m/m",
      stress: "MPa",
    },
    warnings,
  };

  return {
    result,
    memberDiagram: (resultId, memberId, stations) => {
      const state = combinationStates.get(resultId) ?? states.get(resultId);
      if (!state) throw new Error(`Load case or combination "${resultId}" is not in the model.`);
      const m = system.memberIndex.get(memberId);
      if (m === undefined) throw new Error(`Member ${String(memberId)} is not in the model.`);
      return presentMemberDiagram(system, state, m, stations ?? options.stations);
    },
  };
};

/**
 * Analyses a 3D structure of frame members, shell areas or both by the direct stiffness method
 * (linear elastic, small displacements) for every load case, then forms every load combination
 * by superposition.
 *
 * The model is validated first (`validateModel`). The stiffness matrix is assembled once
 * in skyline storage with the nodes in reverse Cuthill–McKee order and factorised once; each
 * load case is a separate solve. A combination is the factored sum of its load cases (nested
 * combinations are expanded), and its member diagrams are rebuilt from the combined end forces
 * and factored member loads, so their extremes are exact rather than sums of case extremes.
 *
 * Units: node coordinates, section properties and positions in mm and MPa; loads in kN, kN·m
 * and kN/m; springs in kN/mm and kN·m/rad; unit weight in kN/m³. Results are in kN, kN·m, mm
 * and rad. Global axes X, Y, Z are right-handed with Z up; members use local axes
 * 1, 2, 3 (see `memberAxes`). Member end forces and diagrams use right-hand rotations.
 *
 * A member is connected to every model node lying on it between its ends, as if it were split
 * there, unless it sets `connectIntermediateNodes: false`; it is still reported as one member.
 * The connections are listed in `calculationDetails.intermediateNodes`; a node close to a
 * member but not on it is not connected, and is listed in `calculationDetails.nearMissNodes`
 * with a warning. `memberConnectivity` makes the same check without analysing.
 *
 * Area loads on null areas (`areas`, `areaLoads`) are first turned into member loads on the
 * members along each area's edges (see `distributeAreaLoads`); the areas add no stiffness.
 * Shell areas (`shells`) are four-node flat shell elements with their own stiffness; area loads
 * and self-weight on them act as forces at their corners, except that a membrane area passes
 * the out-of-plane part to the members along its edges by tributary area (see
 * `membraneTributaryLoads`). Strips (`strips`) integrate the shell
 * forces across cuts at stations along them (`stripForces`), for strip design of slabs.
 * Piers and spandrels (`piers`, `spandrels`) sum the nodal forces of their shell elements and
 * members on cuts across them (`pierForces`, `spandrelForces`), for wall design.
 *
 * Model and result are plain data (JSON-serialisable), so the analysis can run in a Web Worker.
 *
 * @param model - Nodes, members, shells, restraints, load cases, loads tagged with their load
 *   case, null areas, and combinations
 * @param options - Diagram station count and detail
 * @returns `cases` and `combinations` keyed by id, `envelope` over the combinations,
 *   `calculationDetails`, `units` and `warnings`
 * @throws {FeaError} 301–317, 326, 327 and 329–331 for an invalid model (with `details` and
 *   every problem in `issues`), 328 for a translation nothing resists at a model node connected
 *   only to shells, 332 for a load along a translation held at a generated mesh node, 304 for an
 *   unstable structure
 */
export const analyze = (model: FeaModel, options: AnalyzeOptions = {}): FeaResult =>
  createAnalysis(model, options).result;
