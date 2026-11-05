import { SINGULARITY_TOLERANCE } from "@app-core/constants/fea.constant";
import { FeaErrors } from "@app-core/errors/fea.error";
import { fixedEndForces, type LocalMemberLoad } from "@app-fea/frame/elements/fixed-end-forces";
import { memberDofs, scatterMemberForces } from "@app-fea/frame/solver/member-assembly";
import { memberPieceLoads, scaleMemberLoad } from "@app-fea/frame/solver/member-loads";
import type { MemberLoad } from "@app-fea/frame/types/model.type";
import { elementDofs } from "@app-fea/shared/solver/global-assembly";
import type { AreaLoad } from "@app-fea/shared/types/model.type";
import { modelIssue, throwIssues } from "@app-fea/shared/validation/issues";
import { shellRawForces } from "@app-fea/shell/post/shell-forces";
import { addShellLoads } from "@app-fea/shell/solver/shell-loads";
import { matVec } from "@app-utils/matrix";
import { skylineSolve } from "@app-utils/skyline";

import type { LoadCase, NodalLoad } from "../types/model.type";
import type { AnalysisSystem } from "./analysis-system";

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

/**
 * Solves one load case against the prepared, factorised system.
 *
 * Members take their loads and self-weight as fixed-end forces (see `memberPieceLoads`); shells
 * take their area loads and self-weight as forces at their corners (see `addShellLoads`).
 *
 * @param loadCase - The load case (id and self-weight multiplier)
 * @param loads - The nodal and member loads tagged with this load case, and its area loads on
 *   shell areas
 *
 * @throws {FeaError} 304 if a load has a moment about a joint rotation that nothing
 *   resists (an auto-restrained axis), 308 for a load outside its member, 313 if self-weight is
 *   requested for a member without `unitWeight`
 */
export const solveLoadCase = (
  system: AnalysisSystem,
  loadCase: LoadCase,
  loads: { nodalLoads: NodalLoad[]; memberLoads: MemberLoad[]; shellLoads?: AreaLoad[] },
): RawState => {
  const { members, dofCount, boundary, equation, free, factor, nodeIndex, memberIndex } = system;
  const F = new Array<number>(dofCount).fill(0);

  const selfWeight = loadCase.selfWeight ?? 0;
  const memberLoads = memberPieceLoads(
    system.memberGroups,
    members,
    memberIndex,
    loads.memberLoads,
    loadCase.id,
    selfWeight,
  );
  const fixed = members.map((member, m) => {
    const condensed = member.condenseFixedEndForces(fixedEndForces(memberLoads[m], member.length));
    scatterMemberForces(F, member, condensed, -1);
    return condensed;
  });

  // Shell surface loads as forces at the element corners
  addShellLoads(F, system.shells, system.shellsByArea, loads.shellLoads ?? [], selfWeight);

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
        modelIssue(FeaErrors.STRUCTURE_UNSTABLE, {
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
        factor === 0 ? [] : state.memberLoads[m].map((l) => scaleMemberLoad(l, factor)),
      ),
    ),
  };
};
