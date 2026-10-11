import { matMul, transpose, type Matrix } from "@app-utils/matrix";

export interface AssemblyMember {
  startIndex: number; // node index
  endIndex: number; // node index
  T: Matrix; // 12×12 global → local
  k: Matrix; // 12×12 local stiffness, right-hand, N and mm
}

/** Global DOF numbers (6 per node) of a member's 12 end DOFs. */
export const memberDofs = (member: Pick<AssemblyMember, "startIndex" | "endIndex">): number[] => {
  const dofs: number[] = [];
  for (const node of [member.startIndex, member.endIndex]) {
    for (let k = 0; k < 6; k++) dofs.push(6 * node + k);
  }
  return dofs;
};

/** A member's stiffness in global axes, `Tᵀ·k·T` (N and mm). */
export const memberGlobalStiffness = (member: AssemblyMember): Matrix =>
  matMul(transpose(member.T), matMul(member.k, member.T));

/**
 * Adds `sign · Tᵀ·f` of one member's local end-force vector to a global vector (N and N·mm).
 * With `sign = −1` and fixed-end forces this adds the equivalent nodal loads; with `sign = +1`
 * and `k·u` it adds the member's elastic end forces.
 */
export const scatterMemberForces = (
  target: number[],
  member: Pick<AssemblyMember, "startIndex" | "endIndex" | "T">,
  localForces: number[],
  sign: 1 | -1,
): void => {
  const dofs = memberDofs(member);
  for (let a = 0; a < 12; a++) {
    let value = 0;
    for (let j = 0; j < 12; j++) value += member.T[j][a] * localForces[j];
    target[dofs[a]] += sign * value;
  }
};
