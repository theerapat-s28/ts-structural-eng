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
import { flatShellElement, type FlatShellElement } from "../elements/shell/flat-shell";
import { cornerAreas } from "../elements/shell/quad-geometry";
import type { Vec3 } from "../elements/shell/shell-axes";
import { condenseMember, type CondensedMember } from "../elements/static-condensation";
import { memberAxes, transformationMatrix } from "../transformation/coordinate-transform";
import type {
  FrameId,
  FrameModel,
  FrameNode,
  Member,
  ShellArea,
  ShellModifiers,
  ShellSection,
  ShellType,
} from "../types/model.type";
import { frameIssue, throwIssues } from "../validation/validate-model";
import {
  findAutoRestraints,
  findUnresistedTranslations,
  type AutoRestraint,
} from "./auto-restraint";
import { buildBoundaryConditions, type BoundaryConditions } from "./boundary-conditions";
import {
  elementDofs,
  memberGlobalStiffness,
  type AssemblyMember,
  type StiffnessElement,
} from "./global-assembly";

const DOF_NAMES = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;

/**
 * A member, or a piece of one, with everything that does not depend on the loads. A member is
 * cut into pieces where generated shell-mesh nodes lie inside it; otherwise it is one piece.
 */
export interface SystemMember extends AssemblyMember {
  id: FrameId; // the model member's id
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

/** A model member and the pieces it is analysed as (one unless the shell mesh splits it). */
export interface MemberGroup {
  id: FrameId;
  /** Indices into `FrameSystem.members`, from the member's start to its end. */
  pieces: number[];
  section: SectionProperties;
  length: number; // mm, the whole member
  lambda: Matrix; // 3×3 direction cosines of the whole member
}

/** A shell area with everything that does not depend on the loads. */
export interface SystemShell {
  id: FrameId;
  /** The shell area the element belongs to (its own id when the area is one element). */
  areaId: FrameId;
  nodeIndices: number[]; // the four corners, in the shell's order
  type: ShellType;
  section: ShellSection;
  modifiers: ShellModifiers;
  /** Axes, corner transformations and local and global stiffness. */
  element: FlatShellElement;
  /** ∫ Nᵢ dA of each corner on the mean plane (mm²): its share of a uniform surface load. */
  cornerAreas: number[];
}

/** The load-independent part of a frame analysis: geometry, stiffness and its factorisation. */
export interface FrameSystem {
  nodes: FrameNode[];
  nodeIndex: Map<FrameId, number>;
  /** Index into `memberGroups` of each model member. */
  memberIndex: Map<FrameId, number>;
  /** Model members, in model order. */
  memberGroups: MemberGroup[];
  /** The pieces that are assembled: one per member unless the shell mesh splits it. */
  members: SystemMember[];
  shellIndex: Map<FrameId, number>;
  /** Element indices of each shell area. */
  shellsByArea: Map<FrameId, number[]>;
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
 * Builds the member and shell matrices of a model that passed `validateFrameModel`, assembles
 * the free stiffness in skyline storage with nodes in reverse Cuthill–McKee order, and
 * factorises it once for all load cases. Joint rotations that nothing resists (e.g. at truss
 * joints) are held by a spring along each null direction, which carries no force.
 *
 * @throws {FrameAnalysisError} 328 if a node connected only to shells has a translation that
 *   nothing resists (a membrane's out-of-plane or a plate's in-plane direction), with `nodeId`,
 *   `shellId` and `dof`; 304 if the structure is a mechanism; `details` names a node and a DOF
 *   involved in it
 */
export const prepareFrameSystem = (model: FrameModel): FrameSystem => {
  const { nodes, members, restraints } = model;
  // shell elements: after `expandModel` they carry their area's id
  const shells = (model.shells ?? []) as (ShellArea & { areaId?: FrameId })[];
  const nodeIndex = new Map<FrameId, number>(nodes.map((n, i) => [n.id, i]));
  const memberIndex = new Map<FrameId, number>(members.map((m, i) => [m.id, i]));
  const shellIndex = new Map<FrameId, number>(shells.map((sh, i) => [sh.id, i]));
  const dofCount = 6 * nodes.length;
  const boundary = buildBoundaryConditions(restraints, nodeIndex, dofCount);

  const point = (id: FrameId): [number, number, number] => {
    const n = nodes[nodeIndex.get(id) as number];
    return [n.x, n.y, n.z];
  };
  const systemMembers: SystemMember[] = [];
  const memberGroups: MemberGroup[] = (members as (Member & { through?: FrameId[] })[]).map(
    (member) => {
      // pieces between the member's ends and the mesh nodes inside it (see `expandModel`)
      const chain = [member.startNodeId, ...(member.through ?? []), member.endNodeId];
      const whole = memberAxes(
        point(member.startNodeId),
        point(member.endNodeId),
        member.angle ?? 0,
      );
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
    },
  );

  const systemShells: SystemShell[] = shells.map((shell) => {
    const nodeIndices = shell.nodeIds.map((id) => nodeIndex.get(id) as number);
    const points = nodeIndices.map((n): Vec3 => [nodes[n].x, nodes[n].y, nodes[n].z]);
    const { thickness, E, nu } = shell.section;
    const m = shell.modifiers ?? {};
    const type = shell.type ?? "shell";
    const element = flatShellElement(
      points,
      {
        E,
        nu,
        t: thickness,
        type,
        membraneModifiers: [m.f11 ?? 1, m.f22 ?? 1, m.f12 ?? 1],
        bendingModifiers: [m.m11 ?? 1, m.m22 ?? 1, m.m12 ?? 1],
      },
      shell.angle ?? 0,
    );
    return {
      id: shell.id,
      areaId: shell.areaId ?? shell.id,
      nodeIndices,
      type,
      section: shell.section,
      modifiers: m,
      element,
      cornerAreas: cornerAreas(element.axes.corners),
    };
  });

  const shellsByArea = new Map<FrameId, number[]>();
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
        return frameIssue(FrameErrors.SHELL_DOF_UNSUPPORTED, {
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
