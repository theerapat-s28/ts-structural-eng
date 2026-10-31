import type { FrameId } from "@app-fea/shared/types/model.type";

/**
 * How a shell area carries load: in its plane and in bending (`"shell"`), in its plane only
 * (`"membrane"`: u1, u2 and the rotation about local 3), or in bending only (`"plate"`: u3 and
 * the rotations about local 1 and 2).
 */
export type ShellType = "shell" | "membrane" | "plate";

/** Material and thickness of a shell area. */
export interface ShellSection {
  thickness: number; // mm
  E: number; // MPa
  nu: number; // Poisson's ratio, 0 ≤ nu < 0.5
  unitWeight?: number; // kN/m³, needed for self-weight
}

/**
 * Stiffness modifiers of a shell area along its local axes 1 and 2 (default 1 each), e.g. for
 * cracked walls and slabs: f11, f22, f12 scale the membrane rigidity and m11, m22, m12 the
 * bending rigidity (each matrix becomes S·D·S, S = diag(√f11, √f22, √f12)); weight scales the
 * self-weight only.
 */
export interface ShellModifiers {
  f11?: number;
  f22?: number;
  f12?: number;
  m11?: number;
  m22?: number;
  m12?: number;
  weight?: number;
}

/**
 * How the engine meshes a shell area: `maxSize` (mm) is the largest element side wanted;
 * `divisions` the least number of elements along edges 0–1 and 1–2 (from `nodeIds[0]` to
 * `nodeIds[1]` and from `nodeIds[1]` to `nodeIds[2]`). Counts may grow so that areas sharing an
 * edge, or meeting it at a node, share their mesh nodes.
 */
export interface ShellMesh {
  maxSize?: number;
  divisions?: [number, number];
}

/**
 * A four-node flat shell area: a drilling-rotation membrane and a thin (DKQ) plate, built on
 * the mean plane of its corners. Without `mesh` it is one element, unless a neighbour's mesh or
 * a node lying on its edge forces divisions. Local axis 3 is the normal by the
 * right-hand rule around `nodeIds`; local 2 is +Z projected onto the plane (upward on a wall)
 * and local 1 = 2 × 3 is horizontal, except on a horizontal shell, where local 1 = +X.
 * `angle` rotates local 1 and 2 about local 3. Its id shares one namespace with null areas, so
 * `AreaLoad` can load it.
 */
export interface ShellArea {
  id: FrameId;
  nodeIds: FrameId[]; // 4 corner nodes, in order around the area
  type?: ShellType; // default "shell"
  section: ShellSection;
  angle?: number; // rad, rotation of local 1 and 2 about local 3 (right-hand rule); default 0
  modifiers?: ShellModifiers;
  mesh?: ShellMesh;
}
