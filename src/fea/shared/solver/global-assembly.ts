import type { Matrix } from "@app-utils/matrix";

/**
 * A stiffness contribution to the global system: the nodes it connects and its stiffness over
 * their DOFs (6 per node, in node order) in global axes. A member is a 2-node element; elements
 * with more nodes assemble the same way.
 */
export interface StiffnessElement {
  nodes: number[]; // node indices, all distinct
  kGlobal: Matrix; // 6n×6n, global axes, N and mm
}

/** Global DOF numbers (6 per node, in node order) of an element connecting `nodes`. */
export const elementDofs = (nodes: readonly number[]): number[] => {
  const dofs: number[] = [];
  for (const node of nodes) {
    for (let k = 0; k < 6; k++) dofs.push(6 * node + k);
  }
  return dofs;
};
