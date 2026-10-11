import { EQUILIBRIUM_TOLERANCE } from "@app-core/constants/frame.constant";
import type { Warnings } from "@app-core/types/output-message.type";
import { roundToDecimalPlaces } from "@app-utils/math";
import { matVec } from "@app-utils/matrix";

import type { FrameSystem } from "../solver/frame-system";
import { memberDofs } from "../solver/global-assembly";
import type { RawState } from "../solver/load-case-solver";
import type { FrameCaseResult, MemberDiagram, MemberEndForce } from "../types/results.type";
import { memberDiagram } from "./member-diagram";

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
 * The presented diagram of member `m` in a raw state.
 *
 * @param stations - Evenly spaced stations
 * @param withStations - false keeps only the extremes (empty `stations`)
 */
export const presentMemberDiagram = (
  system: FrameSystem,
  state: RawState,
  m: number,
  stations?: number,
  withStations = true,
): MemberDiagram => {
  const member = system.members[m];
  return memberDiagram(
    member,
    state.memberForces[m].slice(0, 6),
    matVec(
      member.T,
      memberDofs(member).map((d) => state.U[d]),
    ),
    state.memberLoads[m],
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

  const mm = (v: number) => roundToDecimalPlaces(v, DISPLACEMENT_DECIMALS) + 0;
  const rad = (v: number) => roundToDecimalPlaces(v, ROTATION_DECIMALS) + 0;

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
    memberEndForces: system.members.map((member, m) => ({
      memberId: member.id,
      start: endForce(state.memberForces[m].slice(0, 6)),
      end: endForce(state.memberForces[m].slice(6, 12)),
    })),
    memberDiagrams: system.members.map((_, m) =>
      presentMemberDiagram(system, state, m, diagram.stations, diagram.withStations ?? true),
    ),
    equilibriumResidual: {
      force: roundToDecimalPlaces(residual.force, 8),
      moment: roundToDecimalPlaces(residual.moment, 8),
    },
    warnings,
  };
};
