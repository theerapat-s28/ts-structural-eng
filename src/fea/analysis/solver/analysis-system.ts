import { SINGULARITY_TOLERANCE } from "@app-core/constants/frame.constant";
import { FeaErrors } from "@app-core/errors/fea.error";
import { memberGlobalStiffness } from "@app-fea/frame/solver/member-assembly";
import {
  prepareSystemMembers,
  type MemberGroup,
  type SystemMember,
} from "@app-fea/frame/solver/system-member";
import {
  findAutoRestraints,
  findUnresistedTranslations,
  type AutoRestraint,
} from "@app-fea/shared/solver/auto-restraint";
import {
  buildBoundaryConditions,
  type BoundaryConditions,
} from "@app-fea/shared/solver/boundary-conditions";
import { elementDofs, type StiffnessElement } from "@app-fea/shared/solver/global-assembly";
import type { FeaId, FeaNode } from "@app-fea/shared/types/model.type";
import { modelIssue, throwIssues } from "@app-fea/shared/validation/issues";
import { prepareSystemShells, type SystemShell } from "@app-fea/shell/solver/system-shell";
import type { ShellArea } from "@app-fea/shell/types/model.type";
import {
  createSkyline,
  reverseCuthillMcKee,
  skylineAdd,
  skylineFactor,
  skylineSize,
  type SkylineMatrix,
} from "@app-utils/skyline";

import type { FeaModel } from "../types/model.type";

const DOF_NAMES = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;

