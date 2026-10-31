import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/frame.constant";
import {
  FrameErrors,
  type FrameErrorDetails,
  type FrameModelIssue,
} from "@app-core/errors/frame-analysis.error";
import type { FrameId, FrameNode } from "@app-fea/shared/types/model.type";
import { frameIssue } from "@app-fea/shared/validation/issues";

import {
  areaPlane,
  edgeDirection,
  isRectangle,
  resolveAreaSupports,
  type AreaPlane,
  type AreaSupports,
  type Vec3,
} from "../area/area-geometry";
import { edgeMemberChain, memberAdjacency } from "../area/edge-members";
import type { AreaDistribution, Member, NullArea } from "../types/model.type";

const AREA_DISTRIBUTIONS = new Set<AreaDistribution>(["twoWay", "oneWay", "cantilever"]);

/** A null area whose geometry and supports are valid, with its plane and loaded edges. */
export interface NullAreaInfo {
  area: NullArea;
  plane: AreaPlane;
  supports: AreaSupports;
}

/**
 * Checks each null area: its `distribution`, corners (3 or 4 known nodes, planar and convex; a
 * rectangle for a cantilever), `supportEdges`, and members covering every edge that receives
 * load. Corners at nodes with invalid coordinates are skipped; those are reported on the node.
 *
 * @param areas - The model's null areas
 * @param members - The model's members
 * @param memberLength - Length of each member whose geometry is valid (from `validateMembers`);
 *   only those can support an edge
 * @param nodeById - Model nodes by id
 * @param validNode - Ids of the nodes whose coordinates are valid
 * @returns `issues` (codes 302, 314, 315, 316 and 317), in model order, with `areaId`, and the
 *   plane and supports of every area that passed
 */
export const validateNullAreas = (
  areas: NullArea[],
  members: Member[],
  memberLength: Map<FrameId, number>,
  nodeById: Map<FrameId, FrameNode>,
  validNode: Set<FrameId>,
): { issues: FrameModelIssue[]; areaInfo: Map<FrameId, NullAreaInfo> } => {
  const issues: FrameModelIssue[] = [];
  const add = (std: { code: number; message: string }, details: FrameErrorDetails = {}) =>
    issues.push(frameIssue(std, details));
  const adjacency = memberAdjacency(members.filter((m) => memberLength.has(m.id)));
  const position = (id: FrameId): Vec3 => {
    const node = nodeById.get(id)!;
    return [node.x, node.y, node.z];
  };
  // only for areas whose geometry and supports are valid
  const areaInfo = new Map<FrameId, NullAreaInfo>();
  for (const area of areas) {
    const at = { areaId: area.id };
    const distributionOk = AREA_DISTRIBUTIONS.has(area.distribution);
    if (!distributionOk) add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "distribution" });

    const ids = Array.isArray(area.nodeIds) ? area.nodeIds : [];
    if (ids.length !== 3 && ids.length !== 4) {
      add(FrameErrors.INVALID_AREA_GEOMETRY, { ...at, field: "nodeIds" });
      continue;
    }
    if (ids.some((id) => !nodeById.has(id))) {
      add(FrameErrors.UNKNOWN_NODE_REFERENCE, { ...at, field: "nodeIds" });
      continue;
    }
    if (!ids.every((id) => validNode.has(id))) continue; // reported on the node
    const plane = areaPlane(ids.map(position));
    if ("problem" in plane) {
      add(FrameErrors.INVALID_AREA_GEOMETRY, { ...at, field: "nodeIds" });
      continue;
    }
    if (!distributionOk) continue;
    if (area.distribution === "cantilever" && !isRectangle(plane)) {
      add(FrameErrors.INVALID_AREA_GEOMETRY, { ...at, field: "nodeIds" });
      continue;
    }

    const supports = resolveAreaSupports(plane, area.distribution, area.supportEdges);
    if (!supports) {
      add(FrameErrors.INVALID_AREA_DISTRIBUTION, { ...at, field: "supportEdges" });
      continue;
    }
    for (const edge of supports.loadedEdges) {
      const chain = edgeMemberChain(ids[edge], ids[(edge + 1) % ids.length], position, adjacency);
      if (!chain) add(FrameErrors.AREA_EDGE_UNSUPPORTED, { ...at, edge });
    }
    areaInfo.set(area.id, { area, plane, supports });
  }

  return { issues, areaInfo };
};

/**
 * Whether a load along global `direction` acts partly along the support edge of a cantilever
 * area, which its distribution cannot carry: a cantilever sends its load to the support edge as
 * a line load plus a torque about that edge, and a component along the edge would also need a
 * distributed moment about the normal. Always false for other distributions.
 *
 * @param info - The area, as `validateNullAreas` returns it
 * @param direction - The load's global direction (unit vector)
 */
export const loadsAlongCantileverSupport = (info: NullAreaInfo, direction: Vec3): boolean => {
  if (info.area.distribution !== "cantilever") return false;
  const t = edgeDirection(info.plane, info.supports.loadedEdges[0]);
  const along = direction[0] * t[0] + direction[1] * t[1] + direction[2] * t[2];
  return Math.abs(along) > AREA_GEOMETRY_TOLERANCE;
};
