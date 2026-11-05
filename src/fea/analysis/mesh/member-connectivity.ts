import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/fea.constant";
import {
  NODE_NEAR_MEMBER_MAX_DISTANCE,
  NODE_NEAR_MEMBER_RATIO,
} from "@app-core/constants/frame.constant";
import type { Warnings } from "@app-core/types/output-message.type";
import { nodesAlongMembers, type NodeAlongMember } from "@app-fea/frame/solver/nodes-along-members";
import type { MemberIntermediateNode, MemberNearMissNode } from "@app-fea/frame/types/results.type";
import type { FeaId } from "@app-fea/shared/types/model.type";
import { isFiniteNumber } from "@app-fea/shared/validation/issues";
import { roundToDecimalPlaces } from "@app-utils/math";

import type { FeaModel } from "../types/model.type";

/** How the members of a model connect to the model nodes lying on or near them. */
export interface MemberConnectivity {
  /** Model nodes on a member between its ends, connected to it; member by member from its start. */
  intermediateNodes: MemberIntermediateNode[];
  /** Model nodes close to a member but not on it, so not connected; in the same order. */
  nearMissNodes: MemberNearMissNode[];
  /** One "Member connectivity" warning per near miss. */
  warnings: Warnings;
}

/** Near-miss distance (mm) for a member of length `L`: see `NODE_NEAR_MEMBER_RATIO`. */
const nearMissDistance = (L: number) =>
  Math.min(NODE_NEAR_MEMBER_RATIO * L, NODE_NEAR_MEMBER_MAX_DISTANCE);

/** Formats a distance in mm for a warning, to three significant figures. */
const formatMm = (v: number) => String(Number(v.toPrecision(3)));

const NOWHERE: [number, number, number] = [Number.NaN, Number.NaN, Number.NaN];

/**
 * The connectivity of a model's members, and for each member the model nodes it connects to
 * (unrounded, in order from its start), which is where the solver splits it. Members with an
 * unknown or invalid end node or zero length, and nodes with invalid coordinates, are skipped,
 * so a model that is still being edited can be checked.
 */
export const findMemberConnectivity = (
  model: FeaModel,
): { connected: NodeAlongMember[][]; connectivity: MemberConnectivity } => {
  const members = model.members ?? [];
  const nodes = (model.nodes ?? []).filter(
    (n) => isFiniteNumber(n.x) && isFiniteNumber(n.y) && isFiniteNumber(n.z),
  );
  const position = new Map<FeaId, [number, number, number]>(
    nodes.map((n) => [n.id, [n.x, n.y, n.z]]),
  );
  // an unknown end gives a NaN length, which skips the member
  const found = nodesAlongMembers(
    members,
    (id) => position.get(id) ?? NOWHERE,
    nodes,
    (member, L) =>
      member.connectIntermediateNodes === false
        ? null
        : Math.max(AREA_GEOMETRY_TOLERANCE * L, nearMissDistance(L)),
  );

  const intermediateNodes: MemberIntermediateNode[] = [];
  const nearMissNodes: MemberNearMissNode[] = [];
  const warnings: Warnings = [];
  members.forEach((member, i) => {
    for (const h of found[i]) {
      const at = { memberId: member.id, nodeId: h.nodeId, x: roundToDecimalPlaces(h.x, 3) };
      if (h.on) {
        intermediateNodes.push(at);
        continue;
      }
      nearMissNodes.push({ ...at, distance: roundToDecimalPlaces(h.distance, 3) });
      warnings.push({
        reference: "Member connectivity",
        message: `Node "${String(h.nodeId)}" is ${formatMm(h.distance)} mm from member "${String(member.id)}" (${formatMm(h.x)} mm from its start) but not on it, so it is not connected to the member; move the node onto the member if they should be connected.`,
      });
    }
  });
  return {
    connected: found.map((hits) => hits.filter((h) => h.on)),
    connectivity: { intermediateNodes, nearMissNodes, warnings },
  };
};

/**
 * Finds how a model's members connect to the model nodes lying on or near them, without
 * analysing it: the same check `analyze` makes, cheap enough to run on every edit so a
 * frontend can mark the points while the user draws (`analyze` cannot report them when the
 * model is unstable).
 *
 * - A model node within `AREA_GEOMETRY_TOLERANCE` × the member length of a member's axis,
 *   strictly between its ends, is connected to it: listed in `intermediateNodes`.
 * - A model node further off, but within `NODE_NEAR_MEMBER_RATIO` × the length and at most
 *   `NODE_NEAR_MEMBER_MAX_DISTANCE`, is not connected: listed in `nearMissNodes`, with a
 *   warning.
 *
 * Members with `connectIntermediateNodes: false` are skipped. The model need not be valid:
 * members with an unknown or invalid end node or zero length, and nodes with invalid
 * coordinates, are skipped (`validateModel` reports them). Shell-mesh nodes are not included.
 *
 * @param model - The model; only its nodes and members are used
 * @returns `intermediateNodes`, `nearMissNodes` (positions and distances in mm) and `warnings`
 */
export const memberConnectivity = (model: FeaModel): MemberConnectivity =>
  findMemberConnectivity(model).connectivity;
