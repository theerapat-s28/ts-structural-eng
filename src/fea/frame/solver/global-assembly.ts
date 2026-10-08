import { matMul, transpose, zeros, type Matrix } from "@app-utils/matrix";

export interface AssemblyMember {
  startIndex: number; // node index
  endIndex: number; // node index
  T: Matrix; // 12×12 global → local
  k: Matrix; // 12×12 local stiffness, right-hand, N and mm
  fixedEndForces: number[]; // 12, local, N and N·mm
}

/** Global DOF numbers (6 per node) of a member's 12 end DOFs. */
export const memberDofs = (member: Pick<AssemblyMember, "startIndex" | "endIndex">): number[] => {
  const dofs: number[] = [];
  for (const node of [member.startIndex, member.endIndex]) {
    for (let k = 0; k < 6; k++) dofs.push(6 * node + k);
  }
  return dofs;
};

/**
 * Assembles the global stiffness matrix `K += Tᵀ·k·T` and the equivalent member-load vector
 * `F -= Tᵀ·f_fixed` (N and N·mm).
 */
export const assembleGlobal = (
  members: AssemblyMember[],
  dofCount: number,
): { K: Matrix; memberLoadVector: number[] } => {
  const K = zeros(dofCount, dofCount);
  const memberLoadVector = new Array<number>(dofCount).fill(0);
  for (const member of members) {
    const Tt = transpose(member.T);
    const kGlobal = matMul(Tt, matMul(member.k, member.T));
    const fGlobal = Tt.map((row) => row.reduce((s, t, j) => s + t * member.fixedEndForces[j], 0));
    const dofs = memberDofs(member);
    for (let a = 0; a < 12; a++) {
      memberLoadVector[dofs[a]] -= fGlobal[a];
      for (let b = 0; b < 12; b++) K[dofs[a]][dofs[b]] += kGlobal[a][b];
    }
  }
  return { K, memberLoadVector };
};
