import { roundToDecimalPlaces } from "@app-utils/math";

import type { FrameId } from "../types/model.type";
import type { FrameCaseResult, FrameResult, MemberDiagram } from "../types/results.type";

export interface MemberDemandEnvelope {
  memberId: FrameId;
  MuPositive: number; // kN·m, largest M3 (sagging for local 2 up), 0 if M3 is never positive
  MuNegative: number; // kN·m, magnitude of the most negative M3 (hogging), 0 if M3 is never negative
  Vu: number; // kN, largest |V2| over the checked length
  Nu: number; // kN, N at the largest |N|, tension positive
  VuRange: { from: number; to: number }; // mm from the member start over which Vu was taken
  /** Load case or combination id producing each demand; null when that demand is zero. */
  governing: Record<"MuPositive" | "MuNegative" | "Vu" | "Nu", string | null>;
}

export interface DemandEnvelopeOptions {
  /** Combination ids to envelope. Default: every combination, unless `cases` is given. */
  combinations?: string[];
  /** Load case ids to envelope as well (or instead). Default: none. */
  cases?: string[];
  /** mm. Take Vu only between this distance from each end, e.g. the effective depth d. Default 0. */
  shearCriticalDistance?: number;
}

/** Demands of one diagram; Vu between `from` and `to`. */
const diagramDemands = (diagram: MemberDiagram, from: number, to: number) => {
  const { N, M3, V2 } = diagram.extremes;
  const moments = {
    MuPositive: Math.max(M3.max.value, 0),
    MuNegative: Math.max(-M3.min.value, 0),
    Nu: Math.abs(N.max.value) >= Math.abs(N.min.value) ? N.max.value : N.min.value,
  };
  if (diagram.stations.length === 0) {
    // analysed with diagrams: "extremes" — Vu over the whole length comes from the extremes
    if (from > 0) {
      throw new Error(
        'shearCriticalDistance needs member stations: analyse with diagrams: "full", or pass a diagram from createFrameAnalysis(...).memberDiagram.',
      );
    }
    return { ...moments, Vu: Math.max(Math.abs(V2.max.value), Math.abs(V2.min.value)) };
  }

  // V2 is piecewise linear with stations at every breakpoint, so interpolation is exact.
  // Stations at a point load come as a (left, right) pair sharing the same x.
  const v2At = (x: number, side: "left" | "right"): number => {
    const stations = diagram.stations;
    const hits = stations.filter((s) => s.x === x);
    if (hits.length > 0) return side === "left" ? hits[0].V2 : hits[hits.length - 1].V2;
    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i];
      const b = stations[i + 1];
      if (a.x < x && x < b.x) return a.V2 + ((b.V2 - a.V2) * (x - a.x)) / (b.x - a.x);
    }
    return stations[stations.length - 1].V2;
  };

  const candidates: number[] = [v2At(from, "right"), v2At(to, "left")];
  for (const s of diagram.stations) {
    if (s.x >= from && s.x <= to) candidates.push(s.V2);
  }
  return { ...moments, Vu: roundToDecimalPlaces(Math.max(...candidates.map(Math.abs)), 4) + 0 };
};

/**
 * Reduces a member's force diagrams to the demands used in beam design — Mu⁺, Mu⁻, Vu, Nu —
 * enveloped over load combinations (and optionally load cases), with the governing id of each.
 * Works on plain numbers and does not depend on the `rc` module.
 *
 * @param result - Result of `analyzeFrame`
 * @param memberId - Member to reduce
 * @param options - Combinations and/or cases to envelope, `shearCriticalDistance` in mm
 * @returns Demands in kN and kN·m with their governing load case or combination
 * @throws {Error} if the member or a requested id is not in the result, if nothing is selected,
 *   or if `shearCriticalDistance` is used on a result analysed with `diagrams: "extremes"`
 */
export const memberDemandEnvelope = (
  result: FrameResult,
  memberId: FrameId,
  options: DemandEnvelopeOptions = {},
): MemberDemandEnvelope => {
  const pick = (source: Record<string, FrameCaseResult>, ids: string[], label: string) =>
    ids.map((id) => {
      const r = source[id];
      if (!r) throw new Error(`${label} "${id}" is not in the frame result.`);
      return r;
    });
  const combinationIds =
    options.combinations ?? (options.cases ? [] : Object.keys(result.combinations));
  const selected = [
    ...pick(result.combinations, combinationIds, "Load combination"),
    ...pick(result.cases, options.cases ?? [], "Load case"),
  ];
  if (selected.length === 0) {
    throw new Error(
      "No load combinations or cases selected; the result has no combinations, so pass `cases`.",
    );
  }

  const diagrams = selected.map((r) => {
    const diagram = r.memberDiagrams.find((d) => d.memberId === memberId);
    if (!diagram) throw new Error(`Member ${String(memberId)} is not in the frame result.`);
    return { id: r.id, diagram };
  });

  const L = diagrams[0].diagram.length;
  const from = Math.min(Math.max(options.shearCriticalDistance ?? 0, 0), L / 2);
  const to = L - from;

  const envelope: Omit<MemberDemandEnvelope, "memberId" | "VuRange"> = {
    MuPositive: 0,
    MuNegative: 0,
    Vu: 0,
    Nu: 0,
    governing: { MuPositive: null, MuNegative: null, Vu: null, Nu: null },
  };
  for (const { id, diagram } of diagrams) {
    const d = diagramDemands(diagram, from, to);
    for (const key of ["MuPositive", "MuNegative", "Vu"] as const) {
      if (d[key] > envelope[key]) {
        envelope[key] = d[key];
        envelope.governing[key] = id;
      }
    }
    if (Math.abs(d.Nu) > Math.abs(envelope.Nu)) {
      envelope.Nu = d.Nu;
      envelope.governing.Nu = id;
    }
  }

  return { memberId, ...envelope, VuRange: { from, to } };
};
