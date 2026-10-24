import { SINGULARITY_TOLERANCE } from "@app-core/constants/frame.constant";
import { FrameErrors } from "@app-core/errors/frame-analysis.error";
import type { SectionProperties } from "@app-core/types/section-properties.type";
import type { Matrix } from "@app-utils/matrix";
import {
  createSkyline,
  reverseCuthillMcKee,
  skylineAdd,
  skylineFactor,
  skylineSize,
  type SkylineMatrix,
} from "@app-utils/skyline";

import { beam3dLocalStiffnessRightHanded } from "../elements/beam-3d-stiffness";
import { memberEndReleases } from "../elements/end-releases";
import { condenseMember, type CondensedMember } from "../elements/static-condensation";
import { memberAxes, transformationMatrix } from "../transformation/coordinate-transform";
import type { FrameId, FrameModel, FrameNode } from "../types/model.type";
import { frameIssue, throwIssues } from "../validation/validate-model";
import { findAutoRestraints, type AutoRestraint } from "./auto-restraint";
import { buildBoundaryConditions, type BoundaryConditions } from "./boundary-conditions";
import { memberDofs, memberGlobalStiffness, type AssemblyMember } from "./global-assembly";

const DOF_NAMES = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;

/** A member with everything that does not depend on the loads. */
export interface SystemMember extends AssemblyMember {
  id: FrameId;
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

/** The load-independent part of a frame analysis: geometry, stiffness and its factorisation. */
export interface FrameSystem {
  nodes: FrameNode[];
  nodeIndex: Map<FrameId, number>;
  memberIndex: Map<FrameId, number>;
  members: SystemMember[];
  dofCount: number;
  boundary: BoundaryConditions;
  /** Equation number of each global DOF in the factorised system, −1 for a fixed DOF. */
  equation: Int32Array;
  /** Global DOF of each equation. */
  free: number[];
  /** Joint rotations held because nothing resists them (see `findAutoRestraints`). */
  autoRestraints: AutoRestraint[];
  /** Skyline Cholesky factor of the free stiffness including springs; null when nothing is free. */
  factor: SkylineMatrix | null;
  /** Stored entries of the factor (a measure of bandwidth, memory and work). */
  profileSize: number;
}

/**
 * Builds the member matrices of a model that passed `validateFrameModel`, assembles the free
 * stiffness in skyline storage with nodes in reverse Cuthill–McKee order, and factorises it
 * once for all load cases. Joint rotations that no member resists (e.g. at truss joints) are
 * held by a spring along each null direction, which carries no force.
 *
 * @throws {FrameAnalysisError} 304 if the structure is a mechanism; `details` names a node and
 *   a DOF involved in it
 */
export const prepareFrameSystem = (model: FrameModel): FrameSystem => {
  const { nodes, members, restraints } = model;
  const nodeIndex = new Map<FrameId, number>(nodes.map((n, i) => [n.id, i]));
  const memberIndex = new Map<FrameId, number>(members.map((m, i) => [m.id, i]));
  const dofCount = 6 * nodes.length;
  const boundary = buildBoundaryConditions(restraints, nodeIndex, dofCount);

  const systemMembers: SystemMember[] = members.map((member) => {
    const start = nodes[nodeIndex.get(member.startNodeId) as number];
    const end = nodes[nodeIndex.get(member.endNodeId) as number];
    const { length, lambda } = memberAxes(
      [start.x, start.y, start.z],
      [end.x, end.y, end.z],
      member.angle ?? 0,
    );
    const { E, G, A, I22, I33, J } = member.section;
    const releases = memberEndReleases(member.releases);
    const condensed = condenseMember(
      beam3dLocalStiffnessRightHanded(E, G, A, I22, I33, J, length),
      releases,
    );
    return {
      id: member.id,
      section: member.section,
      startIndex: nodeIndex.get(member.startNodeId) as number,
      endIndex: nodeIndex.get(member.endNodeId) as number,
      T: transformationMatrix(lambda),
      k: condensed.k,
      hasReleases: releases.length > 0,
      condenseFixedEndForces: condensed.condenseFixedEndForces,
      memberEndDisplacements: condensed.memberEndDisplacements,
      length,
      lambda,
    };
  });

  // ---- Equation numbering: nodes in RCM order, fixed DOFs skipped ------------------
  const adjacency: number[][] = nodes.map(() => []);
  for (const m of systemMembers) {
    adjacency[m.startIndex].push(m.endIndex);
    adjacency[m.endIndex].push(m.startIndex);
  }
  const equation = new Int32Array(dofCount).fill(-1);
  const free: number[] = [];
  for (const node of reverseCuthillMcKee(adjacency)) {
    for (let k = 0; k < 6; k++) {
      const dof = 6 * node + k;
      if (!boundary.fixed[dof]) {
        equation[dof] = free.length;
        free.push(dof);
      }
    }
  }

  const kGlobal = systemMembers.map(memberGlobalStiffness);
  const autoRestraints = findAutoRestraints(
    nodes.length,
    systemMembers.map((m, i) => ({
      startIndex: m.startIndex,
      endIndex: m.endIndex,
      kGlobal: kGlobal[i],
    })),
    boundary,
  );

  // ---- Profile, assembly and factorisation -----------------------------------------
  let factor: SkylineMatrix | null = null;
  if (free.length > 0) {
    const first = free.map((_, e) => e);
    const memberEquations = systemMembers.map((m) => memberDofs(m).map((d) => equation[d]));
    for (const eqs of memberEquations) {
      const active = eqs.filter((e) => e >= 0);
      const low = Math.min(...active);
      for (const e of active) if (low < first[e]) first[e] = low;
    }

    const K = createSkyline(first);
    memberEquations.forEach((eqs, index) => {
      // a member's 12 DOFs are distinct, so each unordered pair and each diagonal is added once
      for (let a = 0; a < 12; a++) {
        if (eqs[a] < 0) continue;
        for (let b = 0; b < 12; b++) {
          if (eqs[b] >= eqs[a]) skylineAdd(K, eqs[a], eqs[b], kGlobal[index][a][b]);
        }
      }
    });
    free.forEach((dof, e) => {
      if (boundary.spring[dof] > 0) skylineAdd(K, e, e, boundary.spring[dof]);
    });
    // k·n·nᵀ on the node's free rotations, inside the profile: its members span all 6 node DOFs
    for (const { node, axis, stiffness } of autoRestraints) {
      for (let i = 0; i < 3; i++) {
        const ei = equation[6 * node + 3 + i];
        if (ei < 0) continue;
        for (let j = 0; j < 3; j++) {
          const ej = equation[6 * node + 3 + j];
          if (ej >= ei) skylineAdd(K, ei, ej, stiffness * axis[i] * axis[j]);
        }
      }
    }

    const result = skylineFactor(K, SINGULARITY_TOLERANCE);
    if (!result.ok) {
      const dof = free[result.failedPivot];
      throwIssues([
        frameIssue(FrameErrors.STRUCTURE_UNSTABLE, {
          nodeId: nodes[Math.floor(dof / 6)].id,
          dof: DOF_NAMES[dof % 6],
        }),
      ]);
    }
    factor = K;
  }

  return {
    nodes,
    nodeIndex,
    memberIndex,
    members: systemMembers,
    dofCount,
    boundary,
    equation,
    free,
    autoRestraints,
    factor,
    profileSize: factor ? skylineSize(factor) : 0,
  };
};
