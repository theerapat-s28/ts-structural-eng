import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/frame.constant";

import type { FrameId, Member } from "../types/model.type";
import type { Vec3 } from "./area-geometry";

/** The members meeting at each node, with the node at their other end. */
export type MemberAdjacency = Map<FrameId, { member: Member; other: FrameId }[]>;

/** One member covering part of an area edge, with positions along the edge from its start. */
export interface EdgeSegment {
  member: Member;
  from: number; // mm along the edge
  to: number; // mm along the edge
  reversed: boolean; // the member runs from the edge's end towards its start
}

/** Indexes members by the nodes they connect. */
export const memberAdjacency = (members: Member[]): MemberAdjacency => {
  const adjacency: MemberAdjacency = new Map();
  const link = (node: FrameId, entry: { member: Member; other: FrameId }) => {
    const list = adjacency.get(node);
    if (list) list.push(entry);
    else adjacency.set(node, [entry]);
  };
  for (const member of members) {
    link(member.startNodeId, { member, other: member.endNodeId });
    link(member.endNodeId, { member, other: member.startNodeId });
  }
  return adjacency;
};

/**
 * The chain of collinear members covering an area edge from `start` to `end`, found by walking
 * the members at each node towards `end`: each step takes the member whose far node lies on the
 * edge nearest ahead, so intermediate nodes (beams framing in) split the edge into segments.
 *
 * @param position - Node coordinates in mm
 * @returns The segments in order along the edge, or `null` if a gap leaves part of it uncovered
 */
export const edgeMemberChain = (
  start: FrameId,
  end: FrameId,
  position: (id: FrameId) => Vec3,
  adjacency: MemberAdjacency,
): EdgeSegment[] | null => {
  const A = position(start);
  const B = position(end);
  const d: Vec3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const L = Math.hypot(...d);
  const t: Vec3 = [d[0] / L, d[1] / L, d[2] / L];
  const tolerance = AREA_GEOMETRY_TOLERANCE * L;

  const segments: EdgeSegment[] = [];
  let current = start;
  let s = 0;
  while (current !== end) {
    let next: { member: Member; other: FrameId; s: number } | undefined;
    for (const { member, other } of adjacency.get(current) ?? []) {
      const P = position(other);
      const r: Vec3 = [P[0] - A[0], P[1] - A[1], P[2] - A[2]];
      const along = r[0] * t[0] + r[1] * t[1] + r[2] * t[2];
      const off = Math.hypot(r[0] - along * t[0], r[1] - along * t[1], r[2] - along * t[2]);
      if (off > tolerance || along <= s + tolerance || along > L + tolerance) continue;
      if (!next || along < next.s) next = { member, other, s: along };
    }
    if (!next) return null;
    const to = next.other === end ? L : next.s;
    segments.push({
      member: next.member,
      from: s,
      to,
      reversed: next.member.startNodeId !== current,
    });
    current = next.other;
    s = to;
  }
  return segments;
};
