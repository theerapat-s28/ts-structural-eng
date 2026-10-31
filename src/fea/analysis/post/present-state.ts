import { EQUILIBRIUM_TOLERANCE } from "@app-core/constants/frame.constant";
import type { Warnings } from "@app-core/types/output-message.type";
import { fixedEndForces } from "@app-fea/frame/elements/fixed-end-forces";
import { chainDiagram, memberDiagram } from "@app-fea/frame/post/member-diagram";
import { memberDofs } from "@app-fea/frame/solver/member-assembly";
import type {
  MemberDiagram,
  MemberEndForce,
  ReleaseDeformation,
} from "@app-fea/frame/types/results.type";
import { presentShellForces } from "@app-fea/shell/post/shell-forces";
import { roundToDecimalPlaces } from "@app-utils/math";
import { matVec } from "@app-utils/matrix";

import type { FrameSystem } from "../solver/frame-system";
import type { RawState } from "../solver/load-case-solver";
import type { FrameCaseResult } from "../types/results.type";

const FORCE_DECIMALS = 4;
const DISPLACEMENT_DECIMALS = 5;
const ROTATION_DECIMALS = 8;

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

const mm = (v: number) => roundToDecimalPlaces(v, DISPLACEMENT_DECIMALS) + 0;
const rad = (v: number) => roundToDecimalPlaces(v, ROTATION_DECIMALS) + 0;

/** Node minus member displacement at one end (6 local terms, mm and rad). */
const releaseDeformation = (d: number[]): ReleaseDeformation => ({
  u1: mm(d[0]),
  u2: mm(d[1]),
  u3: mm(d[2]),
  r1: rad(d[3]),
  r2: rad(d[4]),
  r3: rad(d[5]),
});

/**
 * The 12 local displacements of member `m`'s end nodes and the member's own end displacements
 * (which differ across released or spring DOFs), mm and rad.
 */
const memberEnd = (system: FrameSystem, state: RawState, m: number) => {
  const member = system.members[m];
  const node = matVec(
    member.T,
    memberDofs(member).map((d) => state.U[d]),
  );
  const own = member.hasReleases
    ? member.memberEndDisplacements(node, fixedEndForces(state.memberLoads[m], member.length))
    : node;
  return { node, own };
};

/** Global force and moment residual of applied loads plus reactions, in kN and kN·m. */
const equilibrium = (system: FrameSystem, state: RawState) => {
  const { F, R } = state;
  const total = { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 };
  let loadScale = 0;
  system.nodes.forEach((node, n) => {
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
  const span = Math.max(1, ...system.nodes.map((n) => Math.hypot(n.x, n.y, n.z)));
  const force = Math.hypot(total.fx, total.fy, total.fz); // N
  const moment = Math.hypot(total.mx, total.my, total.mz); // N·mm
  const scale = Math.max(loadScale, 1);
  return {
    force: force * 1e-3,
    moment: moment * 1e-6,
    exceeded:
      force > EQUILIBRIUM_TOLERANCE * scale || moment > EQUILIBRIUM_TOLERANCE * scale * span,
  };
};

/**
 * The presented diagram of model member `g` (an index into `system.memberGroups`) in a raw
 * state, stitched from its pieces when the shell mesh splits it.
 *
 * @param stations - Evenly spaced stations
 * @param withStations - false keeps only the extremes (empty `stations`)
 */
export const presentMemberDiagram = (
  system: FrameSystem,
  state: RawState,
  g: number,
  stations?: number,
  withStations = true,
): MemberDiagram => {
  const group = system.memberGroups[g];
  if (group.pieces.length === 1) {
    const m = group.pieces[0];
    return memberDiagram(
      system.members[m],
      state.memberForces[m].slice(0, 6),
      memberEnd(system, state, m).own,
      state.memberLoads[m],
      stations,
      withStations,
    );
  }
  return chainDiagram(
    group.id,
    group.length,
    group.pieces.map((m) => ({
      member: system.members[m],
      offset: system.members[m].offset,
      startForce: state.memberForces[m].slice(0, 6),
      endDisplacements: memberEnd(system, state, m).own,
      loads: state.memberLoads[m],
    })),
    stations,
    withStations,
  );
};

/**
 * Rounds a raw state into the presented result of one load case or combination.
 *
 * @param diagram - Evenly spaced station count, and whether to return stations or only extremes
 */
export const presentState = (
  system: FrameSystem,
  state: RawState,
  meta: Pick<FrameCaseResult, "id" | "kind" | "name" | "type">,
  diagram: { stations?: number; withStations?: boolean } = {},
): FrameCaseResult => {
  const { U, R } = state;
  const warnings: Warnings = [];

  const residual = equilibrium(system, state);
  if (residual.exceeded) {
    warnings.push({
      reference: "Frame analysis, global equilibrium check",
      message: `Global equilibrium residual is ${residual.force.toExponential(2)} kN and ${residual.moment.toExponential(2)} kN·m; the stiffness matrix may be ill-conditioned.`,
    });
  }

  return {
    ...meta,
    nodalDisplacements: system.nodes.map((node, n) => ({
      nodeId: node.id,
      ux: mm(U[6 * n]),
      uy: mm(U[6 * n + 1]),
      uz: mm(U[6 * n + 2]),
      rx: rad(U[6 * n + 3]),
      ry: rad(U[6 * n + 4]),
      rz: rad(U[6 * n + 5]),
    })),
    reactions: system.nodes.map((node, n) => ({
      nodeId: node.id,
      fx: roundForce(R[6 * n], 1e-3),
      fy: roundForce(R[6 * n + 1], 1e-3),
      fz: roundForce(R[6 * n + 2], 1e-3),
      mx: roundForce(R[6 * n + 3], 1e-6),
      my: roundForce(R[6 * n + 4], 1e-6),
      mz: roundForce(R[6 * n + 5], 1e-6),
    })),
    // a member split by the shell mesh: its start is its first piece's, its end its last's
    memberEndForces: system.memberGroups.map(({ id, pieces }) => ({
      memberId: id,
      start: endForce(state.memberForces[pieces[0]].slice(0, 6)),
      end: endForce(state.memberForces[pieces[pieces.length - 1]].slice(6, 12)),
    })),
    releaseDeformations: system.memberGroups.flatMap(({ id, pieces }) => {
      const [first, last] = [pieces[0], pieces[pieces.length - 1]];
      if (!system.members[first].hasReleases && !system.members[last].hasReleases) return [];
      const jump = (m: number) => {
        const { node, own } = memberEnd(system, state, m);
        return node.map((v, i) => v - own[i]);
      };
      return [
        {
          memberId: id,
          start: releaseDeformation(jump(first).slice(0, 6)),
          end: releaseDeformation(jump(last).slice(6, 12)),
        },
      ];
    }),
    memberDiagrams: system.memberGroups.map((_, g) =>
      presentMemberDiagram(system, state, g, diagram.stations, diagram.withStations ?? true),
    ),
    shellForces: system.shells.map((shell, s) =>
      presentShellForces(
        shell,
        shell.nodeIndices.map((n) => system.nodes[n].id),
        state.shellForces[s],
      ),
    ),
    equilibriumResidual: {
      force: roundToDecimalPlaces(residual.force, 8),
      moment: roundToDecimalPlaces(residual.moment, 8),
    },
    warnings,
  };
};
