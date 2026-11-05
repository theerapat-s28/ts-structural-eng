import type { FeaId } from "@app-fea/shared/types/model.type";

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
  id: FeaId;
  nodeIds: FeaId[]; // 4 corner nodes, in order around the area
  type?: ShellType; // default "shell"
  section: ShellSection;
  angle?: number; // rad, rotation of local 1 and 2 about local 3 (right-hand rule); default 0
  modifiers?: ShellModifiers;
  mesh?: ShellMesh;
}

/** A point in global axes (mm). */
export interface StripPoint {
  x: number; // mm, global X
  y: number; // mm, global Y
  z: number; // mm, global Z
}

/**
 * A design strip across shell elements, drawn as a centreline polyline with a width on each
 * side, for which `analyze` integrates the shell forces across the strip at stations along it
 * (see `StripForces`). The strip lies in the plane through its points normal to `normal`, and
 * picks up every shell element in that plane (each corner within `STRIP_PLANE_TOLERANCE` of the
 * element's longest side from it); elements off the plane, such as walls, are ignored.
 *
 * Strip axes, per segment: 1 along the segment, 3 = `normal` (up for a floor slab), 2 = 3 × 1
 * across the strip, pointing to its left seen from +3. A strip adds nothing to the analysis
 * and changes no other result.
 */
export interface ShellStrip {
  id: FeaId;
  /** Centreline points (at least 2), in order along the strip, in one plane normal to `normal`. */
  points: StripPoint[];
  widthLeft: number; // mm, from the centreline along +2 (left, seen from +3)
  widthRight: number; // mm, from the centreline along −2
  /** Strip axis 3 in global components; need not be unit. Default [0, 0, 1]. */
  normal?: [number, number, number];
  /**
   * Largest distance between stations along a segment (mm). Default: each segment in
   * `STRIP_DEFAULT_DIVISIONS` (20) equal parts.
   */
  maxSpacing?: number;
}
