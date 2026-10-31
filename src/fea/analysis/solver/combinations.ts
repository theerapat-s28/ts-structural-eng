import { FrameAnalysisError, FrameErrors } from "@app-core/errors/frame-analysis.error";

import type { LoadCombination } from "../types/model.type";

/**
 * Expands every combination into net factors on load cases, following nested combinations.
 *
 * @param combinations - Model combinations
 * @param caseIds - Ids of the model's load cases
 * @returns For each combination id, the net factor on each load case it uses
 * @throws {FrameAnalysisError} 309 for an unknown or missing reference, 310 for a loop,
 *   311 for a non-finite factor or an empty combination
 */
export const resolveCombinations = (
  combinations: LoadCombination[],
  caseIds: Set<string>,
): Map<string, Map<string, number>> => {
  const byId = new Map(combinations.map((c) => [c.id, c]));

  for (const combination of combinations) {
    if (!Array.isArray(combination.terms) || combination.terms.length === 0) {
      throw new FrameAnalysisError(FrameErrors.INVALID_LOAD_FACTOR, {
        combinationId: combination.id,
      });
    }
    for (const term of combination.terms) {
      if (!Number.isFinite(term.factor))
        throw new FrameAnalysisError(FrameErrors.INVALID_LOAD_FACTOR, {
          combinationId: combination.id,
        });
      const isCase = "case" in term && term.case !== undefined;
      const isCombination = "combination" in term && term.combination !== undefined;
      if (isCase === isCombination)
        throw new FrameAnalysisError(FrameErrors.UNKNOWN_LOAD_CASE, {
          combinationId: combination.id,
        });
      if (isCase && !caseIds.has(term.case)) {
        throw new FrameAnalysisError(FrameErrors.UNKNOWN_LOAD_CASE, {
          combinationId: combination.id,
        });
      }
      if (isCombination && !byId.has(term.combination)) {
        throw new FrameAnalysisError(FrameErrors.UNKNOWN_LOAD_CASE, {
          combinationId: combination.id,
        });
      }
    }
  }

  const resolved = new Map<string, Map<string, number>>();
  const visiting = new Set<string>();

  const resolve = (id: string): Map<string, number> => {
    const done = resolved.get(id);
    if (done) return done;
    if (visiting.has(id)) {
      throw new FrameAnalysisError(FrameErrors.CIRCULAR_COMBINATION, { combinationId: id });
    }
    visiting.add(id);

    const factors = new Map<string, number>();
    const addFactor = (caseId: string, factor: number) =>
      factors.set(caseId, (factors.get(caseId) ?? 0) + factor);
    for (const term of (byId.get(id) as LoadCombination).terms) {
      if ("case" in term) {
        addFactor(term.case, term.factor);
      } else {
        resolve(term.combination).forEach((f, caseId) => addFactor(caseId, term.factor * f));
      }
    }

    visiting.delete(id);
    resolved.set(id, factors);
    return factors;
  };

  combinations.forEach((c) => resolve(c.id));
  return resolved;
};
