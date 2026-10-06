import { EQUILIBRIUM_TOLERANCE, SINGULARITY_TOLERANCE } from "@app-core/constants/frame.constant";
import { FrameAnalysisError, FrameErrors } from "@app-core/errors/frame-analysis.error";
import type { Warnings } from "@app-core/types/output-message.type";
import { roundToDecimalPlaces } from "@app-utils/math";
import { choleskySolve, matVec } from "@app-utils/matrix";

import { beam3dLocalStiffnessRightHanded } from "../elements/beam-3d-stiffness";
import { fixedEndForces, type LocalMemberLoad } from "../elements/fixed-end-forces";
import { condenseMember, type CondensedMember } from "../elements/static-condensation";
import { memberDiagram } from "../post/member-diagram";
import { memberAxes, transformationMatrix } from "../transformation/coordinate-transform";
import type {
  FrameId,
  FrameModel,
  LoadDirection,
  Member,
  MemberEndRelease,
  MemberLoad,
} from "../types/model.type";
import type { FrameResult, MemberEndForce } from "../types/results.type";
import { buildBoundaryConditions } from "./boundary-conditions";
import { assembleGlobal, memberDofs, type AssemblyMember } from "./global-assembly";

export interface AnalyzeFrameOptions {
  /** Number of evenly spaced stations per member diagram (default 21). */
  stations?: number;
}

const RELEASE_KEYS = ["u1", "u2", "u3", "r1", "r2", "r3"] as const;
const FORCE_DECIMALS = 4;
const DISPLACEMENT_DECIMALS = 5;
const ROTATION_DECIMALS = 8;

const releasedIndices = (release: MemberEndRelease | undefined, offset: number): number[] =>
  RELEASE_KEYS.flatMap((key, k) => (release?.[key] ? [offset + k] : []));

const GLOBAL_DIRECTIONS: Record<"X" | "Y" | "Z", [number, number, number]> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
};

/** Resolves a member load into local-axis loads in N and mm. */
const toLocalLoads = (load: MemberLoad, lambda: number[][], L: number): LocalMemberLoad[] => {
  const components = (direction: LoadDirection): { axis: 1 | 2 | 3; factor: number }[] => {
    if (direction === "1" || direction === "2" || direction === "3") {
      return [{ axis: Number(direction) as 1 | 2 | 3, factor: 1 }];
    }
    const v = GLOBAL_DIRECTIONS[direction];
    return ([1, 2, 3] as const)
      .map((axis) => ({
        axis,
        factor:
          lambda[axis - 1][0] * v[0] + lambda[axis - 1][1] * v[1] + lambda[axis - 1][2] * v[2],
      }))
      .filter((c) => Math.abs(c.factor) > 1e-12);
  };

  return components(load.direction).map(({ axis, factor }) =>
    load.type === "udl"
      ? {
          type: "udl",
          axis,
          w: load.w * factor, // kN/m = N/mm
          start: load.start ?? 0,
          end: load.end ?? L,
        }
      : { type: "point", axis, P: load.P * factor * 1e3, a: load.a },
  );
};

const checkUnique = (ids: FrameId[]) => {
  if (new Set(ids).size !== ids.length) throw new FrameAnalysisError(FrameErrors.DUPLICATE_ID);
};

const roundForce = (value: number, factor: number) =>
  roundToDecimalPlaces(value * factor, FORCE_DECIMALS) + 0; // + 0 turns -0 into 0

const endForce = (f: number[]): MemberEndForce => ({
  f1: roundForce(f[0], 1e-3),
  f2: roundForce(f[1], 1e-3),
  f3: roundForce(f[2], 1e-3),
  m1: roundForce(f[3], 1e-6),
  m2: roundForce(f[4], 1e-6),
  m3: roundForce(f[5], 1e-6),
});

/**
 * Analyses a 3D frame by the direct stiffness method (linear elastic, small displacements).
 *
 * Units: node coordinates, section properties and positions in mm and MPa; loads in kN, kN·m
 * and kN/m; springs in kN/mm and kN·m/rad. Results are in kN, kN·m, mm and rad. Global axes
 * X, Y, Z are right-handed with Z up; members use ETABS-style local axes 1, 2, 3 (see
 * `memberAxes`). Member end forces and diagrams use right-hand rotations about the local axes.
 *
 * @param model - Nodes, members, restraints and loads of one load case
 * @param options - Diagram station count
 * @returns Displacements, reactions, member end forces and diagrams, `units` and `warnings`
 * @throws {FrameAnalysisError} 301–308 for an invalid model or an unstable structure
 */