/** The load-independent part of an analysis: geometry, stiffness and its factorisation. */
export interface AnalysisSystem {
  nodes: FeaNode[];
  nodeIndex: Map<FeaId, number>;
  /** Index into `memberGroups` of each model member. */
  memberIndex: Map<FeaId, number>;
  /** Model members, in model order. */
  memberGroups: MemberGroup[];
  /** The pieces that are assembled: one per member unless nodes inside it split it. */
  members: SystemMember[];
  shellIndex: Map<FeaId, number>;
  /** Element indices of each shell area. */
  shellsByArea: Map<FeaId, number[]>;
  shells: SystemShell[];
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
 * Builds the member and shell matrices of a model that passed `validateModel`, assembles
 * the free stiffness in skyline storage with nodes in reverse Cuthill–McKee order, and
 * factorises it once for all load cases. Joint rotations that nothing resists (e.g. at truss
 * joints) are held by a spring along each null direction, which carries no force.
 *
 * @throws {FeaError} 328 if a node connected only to shells has a translation that
 *   nothing resists (a membrane's out-of-plane or a plate's in-plane direction), with `nodeId`,
 *   `shellId` and `dof`; 304 if the structure is a mechanism; `details` names a node and a DOF
 *   involved in it
 */
export const prepareAnalysisSystem = (model: FeaModel): AnalysisSystem => {
  const { nodes, members = [], restraints } = model;
  // shell elements: after `expandModel` they carry their area's id
  const shells = (model.shells ?? []) as (ShellArea & { areaId?: FeaId })[];
  const nodeIndex = new Map<FeaId, number>(nodes.map((n, i) => [n.id, i]));
  const memberIndex = new Map<FeaId, number>(members.map((m, i) => [m.id, i]));
  const shellIndex = new Map<FeaId, number>(shells.map((sh, i) => [sh.id, i]));
  const dofCount = 6 * nodes.length;
  const boundary = buildBoundaryConditions(restraints, nodeIndex, dofCount);

  const { pieces: systemMembers, groups: memberGroups } = prepareSystemMembers(
    members,
    nodes,
    nodeIndex,
  );
  const systemShells = prepareSystemShells(shells, nodes, nodeIndex);

  const shellsByArea = new Map<FeaId, number[]>();
  systemShells.forEach((sh, s) => {
    const list = shellsByArea.get(sh.areaId);
    if (list) list.push(s);
    else shellsByArea.set(sh.areaId, [s]);
  });

  // Everything that adds stiffness, as elements over 6 DOFs per node; members have 2 nodes
  const memberElements: StiffnessElement[] = systemMembers.map((m) => ({
    nodes: [m.startIndex, m.endIndex],
    kGlobal: memberGlobalStiffness(m),
  }));
  const shellElements: StiffnessElement[] = systemShells.map((sh) => ({
    nodes: sh.nodeIndices,
    kGlobal: sh.element.kGlobal,
  }));
  const elements = [...memberElements, ...shellElements];

  // ---- Translations no shell resists at nodes without members (membrane / plate only) --
  const memberNodes = new Set(systemMembers.flatMap((m) => [m.startIndex, m.endIndex]));
  const shellOnlyNodes = new Set(
    systemShells.flatMap((sh) => sh.nodeIndices).filter((n) => !memberNodes.has(n)),
  );
  const unresisted = findUnresistedTranslations(
    [...shellOnlyNodes].sort((a, b) => a - b), // issues in model order
    shellElements,
    boundary,
  );
  if (unresisted.length > 0) {
    throwIssues(
      unresisted.map(({ node, axis }) => {
        const lead = axis.reduce(
          (best, c, i) => (Math.abs(c) > Math.abs(axis[best]) ? i : best),
          0,
        );
        return modelIssue(FeaErrors.SHELL_DOF_UNSUPPORTED, {
          nodeId: nodes[node].id,
          shellId: systemShells.find((sh) => sh.nodeIndices.includes(node))?.id,
          dof: DOF_NAMES[lead],
        });
      }),
    );
  }

  // ---- Equation numbering: nodes in RCM order, fixed DOFs skipped ------------------
  const adjacency: number[][] = nodes.map(() => []);
  for (const element of memberElements) {
    for (const a of element.nodes) {
      for (const b of element.nodes) if (a !== b) adjacency[a].push(b);
    }
  }
  // shells share edges: add each neighbour once (members keep their own order unchanged)
  if (shellElements.length > 0) {
    const known = adjacency.map((list) => new Set(list));
    for (const element of shellElements) {
      for (const a of element.nodes) {
        for (const b of element.nodes) {
          if (a !== b && !known[a].has(b)) {
            known[a].add(b);
            adjacency[a].push(b);
          }
        }
      }
    }
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

  const autoRestraints = findAutoRestraints(nodes.length, elements, boundary);

  // ---- Profile, assembly and factorisation -----------------------------------------
  let factor: SkylineMatrix | null = null;
  if (free.length > 0) {
    const first = free.map((_, e) => e);
    const elementEquations = elements.map((el) => elementDofs(el.nodes).map((d) => equation[d]));
    for (const eqs of elementEquations) {
      const active = eqs.filter((e) => e >= 0);
      const low = Math.min(...active);
      for (const e of active) if (low < first[e]) first[e] = low;
    }

    const K = createSkyline(first);
    elementEquations.forEach((eqs, index) => {
      // an element's nodes, hence its DOFs, are distinct: each pair and diagonal is added once
      const k = elements[index].kGlobal;
      for (let a = 0; a < eqs.length; a++) {
        if (eqs[a] < 0) continue;
        for (let b = 0; b < eqs.length; b++) {
          if (eqs[b] >= eqs[a]) skylineAdd(K, eqs[a], eqs[b], k[a][b]);
        }
      }
    });
    free.forEach((dof, e) => {
      if (boundary.spring[dof] > 0) skylineAdd(K, e, e, boundary.spring[dof]);
    });
    // k·n·nᵀ on the node's free rotations, inside the profile: its elements span all 6 node DOFs
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
        modelIssue(FeaErrors.STRUCTURE_UNSTABLE, {
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
    memberGroups,
    members: systemMembers,
    shellIndex,
    shellsByArea,
    shells: systemShells,
    dofCount,
    boundary,
    equation,
    free,
    autoRestraints,
    factor,
    profileSize: factor ? skylineSize(factor) : 0,
  };
};
