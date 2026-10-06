import type { FrameId } from "../types/model.type";
import type { FrameResult } from "../types/results.type";

export interface MemberDemandEnvelope {
  memberId: FrameId;
  MuPositive: number; // kN·m, largest M3 (sagging for local 2 up), 0 if M3 is never positive
  MuNegative: number; // kN·m, magnitude of the most negative M3 (hogging), 0 if M3 is never negative
  Vu: number; // kN, largest |V2| over the checked length
  Nu: number; // kN, N at the largest |N|, tension positive
  VuRange: { from: number; to: number }; // mm from the member start over which Vu was taken
}

export interface DemandEnvelopeOptions {
  /** mm. Take Vu only between this distance from each end, e.g. the effective depth d. Default 0. */
  shearCriticalDistance?: number;
}

/**
 * Reduces a member's force diagrams to the demands used in beam design: Mu⁺, Mu⁻, Vu, Nu.
 * Works on plain numbers and does not depend on the `rc` module.
 *
 * @param result - Result of `analyzeFrame`
 * @param memberId - Member to reduce
 * @param options - `shearCriticalDistance` in mm
 * @returns Demands in kN and kN·m
 * @throws {Error} if the member is not in the result
 */
export const memberDemandEnvelope = (
  result: FrameResult,
  memberId: FrameId,
  options: DemandEnvelopeOptions = {},
): MemberDemandEnvelope => {
  const diagram = result.memberDiagrams.find((d) => d.memberId === memberId);
  if (!diagram) throw new Error(`Member ${String(memberId)} is not in the frame result.`);

  const L = diagram.length;
  const from = Math.min(Math.max(options.shearCriticalDistance ?? 0, 0), L / 2);
  const to = L - from;

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
  const Vu = Math.max(...candidates.map(Math.abs));

  const { N, M3 } = diagram.extremes;
  const Nu = Math.abs(N.max.value) >= Math.abs(N.min.value) ? N.max.value : N.min.value;

  return {
    memberId,
    MuPositive: Math.max(M3.max.value, 0),
    MuNegative: Math.max(-M3.min.value, 0),
    Vu,
    Nu,
    VuRange: { from, to },
  };
};