export const analyzeFrame = (model: FrameModel, options: AnalyzeFrameOptions = {}): FrameResult => {
  const { nodes, members, restraints } = model;
  const nodalLoads = model.nodalLoads ?? [];
  const memberLoads = model.memberLoads ?? [];
  const warnings: Warnings = [];

  // ---- Validation -------------------------------------------------------------------
  checkUnique(nodes.map((n) => n.id));
  checkUnique(members.map((m) => m.id));
  checkUnique(restraints.map((r) => r.nodeId));

  const nodeIndex = new Map<FrameId, number>(nodes.map((n, i) => [n.id, i]));
  const memberById = new Map<FrameId, Member>(members.map((m) => [m.id, m]));
  const requireNode = (id: FrameId) => {
    if (!nodeIndex.has(id)) throw new FrameAnalysisError(FrameErrors.UNKNOWN_NODE_REFERENCE);
  };

  for (const member of members) {
    requireNode(member.startNodeId);
    requireNode(member.endNodeId);
    const { E, G, A, I22, I33, J } = member.section;
    if (![E, G, A, I22, I33, J].every((v) => Number.isFinite(v) && v > 0)) {
      throw new FrameAnalysisError(FrameErrors.INVALID_SECTION_PROPERTIES);
    }
  }
  restraints.forEach((r) => requireNode(r.nodeId));
  nodalLoads.forEach((l) => requireNode(l.nodeId));
  for (const load of memberLoads) {
    if (!memberById.has(load.memberId))
      throw new FrameAnalysisError(FrameErrors.UNKNOWN_NODE_REFERENCE);
  }

  const dofCount = 6 * nodes.length;
  const boundary = buildBoundaryConditions(restraints, nodeIndex, dofCount);
  if (!boundary.restrained.some(Boolean)) throw new FrameAnalysisError(FrameErrors.NO_RESTRAINTS);

  // ---- Member matrices --------------------------------------------------------------
  interface PreparedMember extends AssemblyMember {
    id: FrameId;
    length: number;
    localLoads: LocalMemberLoad[];
    condensed: CondensedMember;
  }
  const prepared: PreparedMember[] = members.map((member) => {
    const start = nodes[nodeIndex.get(member.startNodeId) as number];
    const end = nodes[nodeIndex.get(member.endNodeId) as number];
    const { length, lambda } = memberAxes(
      [start.x, start.y, start.z],
      [end.x, end.y, end.z],
      member.angle ?? 0,
    );
    const { E, G, A, I22, I33, J } = member.section;
    const k = beam3dLocalStiffnessRightHanded(E, G, A, I22, I33, J, length);
    const localLoads = memberLoads
      .filter((load) => load.memberId === member.id)
      .flatMap((load) => toLocalLoads(load, lambda, length));
    const fixed = fixedEndForces(localLoads, length);
    const condensed = condenseMember(k, fixed, [
      ...releasedIndices(member.releases?.start, 0),
      ...releasedIndices(member.releases?.end, 6),
    ]);
    return {
      id: member.id,
      startIndex: nodeIndex.get(member.startNodeId) as number,
      endIndex: nodeIndex.get(member.endNodeId) as number,
      T: transformationMatrix(lambda),
      k: condensed.k,
      fixedEndForces: condensed.fixedEndForces,
      length,
      localLoads,
      condensed,
    };
  });

  // ---- Assembly ---------------------------------------------------------------------
  const { K, memberLoadVector } = assembleGlobal(prepared, dofCount);
  const F = [...memberLoadVector];
  for (const load of nodalLoads) {
    const base = 6 * (nodeIndex.get(load.nodeId) as number);
    [load.fx, load.fy, load.fz].forEach((v, k) => (F[base + k] += (v ?? 0) * 1e3));
    [load.mx, load.my, load.mz].forEach((v, k) => (F[base + 3 + k] += (v ?? 0) * 1e6));
  }

  // ---- Solve ------------------------------------------------------------------------
  const free = boundary.fixed.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  const U = new Array<number>(dofCount).fill(0);
  if (free.length > 0) {
    const Kff = free.map((r) => free.map((c) => K[r][c] + (r === c ? boundary.spring[r] : 0)));
    const solution = choleskySolve(
      Kff,
      free.map((i) => F[i]),
      SINGULARITY_TOLERANCE,
    );
    if (!solution) throw new FrameAnalysisError(FrameErrors.STRUCTURE_UNSTABLE);
    free.forEach((dof, i) => (U[dof] = solution[i]));
  }

  // ---- Recovery ---------------------------------------------------------------------
  const KU = matVec(K, U);
  const R = KU.map((v, i) => (boundary.restrained[i] ? v - F[i] : 0));

  const memberEndForces = prepared.map((member) => {
    const dofs = memberDofs(member);
    const uLocal = matVec(
      member.T,
      dofs.map((d) => U[d]),
    );
    const f = matVec(member.k, uLocal).map((v, i) => v + member.fixedEndForces[i]);
    return { member, f };
  });

  const memberDiagrams = memberEndForces.map(({ member, f }) =>
    memberDiagram(member.id, f.slice(0, 6), member.localLoads, member.length, options.stations),
  );

  // ---- Equilibrium check ------------------------------------------------------------
  const total = { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 };
  let loadScale = 0;
  nodes.forEach((node, n) => {
    const q = (k: number) => F[6 * n + k] + R[6 * n + k]; // applied + reaction
    const fx = q(0);
    const fy = q(1);
    const fz = q(2);
    total.fx += fx;
    total.fy += fy;
    total.fz += fz;
    total.mx += q(3) + node.y * fz - node.z * fy;
    total.my += q(4) + node.z * fx - node.x * fz;
    total.mz += q(5) + node.x * fy - node.y * fx;
    loadScale += Math.abs(F[6 * n]) + Math.abs(F[6 * n + 1]) + Math.abs(F[6 * n + 2]);
  });
  const forceResidual = Math.hypot(total.fx, total.fy, total.fz) * 1e-3;
  const momentResidual = Math.hypot(total.mx, total.my, total.mz) * 1e-6;
  const span = Math.max(1, ...nodes.map((n) => Math.hypot(n.x, n.y, n.z)));
  if (
    forceResidual * 1e3 > EQUILIBRIUM_TOLERANCE * Math.max(loadScale, 1) ||
    momentResidual * 1e6 > EQUILIBRIUM_TOLERANCE * Math.max(loadScale, 1) * span
  ) {
    warnings.push({
      reference: "Frame analysis, global equilibrium check",
      message: `Global equilibrium residual is ${forceResidual.toExponential(2)} kN and ${momentResidual.toExponential(2)} kN·m; the stiffness matrix may be ill-conditioned.`,
    });
  }

  return {
    nodalDisplacements: nodes.map((node, n) => {
      const u = (k: number) => U[6 * n + k];
      const mm = (v: number) => roundToDecimalPlaces(v, DISPLACEMENT_DECIMALS) + 0;
      const rad = (v: number) => roundToDecimalPlaces(v, ROTATION_DECIMALS) + 0;
      return {
        nodeId: node.id,
        ux: mm(u(0)),
        uy: mm(u(1)),
        uz: mm(u(2)),
        rx: rad(u(3)),
        ry: rad(u(4)),
        rz: rad(u(5)),
      };
    }),
    reactions: nodes.map((node, n) => ({
      nodeId: node.id,
      fx: roundForce(R[6 * n], 1e-3),
      fy: roundForce(R[6 * n + 1], 1e-3),
      fz: roundForce(R[6 * n + 2], 1e-3),
      mx: roundForce(R[6 * n + 3], 1e-6),
      my: roundForce(R[6 * n + 4], 1e-6),
      mz: roundForce(R[6 * n + 5], 1e-6),
    })),
    memberEndForces: memberEndForces.map(({ member, f }) => ({
      memberId: member.id,
      start: endForce(f.slice(0, 6)),
      end: endForce(f.slice(6, 12)),
    })),
    memberDiagrams,
    calculationDetails: {
      nodeCount: nodes.length,
      memberCount: members.length,
      dofCount,
      freeDofCount: free.length,
      equilibriumResidual: {
        force: roundToDecimalPlaces(forceResidual, 8),
        moment: roundToDecimalPlaces(momentResidual, 8),
      },
    },
    units: { force: "kN", moment: "kN·m", length: "mm", rotation: "rad" },
    warnings,
  };
};
