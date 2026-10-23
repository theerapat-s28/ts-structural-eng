import { FrameAnalysisError, FrameErrors } from "@app-core/errors/frame-analysis.error";
import { matVec, type Matrix } from "@app-utils/matrix";
import { skylineSolve } from "@app-utils/skyline";

import { fixedEndForces, type LocalMemberLoad } from "../elements/fixed-end-forces";
import type { LoadCase, LoadDirection, MemberLoad, NodalLoad } from "../types/model.type";
import type { FrameSystem } from "./frame-system";
import { memberDofs, scatterMemberForces } from "./global-assembly";

/**
 * Unrounded result of one load case or combination, in N and mm. Every field is linear in the
 * loads, so combinations are formed by factoring and adding states.
 */
export interface RawState {
  U: number[]; // global displacements
  R: number[]; // reactions at restrained DOFs, 0 elsewhere
  F: number[]; // applied global load vector (nodal + equivalent member loads)
  memberForces: number[][]; // per member, 12 local right-hand end forces
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

  return components(load.direction).map(({ axis, factor }): LocalMemberLoad => {
    if (load.type === "point") return { type: "point", axis, P: load.P * factor * 1e3, a: load.a };
    const [w1, w2] = load.type === "udl" ? [load.w, load.w] : [load.w1, load.w2];
    return {
      type: "distributed",
      axis,
      w1: w1 * factor, // kN/m = N/mm
      w2: w2 * factor,
      start: load.start ?? 0,
      end: load.end ?? L,
    };
  });
};

/**
 * Solves one load case against the prepared, factorised system.
 *
 * Self-weight is `selfWeight · unitWeight · A` per unit member length along global −Z.
 *
 * @param loadCase - The load case (id and self-weight multiplier)
 * @param loads - The nodal and member loads tagged with this load case
 *
 * @throws {FrameAnalysisError} 308 for a load outside its member, 313 if self-weight is
 *   requested for a member without `unitWeight`
 */
export const solveLoadCase = (
  system: FrameSystem,
  loadCase: LoadCase,
  loads: { nodalLoads: NodalLoad[]; memberLoads: MemberLoad[] },
): RawState => {
  const { members, dofCount, boundary, equation, free, factor, nodeIndex, memberIndex } = system;
  const F = new Array<number>(dofCount).fill(0);

  const loadsByMember: MemberLoad[][] = members.map(() => []);
  for (const load of loads.memberLoads) {
    loadsByMember[memberIndex.get(load.memberId) as number].push(load);
  }

  const selfWeight = loadCase.selfWeight ?? 0;
  const memberLoads: LocalMemberLoad[][] = members.map((member, m) => {
    const memberLoadsHere = [...loadsByMember[m]];
    if (selfWeight !== 0) {
      const { unitWeight, A } = member.section;
      if (unitWeight === undefined) throw new FrameAnalysisError(FrameErrors.MISSING_UNIT_WEIGHT);
      // kN/m³ · m² = kN/m
      const w = -selfWeight * unitWeight * A * 1e-6;
      if (w !== 0) {
        memberLoadsHere.push({
          loadCase: loadCase.id,
          type: "udl",
          memberId: member.id,
          direction: "Z",
          w,
        });
      }
    }
    return memberLoadsHere.flatMap((load) => toLocalLoads(load, member.lambda, member.length));
  });

  const fixed = members.map((member, m) => {
    const condensed = member.condenseFixedEndForces(fixedEndForces(memberLoads[m], member.length));
    scatterMemberForces(F, member, condensed, -1);
    return condensed;
  });

  for (const load of loads.nodalLoads) {
    const base = 6 * (nodeIndex.get(load.nodeId) as number);
    [load.fx, load.fy, load.fz].forEach((v, k) => (F[base + k] += (v ?? 0) * 1e3));
    [load.mx, load.my, load.mz].forEach((v, k) => (F[base + 3 + k] += (v ?? 0) * 1e6));
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
  const R = KU.map((v, i) => (boundary.restrained[i] ? v - F[i] : 0));

  return { U, R, F, memberForces, memberLoads };
};

const scaleLoad = (load: LocalMemberLoad, factor: number): LocalMemberLoad =>
  load.type === "distributed"
    ? { ...load, w1: load.w1 * factor, w2: load.w2 * factor }
    : { ...load, P: load.P * factor };

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
    memberLoads: first.memberLoads.map((_, m) =>
      terms.flatMap(({ state, factor }) =>
        factor === 0 ? [] : state.memberLoads[m].map((l) => scaleLoad(l, factor)),
      ),
    ),
  };
};
