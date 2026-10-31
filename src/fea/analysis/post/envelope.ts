import type { StationComponent } from "@app-fea/frame/types/results.type";
import type { ShellForceComponent } from "@app-fea/shell/types/results.type";

import type {
  Bound,
  FeaCaseResult,
  FeaEnvelope,
  GoverningExtremeValue,
  GoverningValue,
} from "../types/results.type";

const DISPLACEMENT_KEYS = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
const REACTION_KEYS = ["fx", "fy", "fz", "mx", "my", "mz"] as const;
const COMPONENTS: StationComponent[] = ["N", "V2", "V3", "T", "M2", "M3", "u1", "u2", "u3"];
const SHELL_COMPONENTS: ShellForceComponent[] = [
  "F11",
  "F22",
  "F12",
  "M11",
  "M22",
  "M12",
  "V13",
  "V23",
  "S11Top",
  "S22Top",
  "S12Top",
  "S11Bot",
  "S22Bot",
  "S12Bot",
];

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
export const buildEnvelope = (results: FeaCaseResult[]): FeaEnvelope => {
  const first = results[0];

  const nodalDisplacements = first.nodalDisplacements.map((d, n) => {
    const entry = { nodeId: d.nodeId } as FeaEnvelope["nodalDisplacements"][number];
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
    const entry = { nodeId: d.nodeId } as FeaEnvelope["reactions"][number];
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

  const shells = first.shellForces.map((shell, s) => ({
    shellId: shell.shellId,
    corners: shell.corners.map((corner, c) => {
      const entry = { nodeId: corner.nodeId } as FeaEnvelope["shells"][number]["corners"][number];
      for (const key of SHELL_COMPONENTS) {
        let bound: Bound<GoverningValue> | undefined;
        for (const r of results) {
          const g = { value: r.shellForces[s].corners[c][key], combinationId: r.id };
          bound = update(bound, g, g);
        }
        entry[key] = bound as Bound<GoverningValue>;
      }
      return entry;
    }),
  }));

  return {
    combinationIds: results.map((r) => r.id),
    nodalDisplacements,
    reactions,
    members,
    shells,
  };
};
