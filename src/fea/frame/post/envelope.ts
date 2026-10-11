import type {
  Bound,
  FrameCaseResult,
  FrameEnvelope,
  GoverningExtremeValue,
  GoverningValue,
  StationComponent,
} from "../types/results.type";

const DISPLACEMENT_KEYS = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
const REACTION_KEYS = ["fx", "fy", "fz", "mx", "my", "mz"] as const;
const COMPONENTS: StationComponent[] = ["N", "V2", "V3", "T", "M2", "M3", "u1", "u2", "u3"];

/** Keeps the larger max and smaller min; the first combination wins a tie. */
const update = <T extends GoverningValue>(
  bound: Bound<T> | undefined,
  max: T,
  min: T,
): Bound<T> => {
  if (!bound) return { max, min };
  return {
    max: max.value > bound.max.value ? max : bound.max,
    min: min.value < bound.min.value ? min : bound.min,
  };
};

/**
 * Max/min of every presented result across combinations, each with the combination that
 * governs it. Combinations must come from the same model (same nodes and members, same order).
 *
 * @param results - Combination results, in model order
 */
export const buildEnvelope = (results: FrameCaseResult[]): FrameEnvelope => {
  const first = results[0];

  const nodalDisplacements = first.nodalDisplacements.map((d, n) => {
    const entry = { nodeId: d.nodeId } as FrameEnvelope["nodalDisplacements"][number];
    for (const key of DISPLACEMENT_KEYS) {
      let bound: Bound<GoverningValue> | undefined;
      for (const r of results) {
        const g = { value: r.nodalDisplacements[n][key], combinationId: r.id };
        bound = update(bound, g, g);
      }
      entry[key] = bound as Bound<GoverningValue>;
    }
    return entry;
  });

  const reactions = first.reactions.map((d, n) => {
    const entry = { nodeId: d.nodeId } as FrameEnvelope["reactions"][number];
    for (const key of REACTION_KEYS) {
      let bound: Bound<GoverningValue> | undefined;
      for (const r of results) {
        const g = { value: r.reactions[n][key], combinationId: r.id };
        bound = update(bound, g, g);
      }
      entry[key] = bound as Bound<GoverningValue>;
    }
    return entry;
  });

  const members = first.memberDiagrams.map((d, m) => {
    const extremes = {} as Record<StationComponent, Bound<GoverningExtremeValue>>;
    for (const c of COMPONENTS) {
      let bound: Bound<GoverningExtremeValue> | undefined;
      for (const r of results) {
        const e = r.memberDiagrams[m].extremes[c];
        bound = update(bound, { ...e.max, combinationId: r.id }, { ...e.min, combinationId: r.id });
      }
      extremes[c] = bound as Bound<GoverningExtremeValue>;
    }
    return { memberId: d.memberId, extremes };
  });

  return { combinationIds: results.map((r) => r.id), nodalDisplacements, reactions, members };
};
