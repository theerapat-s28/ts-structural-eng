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
import { condenseMember } from "../elements/static-condensation";
import { memberAxes, transformationMatrix } from "../transformation/coordinate-transform";
import type { FrameId, FrameModel, FrameNode, MemberEndRelease } from "../types/model.type";
import { frameIssue, throwIssues } from "../validation/validate-model";
import { buildBoundaryConditions, type BoundaryConditions } from "./boundary-conditions";
import { memberDofs, memberGlobalStiffness, type AssemblyMember } from "./global-assembly";

const RELEASE_KEYS = ["u1", "u2", "u3", "r1", "r2", "r3"] as const;
const DOF_NAMES = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;

const releasedIndices = (release: MemberEndRelease | undefined, offset: number): number[] =>
  RELEASE_KEYS.flatMap((key, k) => (release?.[key] ? [offset + k] : []));

/** A member with everything that does not depend on the loads. */
export interface SystemMember extends AssemblyMember {
  id: FrameId;
  section: SectionProperties;
  length: number; // mm
  lambda: Matrix; // 3×3 direction cosines, rows = local 1, 2, 3
  released: boolean[]; // 12 local end DOFs
  /** Condenses a member's fixed-end forces for its end releases. */
  condenseFixedEndForces: (fixed: number[]) => number[];
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
  /** Skyline Cholesky factor of the free stiffness including springs; null when nothing is free. */
  factor: SkylineMatrix | null;
  /** Stored entries of the factor (a measure of bandwidth, memory and work). */
  profileSize: number;
}

/**
 * Builds the member matrices of a model that passed `validateFrameModel`, assembles the free
 * stiffness in skyline storage with nodes in reverse Cuthill–McKee order, and factorises it
 * once for all load cases.
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
    const releasedDofs = [
      ...releasedIndices(member.releases?.start, 0),
      ...releasedIndices(member.releases?.end, 6),
    ];
    const condensed = condenseMember(
      beam3dLocalStiffnessRightHanded(E, G, A, I22, I33, J, length),
      releasedDofs,
    );
    return {
      id: member.id,
      section: member.section,
      startIndex: nodeIndex.get(member.startNodeId) as number,
      endIndex: nodeIndex.get(member.endNodeId) as number,
      T: transformationMatrix(lambda),
      k: condensed.k,
      condenseFixedEndForces: condensed.condenseFixedEndForces,
      released: Array.from({ length: 12 }, (_, i) => releasedDofs.includes(i)),
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
    systemMembers.forEach((m, index) => {
      const kGlobal = memberGlobalStiffness(m);
      const eqs = memberEquations[index];
      // a member's 12 DOFs are distinct, so each unordered pair and each diagonal is added once
      for (let a = 0; a < 12; a++) {
        if (eqs[a] < 0) continue;
        for (let b = 0; b < 12; b++) {
          if (eqs[b] >= eqs[a]) skylineAdd(K, eqs[a], eqs[b], kGlobal[a][b]);
        }
      }
    });
    free.forEach((dof, e) => {
      if (boundary.spring[dof] > 0) skylineAdd(K, e, e, boundary.spring[dof]);
    });

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
    factor,
    profileSize: factor ? skylineSize(factor) : 0,
  };
};
