import { matMul, transpose, type Matrix } from "@app-utils/matrix";

/**
 * A stiffness contribution to the global system: the nodes it connects and its stiffness over
 * their DOFs (6 per node, in node order) in global axes. A member is a 2-node element; elements
 * with more nodes assemble the same way.
 */
export interface StiffnessElement {
  nodes: number[]; // node indices, all distinct
  kGlobal: Matrix; // 6n×6n, global axes, N and mm
}

export interface AssemblyMember {
  startIndex: number; // node index
  endIndex: number; // node index
  T: Matrix; // 12×12 global → local
  k: Matrix; // 12×12 local stiffness, right-hand, N and mm
}

/** Global DOF numbers (6 per node, in node order) of an element connecting `nodes`. */
export const elementDofs = (nodes: readonly number[]): number[] => {
  const dofs: number[] = [];
  for (const node of nodes) {
    for (let k = 0; k < 6; k++) dofs.push(6 * node + k);
  }
  return dofs;
};

/** Global DOF numbers (6 per node) of a member's 12 end DOFs. */
export const memberDofs = (member: Pick<AssemblyMember, "startIndex" | "endIndex">): number[] =>
  elementDofs([member.startIndex, member.endIndex]);

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
