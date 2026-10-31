import { SINGULARITY_TOLERANCE } from "@app-core/constants/frame.constant";
import { FrameAnalysisError, FrameErrors } from "@app-core/errors/frame-analysis.error";
import { matVec, type Matrix } from "@app-utils/matrix";
import { skylineSolve } from "@app-utils/skyline";

import { fixedEndForces, loadIntensity, type LocalMemberLoad } from "../elements/fixed-end-forces";
import { shellRawForces } from "../post/shell-forces";
import type { AreaLoad, LoadCase, LoadDirection, MemberLoad, NodalLoad } from "../types/model.type";
import { frameIssue, throwIssues } from "../validation/validate-model";
import type { FrameSystem } from "./frame-system";
import { elementDofs, memberDofs, scatterMemberForces } from "./global-assembly";

/**
 * Unrounded result of one load case or combination, in N and mm. Every field is linear in the
 * loads, so combinations are formed by factoring and adding states.
 */
export interface RawState {
  U: number[]; // global displacements
  R: number[]; // reactions at restrained DOFs, 0 elsewhere
  F: number[]; // applied global load vector (nodal + equivalent member loads)
  memberForces: number[][]; // per member, 12 local right-hand end forces
  shellForces: number[][]; // per shell, 8 corner forces × 4 corners (see `shellRawForces`)
  memberLoads: LocalMemberLoad[][]; // per member, local loads (for the diagrams)
}

const GLOBAL_DIRECTIONS: Record<"X" | "Y" | "Z", [number, number, number]> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
};

/** Resolves a member load into local-axis loads in N and mm. */
const toLocalLoads = (load: MemberLoad, lambda: Matrix, L: number): LocalMemberLoad[] => {
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

  if (load.type === "torque") {
    // kN·m/m = 10³ N·mm/mm
    return [{ type: "torque", t: load.t * 1e3, start: load.start ?? 0, end: load.end ?? L }];
  }
  // per projected length → per member length: Lproj / L = |local 1 × d| = √(1 − (local 1 · d)²)
  let projection = 1;
  if (load.type !== "point" && load.projected) {
    const v = GLOBAL_DIRECTIONS[load.direction as "X" | "Y" | "Z"];
    const c = lambda[0][0] * v[0] + lambda[0][1] * v[1] + lambda[0][2] * v[2];
    projection = Math.sqrt(Math.max(0, 1 - c * c));
  }
  return components(load.direction).map(({ axis, factor }): LocalMemberLoad => {
    if (load.type === "point") return { type: "point", axis, P: load.P * factor * 1e3, a: load.a };
    const [w1, w2] = load.type === "udl" ? [load.w, load.w] : [load.w1, load.w2];
    return {
      type: "distributed",
      axis,
      w1: w1 * factor * projection, // kN/m = N/mm
      w2: w2 * factor * projection,
      start: load.start ?? 0,
      end: load.end ?? L,
    };
  });
};

/**
 * The part of a member's local loads that falls on one of its pieces, `[offset, offset + L]`,
 * in the piece's own positions. A distributed load or torque is cut at the piece ends; a point
 * load goes to the piece it lies in (at an interior node, to the piece that starts there).
 */
const clipLoads = (
  loads: LocalMemberLoad[],
  offset: number,
  L: number,
  last: boolean,
): LocalMemberLoad[] => {
  const end = offset + L;
  const tolerance = 1e-9 * end;
  const out: LocalMemberLoad[] = [];
  for (const load of loads) {
    if (load.type === "point") {
      const inside = load.a >= offset - tolerance && (load.a < end - tolerance || last);
      if (inside) out.push({ ...load, a: Math.min(L, Math.max(0, load.a - offset)) });
      continue;
    }
    const from = Math.max(load.start, offset);
    const to = Math.min(load.end, end);
    if (to - from <= tolerance) continue;
    if (load.type === "torque") {
      out.push({ ...load, start: from - offset, end: to - offset });
    } else {
      out.push({
        ...load,
        w1: loadIntensity(load, from),
        w2: loadIntensity(load, to),
        start: from - offset,
        end: to - offset,
      });
    }
  }
  return out;
};

