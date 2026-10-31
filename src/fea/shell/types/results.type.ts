import type { FrameId, FrameNode } from "@app-fea/shared/types/model.type";

/**
 * Forces per unit width and face stresses at one corner of a shell element, in the shell's
 * local axes 1, 2, 3. Membrane forces are positive in tension. M11 (M22) is the moment that
 * stresses along local 1 (2), positive when it puts the −3 face in tension (sagging with local
 * 3 up), as M3 of a member; V13 = −(∂M11/∂x₁ + ∂M12/∂x₂), as V2 = −dM3/dx. Top is the +3 face.
 */
export interface ShellCornerForces {
  nodeId: FrameId;
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
 * generated when it meshed the area (see `FrameResult.mesh`).
 */
export interface ShellElementForces {
  shellId: FrameId;
  areaId: FrameId;
  corners: ShellCornerForces[];
}

/** The shell elements analysed, and the nodes the engine generated to mesh them. */
export interface FrameMesh {
  /** Generated nodes, in global coordinates (mm); empty when no area was subdivided. */
  nodes: FrameNode[];
  /** Every shell element, in model order of their areas, with its four corner nodes. */
  shells: { id: FrameId; areaId: FrameId; nodeIds: FrameId[] }[];
}
