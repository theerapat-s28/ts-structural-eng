export type FrameId = string | number;

export interface FrameNode {
  id: FrameId;
  x: number; // mm, global X
  y: number; // mm, global Y
  z: number; // mm, global Z (up)
}

/** A restrained DOF: `true` is fixed, a number is a spring stiffness, omitted/`false` is free. */
export type DofRestraint = boolean | number;

export interface Restraint {
  nodeId: FrameId;
  ux?: DofRestraint; // true | kN/mm
  uy?: DofRestraint; // true | kN/mm
  uz?: DofRestraint; // true | kN/mm
  rx?: DofRestraint; // true | kN·m/rad
  ry?: DofRestraint; // true | kN·m/rad
  rz?: DofRestraint; // true | kN·m/rad
}

/** Area load direction: the area's local normal "3" or a global axis. */
export type AreaLoadDirection = "3" | "X" | "Y" | "Z";

/**
 * Uniform load on a null area or a shell area. `q` is per unit true area, or with
 * `projected: true` (global directions only) per unit area projected onto the plane normal to
 * `direction`, e.g. per plan area on a ramp; it is then applied as `q · |n · direction|` on
 * the true area. A null area sends it to the members along its edges; a shell area takes it
 * as forces at its corners, each corner the share `∫ Nᵢ dA` of its area.
 */
export interface AreaLoad {
  loadCase: string; // id of the load case this load belongs to
  areaId: FrameId;
  direction: AreaLoadDirection;
  q: number; // kN/m², positive along the positive direction axis
  projected?: boolean; // q per unit projected area (global directions only); default false
}
