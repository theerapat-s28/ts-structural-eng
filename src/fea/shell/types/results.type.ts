import type { FeaId, FeaNode } from "@app-fea/shared/types/model.type";

/**
 * Forces per unit width and face stresses at one corner of a shell element, in the shell's
 * local axes 1, 2, 3. Membrane forces are positive in tension. M11 (M22) is the moment that
 * stresses along local 1 (2), positive when it puts the −3 face in tension (sagging with local
 * 3 up), as M3 of a member; V13 = −(∂M11/∂x₁ + ∂M12/∂x₂), as V2 = −dM3/dx. Top is the +3 face.
 */
export interface ShellCornerForces {
  nodeId: FeaId;
  F11: number; // kN/m, membrane force along local 1
  F22: number; // kN/m, membrane force along local 2
  F12: number; // kN/m, membrane shear
  M11: number; // kN·m/m
  M22: number; // kN·m/m
  M12: number; // kN·m/m, twisting moment
  V13: number; // kN/m, transverse shear on the 1-face
  V23: number; // kN/m, transverse shear on the 2-face
  S11Top: number; // MPa, F11/t − 6·M11/t²
  S22Top: number; // MPa
  S12Top: number; // MPa
  S11Bot: number; // MPa, F11/t + 6·M11/t²
  S22Bot: number; // MPa
  S12Bot: number; // MPa
}

/** A force or stress component of `ShellCornerForces`. */
export type ShellForceComponent = Exclude<keyof ShellCornerForces, "nodeId">;

/**
 * Forces of one shell element at its four corners, in its node order. `shellId` is the shell
 * area's id when the area is one element, and `"<areaId>:<i>,<j>"` for the elements the engine
 * generated when it meshed the area (see `FeaResult.mesh`).
 */
export interface ShellElementForces {
  shellId: FeaId;
  areaId: FeaId;
  corners: ShellCornerForces[];
}

/** The shell elements analysed, and the nodes the engine generated to mesh them. */
export interface FeaMesh {
  /** Generated nodes, in global coordinates (mm); empty when no area was subdivided. */
  nodes: FeaNode[];
  /** Every shell element, in model order of their areas, with its four corner nodes. */
  shells: { id: FeaId; areaId: FeaId; nodeIds: FeaId[] }[];
}

/**
 * Resultants on a strip's cut, in strip axes 1 (along), 2 (across, left) and 3 (normal), acting
 * on the face whose outward normal is +1, as a member's internal forces:
 *
 * - `P` axial force along 1, positive in tension (kN)
 * - `V` transverse shear along 3, `V = −dM/dx` as V2 of a member (kN)
 * - `M` bending moment, positive sagging: tension on the −3 face (kN·m)
 * - `T` torsion about 1, right-hand rule, including the moment of `V` about the centreline (kN·m)
 * - `Vp` in-plane shear along 2 (kN)
 * - `Mp` in-plane moment about 3, right-hand rule, positive with tension on the right (−2)
 *   side (kN·m)
 */
export interface StripResultants {
  P: number;
  V: number;
  M: number;
  T: number;
  Vp: number;
  Mp: number;
}

/** A strip resultant. */
export type StripForceComponent = keyof StripResultants;

/** The resultants on one cut across a strip. */
export interface StripStation extends StripResultants {
  /** Distance along the strip's centreline from its first point (mm). */
  x: number;
  /** The cut's centre on the centreline, global X, Y, Z (mm). */
  point: [number, number, number];
  /**
   * Strip segment the cut is normal to (0 = first point to second). A bend has two stations at
   * the same `x`: the end of one segment and the start of the next.
   */
  segment: number;
  /** Length of the cut that lies on shells in the strip's plane (mm); the full width when covered. */
  width: number;
  /** The resultants divided by `width`: kN/m and kN·m/m; all 0 where `width` is 0. */
  perWidth: StripResultants;
}

/** Max or min of a strip resultant along the strip, with the station's `x`. */
export interface StripExtremeValue {
  value: number;
  x: number; // mm
}

/** Forces of one strip in one load case or combination. */
export interface StripForces {
  stripId: FeaId;
  /** In order along the strip: the stations of each segment, its end points included. */
  stations: StripStation[];
  /** Max and min of each total resultant over the stations. */
  extremes: Record<StripForceComponent, { max: StripExtremeValue; min: StripExtremeValue }>;
}
