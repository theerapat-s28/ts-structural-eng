import type { SectionProperties } from "@app-core/types/section-properties.type";
import type { FeaId, FeaNode } from "@app-fea/shared/types/model.type";
import type { Matrix } from "@app-utils/matrix";

import { beam3dLocalStiffnessRightHanded } from "../elements/beam-3d-stiffness";
import { memberEndReleases } from "../elements/end-releases";
import { condenseMember, type CondensedMember } from "../elements/static-condensation";
import { memberAxes, transformationMatrix } from "../transformation/coordinate-transform";
import type { Member } from "../types/model.type";
import type { AssemblyMember } from "./member-assembly";

/**
 * A member, or a piece of one, with everything that does not depend on the loads. A member is
 * cut into pieces where nodes lie inside it (model nodes on it, generated shell-mesh nodes);
 * otherwise it is one piece.
 */
export interface SystemMember extends AssemblyMember {
  id: FeaId; // the model member's id
  /** Distance of the piece's start from the member's start (mm); 0 for a whole member. */
  offset: number;
  section: SectionProperties;
  length: number; // mm
  lambda: Matrix; // 3×3 direction cosines, rows = local 1, 2, 3
  /** True when any end DOF is released or tied by a spring. */
  hasReleases: boolean;
  /** Condenses a member's fixed-end forces for its end releases. */
  condenseFixedEndForces: CondensedMember["condenseFixedEndForces"];
  /** The member's own end displacements from its end nodes' (differ across releases). */
  memberEndDisplacements: CondensedMember["memberEndDisplacements"];
}

/** A model member and the pieces it is analysed as (one unless nodes lie inside it). */
export interface MemberGroup {
  id: FeaId;
  /** Indices of its pieces among all pieces, from the member's start to its end. */
  pieces: number[];
  section: SectionProperties;
  length: number; // mm, the whole member
  lambda: Matrix; // 3×3 direction cosines of the whole member
}

/**
 * Builds the pieces of every member of a model that passed `validateModel`: local axes,
 * transformation and local stiffness condensed for the end releases, which apply only at the
 * member's own ends. A member is one piece unless nodes lie inside it.
 *
 * @param members - Members, in model order; after `expandModel` each lists the model and
 *   generated nodes it passes through, in order from its start
 * @param nodes - The analysed nodes, generated mesh nodes included
 * @param nodeIndex - Map from node id to index into `nodes`
 * @returns `pieces` to assemble, and one `group` per member indexing its pieces
 */
export const prepareSystemMembers = (
  members: (Member & { through?: FeaId[] })[],
  nodes: FeaNode[],
  nodeIndex: Map<FeaId, number>,
): { pieces: SystemMember[]; groups: MemberGroup[] } => {
  const point = (id: FeaId): [number, number, number] => {
    const n = nodes[nodeIndex.get(id) as number];
    return [n.x, n.y, n.z];
  };
  const systemMembers: SystemMember[] = [];
  const memberGroups: MemberGroup[] = members.map((member) => {
    // pieces between the member's ends and the nodes inside it (see `expandModel`)
    const chain = [member.startNodeId, ...(member.through ?? []), member.endNodeId];
    const whole = memberAxes(point(member.startNodeId), point(member.endNodeId), member.angle ?? 0);
    const { E, G, A, I22, I33, J } = member.section;
    const pieces: number[] = [];
    let offset = 0;
    for (let k = 0; k + 1 < chain.length; k++) {
      const { length, lambda } =
        chain.length === 2
          ? whole
          : memberAxes(point(chain[k]), point(chain[k + 1]), member.angle ?? 0);
      // releases only at the member's own ends
      const releases = memberEndReleases({
        start: k === 0 ? member.releases?.start : undefined,
        end: k === chain.length - 2 ? member.releases?.end : undefined,
      });
      const condensed = condenseMember(
        beam3dLocalStiffnessRightHanded(E, G, A, I22, I33, J, length),
        releases,
      );
      pieces.push(systemMembers.length);
      systemMembers.push({
        id: member.id,
        offset,
        section: member.section,
        startIndex: nodeIndex.get(chain[k]) as number,
        endIndex: nodeIndex.get(chain[k + 1]) as number,
        T: transformationMatrix(lambda),
        k: condensed.k,
        hasReleases: releases.length > 0,
        condenseFixedEndForces: condensed.condenseFixedEndForces,
        memberEndDisplacements: condensed.memberEndDisplacements,
        length,
        lambda,
      });
      offset += length;
    }
    return {
      id: member.id,
      pieces,
      section: member.section,
      length: whole.length,
      lambda: whole.lambda,
    };
  });
  return { pieces: systemMembers, groups: memberGroups };
};
