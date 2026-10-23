import type { Warnings } from "@app-core/types/output-message.type";

import { areaMemberLoads } from "../area/distribute-area-loads";
import { buildEnvelope } from "../post/envelope";
import { presentMemberDiagram, presentState } from "../post/present-state";
import type { FrameId, FrameModel, MemberLoad, NodalLoad } from "../types/model.type";
import type { FrameCaseResult, FrameResult, MemberDiagram } from "../types/results.type";
import { throwIssues, validateFrameModel } from "../validation/validate-model";
import { resolveCombinations } from "./combinations";
import { prepareFrameSystem } from "./frame-system";
import { combineStates, solveLoadCase, type RawState } from "./load-case-solver";

export interface AnalyzeFrameOptions {
  /** Number of evenly spaced stations per member diagram (default 21). */
  stations?: number;
  /**
   * `"full"` (default) returns every member diagram with its `stations`; `"extremes"` keeps
   * each diagram's `extremes` (so the envelope and `memberDemandEnvelope` still work) but leaves
   * `stations` empty, which makes large results far smaller. Full diagrams are then available on
   * demand from `createFrameAnalysis(...).memberDiagram`.
   */
  diagrams?: "full" | "extremes";
}

/** An analysed model whose member diagrams can be computed on demand. */
export interface FrameAnalysis {
  /** The same result `analyzeFrame` returns. */
  result: FrameResult;
  /**
   * The full diagram (stations and extremes) of one member for one load case or combination,
   * computed from the stored solution without re-analysing.
   *
   * @param resultId - Load case or combination id
   * @param memberId - Member id
   * @param stations - Evenly spaced stations (default: the analysis option, else 21)
   * @throws {Error} if either id is not in the model
   */
  memberDiagram: (resultId: string, memberId: FrameId, stations?: number) => MemberDiagram;
}

/** Groups loads by their load case id, keeping the input order within each case. */
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
 * Analyses a 3D frame like `analyzeFrame` and keeps the solution, so that full member diagrams
 * can be requested later one member at a time — e.g. analyse with `diagrams: "extremes"` and
 * draw a member's diagram when the user selects it. Run it in a Web Worker for large models.
 *
 * @param model - Nodes, members, restraints, load cases, loads tagged with their load case,
 *   null areas, and combinations
 * @param options - Diagram station count and detail
 * @returns `{ result, memberDiagram }`
 * @throws {FrameAnalysisError} 301–317 for an invalid model (with `details` and every problem in
 *   `issues`), 304 for an unstable structure
 */
export const createFrameAnalysis = (
  model: FrameModel,
  options: AnalyzeFrameOptions = {},
): FrameAnalysis => {
  const issues = validateFrameModel(model);
  if (issues.length > 0) throwIssues(issues);

  const system = prepareFrameSystem(model);
  const combinations = model.combinations ?? [];
  const resolved = resolveCombinations(combinations, new Set(model.loadCases.map((c) => c.id)));
  const withStations = (options.diagrams ?? "full") === "full";
  const fromAreas = areaMemberLoads(model);

  const states = new Map<string, RawState>();
  const cases: Record<string, FrameCaseResult> = {};
  const nodalByCase = groupByCase<NodalLoad>(model.nodalLoads);
  const memberByCase = groupByCase<MemberLoad>([
    ...(model.memberLoads ?? []),
    ...fromAreas.memberLoads,
  ]);
  for (const loadCase of model.loadCases) {
    const state = solveLoadCase(system, loadCase, {
      nodalLoads: nodalByCase.get(loadCase.id) ?? [],
      memberLoads: memberByCase.get(loadCase.id) ?? [],
    });
    states.set(loadCase.id, state);
    cases[loadCase.id] = presentState(
      system,
      state,
      { id: loadCase.id, kind: "case", name: loadCase.name, type: loadCase.type },
      { stations: options.stations, withStations },
    );
  }

  const combinationStates = new Map<string, RawState>();
  const combinationResults: Record<string, FrameCaseResult> = {};
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
    );
  }

  const warnings: Warnings = [
    ...fromAreas.warnings,
    ...[...Object.values(cases), ...Object.values(combinationResults)].flatMap((r) =>
      r.warnings.map((w) => ({
        ...w,
        message: `${r.kind === "case" ? "Load case" : "Load combination"} "${r.id}": ${w.message}`,
      })),
    ),
  ];

  const combinationList = combinations.map((c) => combinationResults[c.id]);
  const result: FrameResult = {
    cases,
    combinations: combinationResults,
    envelope: combinationList.length > 0 ? buildEnvelope(combinationList) : undefined,
    calculationDetails: {
      nodeCount: system.nodes.length,
      memberCount: system.members.length,
      dofCount: system.dofCount,
      freeDofCount: system.free.length,
      profileSize: system.profileSize,
      loadCaseCount: model.loadCases.length,
      combinationCount: combinations.length,
    },
    units: { force: "kN", moment: "kN·m", length: "mm", rotation: "rad" },
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
 * Analyses a 3D frame by the direct stiffness method (linear elastic, small displacements)
 * for every load case, then forms every load combination by superposition.
 *
 * The model is validated first (`validateFrameModel`). The stiffness matrix is assembled once
 * in skyline storage with the nodes in reverse Cuthill–McKee order and factorised once; each
 * load case is a separate solve. A combination is the factored sum of its load cases (nested
 * combinations are expanded), and its member diagrams are rebuilt from the combined end forces
 * and factored member loads, so their extremes are exact rather than sums of case extremes.
 *
 * Units: node coordinates, section properties and positions in mm and MPa; loads in kN, kN·m
 * and kN/m; springs in kN/mm and kN·m/rad; unit weight in kN/m³. Results are in kN, kN·m, mm
 * and rad. Global axes X, Y, Z are right-handed with Z up; members use ETABS-style local axes
 * 1, 2, 3 (see `memberAxes`). Member end forces and diagrams use right-hand rotations.
 *
 * Area loads on null areas (`areas`, `areaLoads`) are first turned into member loads on the
 * members along each area's edges (see `distributeAreaLoads`); the areas add no stiffness.
 *
 * Model and result are plain data (JSON-serialisable), so the analysis can run in a Web Worker.
 *
 * @param model - Nodes, members, restraints, load cases, loads tagged with their load case,
 *   null areas, and combinations
 * @param options - Diagram station count and detail
 * @returns `cases` and `combinations` keyed by id, `envelope` over the combinations,
 *   `calculationDetails`, `units` and `warnings`
 * @throws {FrameAnalysisError} 301–317 for an invalid model (with `details` and every problem in
 *   `issues`), 304 for an unstable structure
 */
export const analyzeFrame = (model: FrameModel, options: AnalyzeFrameOptions = {}): FrameResult =>
  createFrameAnalysis(model, options).result;