/**
 * Solves one load case against the prepared, factorised system.
 *
 * Self-weight is `selfWeight · unitWeight · A` per unit member length along global −Z.
 *
 * @param loadCase - The load case (id and self-weight multiplier)
 * @param loads - The nodal and member loads tagged with this load case
 *
 * Shell areas take `selfWeight · unitWeight · thickness · modifiers.weight` per unit area along
 * −Z and their `AreaLoad`s as forces at their corners, each corner the share `∫ Nᵢ dA` of the
 * element's area on its mean plane (no corner moments, so a warped element's offsets do not load
 * the rotations auto-restraint holds).
 *
 * @param loads - The nodal and member loads tagged with this load case, and its area loads on
 *   shell areas
 *
 * @throws {FrameAnalysisError} 304 if a load has a moment about a joint rotation that nothing
 *   resists (an auto-restrained axis), 308 for a load outside its member, 313 if self-weight is
 *   requested for a member without `unitWeight`
 */
export const solveLoadCase = (
  system: FrameSystem,
  loadCase: LoadCase,
  loads: { nodalLoads: NodalLoad[]; memberLoads: MemberLoad[]; shellLoads?: AreaLoad[] },
): RawState => {
  const { members, dofCount, boundary, equation, free, factor, nodeIndex, memberIndex } = system;
  const F = new Array<number>(dofCount).fill(0);

  const groups = system.memberGroups;
  const loadsByMember: MemberLoad[][] = groups.map(() => []);
  for (const load of loads.memberLoads) {
    loadsByMember[memberIndex.get(load.memberId) as number].push(load);
  }

  const selfWeight = loadCase.selfWeight ?? 0;
  // local loads of each model member, then of each piece it is analysed as
  const memberLoads: LocalMemberLoad[][] = members.map(() => []);
  groups.forEach((group, g) => {
    const memberLoadsHere = [...loadsByMember[g]];
    if (selfWeight !== 0) {
      const { unitWeight, A } = group.section;
      if (unitWeight === undefined) throw new FrameAnalysisError(FrameErrors.MISSING_UNIT_WEIGHT);
      // kN/m³ · m² = kN/m
      const w = -selfWeight * unitWeight * A * 1e-6;
      if (w !== 0) {
        memberLoadsHere.push({
          loadCase: loadCase.id,
          type: "udl",
          memberId: group.id,
          direction: "Z",
          w,
        });
      }
    }
    const local = memberLoadsHere.flatMap((load) => toLocalLoads(load, group.lambda, group.length));
    if (group.pieces.length === 1) {
      memberLoads[group.pieces[0]] = local;
      return;
    }
    group.pieces.forEach((p, k) => {
      const piece = members[p];
      memberLoads[p] = clipLoads(local, piece.offset, piece.length, k === group.pieces.length - 1);
    });
  });

  const fixed = members.map((member, m) => {
    const condensed = member.condenseFixedEndForces(fixedEndForces(memberLoads[m], member.length));
    scatterMemberForces(F, member, condensed, -1);
    return condensed;
  });

  // Shell surface loads, kN/m² as a global vector per shell, then N at the corners
  const shellPressure = system.shells.map((): [number, number, number] => [0, 0, 0]);
  for (const load of loads.shellLoads ?? []) {
    // every element of the area
    for (const s of system.shellsByArea.get(load.areaId) ?? []) {
      const normal = system.shells[s].element.axes.lambda[2];
      const e = load.direction === "3" ? normal : GLOBAL_DIRECTIONS[load.direction];
      // per projected area → per true area: Aproj / A = |n · e|
      const q = load.projected
        ? load.q * Math.abs(normal[0] * e[0] + normal[1] * e[1] + normal[2] * e[2])
        : load.q;
      for (let k = 0; k < 3; k++) shellPressure[s][k] += q * e[k];
    }
  }
  system.shells.forEach((shell, s) => {
    if (selfWeight !== 0) {
      // kN/m³ · mm · 10⁻³ = kN/m²
      const { unitWeight = 0, thickness } = shell.section;
      shellPressure[s][2] -=
        selfWeight * unitWeight * thickness * (shell.modifiers.weight ?? 1) * 1e-3;
    }
    const p = shellPressure[s];
    if (p[0] === 0 && p[1] === 0 && p[2] === 0) return;
    shell.nodeIndices.forEach((node, i) => {
      // kN/m² = 10⁻³ N/mm², times mm²
      for (let k = 0; k < 3; k++) F[6 * node + k] += p[k] * 1e-3 * shell.cornerAreas[i];
    });
  });

  for (const load of loads.nodalLoads) {
    const base = 6 * (nodeIndex.get(load.nodeId) as number);
    [load.fx, load.fy, load.fz].forEach((v, k) => (F[base + k] += (v ?? 0) * 1e3));
    [load.mx, load.my, load.mz].forEach((v, k) => (F[base + 3 + k] += (v ?? 0) * 1e6));
  }

  // A held rotation axis is decoupled from the structure: a moment about it has no load path.
  let momentScale = 0;
  for (let n = 0; n < system.nodes.length; n++) {
    for (let k = 3; k < 6; k++) momentScale = Math.max(momentScale, Math.abs(F[6 * n + k]));
  }
  for (const { node, axis } of system.autoRestraints) {
    const moment = axis.reduce((sum, a, i) => sum + a * F[6 * node + 3 + i], 0);
    if (Math.abs(moment) > SINGULARITY_TOLERANCE * momentScale) {
      const lead = axis.reduce((best, a, i) => (Math.abs(a) > Math.abs(axis[best]) ? i : best), 0);
      throwIssues([
        frameIssue(FrameErrors.STRUCTURE_UNSTABLE, {
          nodeId: system.nodes[node].id,
          dof: (["rx", "ry", "rz"] as const)[lead],
          loadCaseId: loadCase.id,
        }),
      ]);
    }
  }

  const U = new Array<number>(dofCount).fill(0);
  if (factor) {
    const solution = skylineSolve(
      factor,
      free.map((dof) => F[dof]),
    );
    free.forEach((dof) => (U[dof] = solution[equation[dof]]));
  }

  // Elastic end forces k·u per member; their global sum is K·U, from which R = K·U − F
  const KU = new Array<number>(dofCount).fill(0);
  const memberForces = members.map((member, m) => {
    const uLocal = matVec(
      member.T,
      memberDofs(member).map((d) => U[d]),
    );
    const elastic = matVec(member.k, uLocal);
    scatterMemberForces(KU, member, elastic, 1);
    return elastic.map((v, i) => v + fixed[m][i]);
  });
  for (const shell of system.shells) {
    const dofs = elementDofs(shell.nodeIndices);
    const forces = matVec(
      shell.element.kGlobal,
      dofs.map((d) => U[d]),
    );
    dofs.forEach((d, a) => (KU[d] += forces[a]));
  }
  const R = KU.map((v, i) => (boundary.restrained[i] ? v - F[i] : 0));

  const shellForces = system.shells.map((shell) => shellRawForces(shell, U));

  return { U, R, F, memberForces, shellForces, memberLoads };
};

