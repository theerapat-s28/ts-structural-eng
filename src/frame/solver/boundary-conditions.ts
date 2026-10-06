import type { DofRestraint, Restraint } from "../types/model.type";

const DOF_KEYS = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;

/** Spring stiffness unit conversion: kN/mm → N/mm, kN·m/rad → N·mm/rad. */
const SPRING_FACTOR = [1e3, 1e3, 1e3, 1e6, 1e6, 1e6];

export interface BoundaryConditions {
  fixed: boolean[]; // per global DOF
  spring: number[]; // per global DOF, N/mm or N·mm/rad (0 when none)
  restrained: boolean[]; // fixed or spring
}

const parse = (
  value: DofRestraint | undefined,
  factor: number,
): { fixed: boolean; spring: number } => {
  if (value === true) return { fixed: true, spring: 0 };
  if (typeof value === "number" && value > 0) return { fixed: false, spring: value * factor };
  return { fixed: false, spring: 0 };
};

/**
 * Collects restraints into per-DOF fixed flags and spring stiffnesses.
 *
 * @param restraints - Model restraints
 * @param nodeIndex - Map from node id to node index (6 DOFs per node)
 * @param dofCount - Total number of global DOFs
 */
export const buildBoundaryConditions = (
  restraints: Restraint[],
  nodeIndex: Map<Restraint["nodeId"], number>,
  dofCount: number,
): BoundaryConditions => {
  const fixed = new Array<boolean>(dofCount).fill(false);
  const spring = new Array<number>(dofCount).fill(0);
  for (const restraint of restraints) {
    const base = 6 * (nodeIndex.get(restraint.nodeId) as number);
    DOF_KEYS.forEach((key, k) => {
      const parsed = parse(restraint[key], SPRING_FACTOR[k]);
      if (parsed.fixed) fixed[base + k] = true;
      spring[base + k] = parsed.spring;
    });
  }
  const restrained = fixed.map((f, i) => f || spring[i] > 0);
  return { fixed, spring, restrained };
};
