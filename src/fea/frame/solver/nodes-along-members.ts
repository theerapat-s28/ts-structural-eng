import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/frame.constant";
import type { FeaId, FeaNode } from "@app-fea/shared/types/model.type";

import type { Member } from "../types/model.type";

type Point = [number, number, number];

/** A node whose projection on a member's axis falls strictly between the member's ends. */
export interface NodeAlongMember {
  nodeId: FeaId;
  /** Distance of the projection from the member's start (mm). */
  x: number;
  /** Distance of the node from the member's axis (mm). */
  distance: number;
  /** True when the node lies on the member, within `AREA_GEOMETRY_TOLERANCE` × its length. */
  on: boolean;
}

/** First index of the sorted `values` that is not below `v`. */
const lowerBound = (values: Float64Array, v: number): number => {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/**
 * For each member, the candidate nodes lying within `reach` of its axis whose projection falls
 * strictly between its ends (more than the on-member tolerance from either end), in order from
 * its start. A member's own end nodes are skipped.
 *
 * The candidates are sorted once along each global axis; each member scans only the candidates
 * inside its bounding box (grown by its reach) along the axis where that box is thinnest, so
 * the search stays fast for models with many nodes.
 *
 * @param members - Members with valid geometry (non-zero length)
 * @param position - Coordinates (mm) of every member end node
 * @param candidates - The nodes to look for
 * @param reach - Largest distance (mm) from the axis to report for a member of the given length,
 *   or null to skip the member
 * @returns One list per member, in member order
 */
export const nodesAlongMembers = (
  members: Member[],
  position: (id: FeaId) => Point,
  candidates: FeaNode[],
  reach: (member: Member, length: number) => number | null,
): NodeAlongMember[][] => {
  const coordinate = (n: FeaNode, k: number) => (k === 0 ? n.x : k === 1 ? n.y : n.z);
  const order = [0, 1, 2].map((k) =>
    candidates
      .map((_, i) => i)
      .sort((a, b) => coordinate(candidates[a], k) - coordinate(candidates[b], k)),
  );
  const sorted = order.map((o, k) => Float64Array.from(o, (i) => coordinate(candidates[i], k)));

  return members.map((member) => {
    const P = position(member.startNodeId);
    const Q = position(member.endNodeId);
    const d: Point = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]];
    const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const L = Math.sqrt(L2);
    const r = reach(member, L);
    if (r === null || !(L > 0) || candidates.length === 0) return [];
    const tolerance = AREA_GEOMETRY_TOLERANCE * L;
    const lo = [0, 1, 2].map((k) => Math.min(P[k], Q[k]) - r);
    const hi = [0, 1, 2].map((k) => Math.max(P[k], Q[k]) + r);
    const axis = [0, 1, 2].reduce((best, k) => (hi[k] - lo[k] < hi[best] - lo[best] ? k : best), 0);

    const found: NodeAlongMember[] = [];
    for (let j = lowerBound(sorted[axis], lo[axis]); j < candidates.length; j++) {
      if (sorted[axis][j] > hi[axis]) break;
      const node = candidates[order[axis][j]];
      if (node.id === member.startNodeId || node.id === member.endNodeId) continue;
      const X: Point = [node.x, node.y, node.z];
      if (X.some((v, k) => v < lo[k] || v > hi[k])) continue;
      const w: Point = [X[0] - P[0], X[1] - P[1], X[2] - P[2]];
      const t = (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / L2;
      const x = t * L;
      if (x <= tolerance || x >= L - tolerance) continue;
      const distance = Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]);
      if (distance > r) continue;
      found.push({ nodeId: node.id, x, distance, on: distance <= tolerance });
    }
    return found.sort((a, b) => a.x - b.x);
  });
};