const scaleLoad = (load: LocalMemberLoad, factor: number): LocalMemberLoad => {
  if (load.type === "distributed") return { ...load, w1: load.w1 * factor, w2: load.w2 * factor };
  if (load.type === "torque") return { ...load, t: load.t * factor };
  return { ...load, P: load.P * factor };
};

/** Superposes factored states: `Σ factor × state`. Member loads are concatenated, scaled. */
export const combineStates = (terms: { state: RawState; factor: number }[]): RawState => {
  const first = terms[0].state;
  const add = (pick: (s: RawState) => number[], length: number) => {
    const out = new Array<number>(length).fill(0);
    for (const { state, factor } of terms) {
      pick(state).forEach((v, i) => (out[i] += factor * v));
    }
    return out;
  };
  return {
    U: add((s) => s.U, first.U.length),
    R: add((s) => s.R, first.R.length),
    F: add((s) => s.F, first.F.length),
    memberForces: first.memberForces.map((_, m) => add((s) => s.memberForces[m], 12)),
    shellForces: first.shellForces.map((f, sh) => add((s) => s.shellForces[sh], f.length)),
    memberLoads: first.memberLoads.map((_, m) =>
      terms.flatMap(({ state, factor }) =>
        factor === 0 ? [] : state.memberLoads[m].map((l) => scaleLoad(l, factor)),
      ),
    ),
  };
};
