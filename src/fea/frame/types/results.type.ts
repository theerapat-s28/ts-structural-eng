import type { FeaId } from "@app-fea/shared/types/model.type";

/** Force the node exerts on one member end, in local axes 1, 2, 3 (right-hand rotations). */
export interface MemberEndForce {
  f1: number; // kN
  f2: number; // kN
  f3: number; // kN
  m1: number; // kN·m
  m2: number; // kN·m
  m3: number; // kN·m
}

export interface MemberEndForces {
  memberId: FeaId;
  start: MemberEndForce;
  end: MemberEndForce;
}

/**
 * Relative displacement across the release at one member end, node minus member, in local
 * axes 1, 2, 3 (right-hand rotations). 0 at rigidly connected DOFs. At a spring it equals the
 * end force divided by the spring stiffness.
 */
export interface ReleaseDeformation {
  u1: number; // mm
  u2: number; // mm
  u3: number; // mm
  r1: number; // rad
  r2: number; // rad
  r3: number; // rad
}

export interface MemberReleaseDeformations {
  memberId: FeaId;
  start: ReleaseDeformation;
  end: ReleaseDeformation;
}

/**
 * Internal forces and displacements at a distance `x` from the member start. Forces act on
 * the positive (+1) face of the cut; N is positive in tension. Displacements are the member's
 * own, including its rigid-body motion: at the ends they equal the node displacements except
 * across a released or spring end DOF (see `MemberReleaseDeformations`).
 */
export interface MemberStation {
  x: number; // mm
  N: number; // kN
  V2: number; // kN
  V3: number; // kN
  T: number; // kN·m
  M2: number; // kN·m
  M3: number; // kN·m, positive for sagging when local 2 points up
  u1: number; // mm, displacement along local 1
  u2: number; // mm, displacement along local 2
  u3: number; // mm, displacement along local 3
  ux: number; // mm, displacement along global X
  uy: number; // mm, displacement along global Y
  uz: number; // mm, displacement along global Z
}

/** Station components with extremes: internal forces and local displacements. */
export type StationComponent = "N" | "V2" | "V3" | "T" | "M2" | "M3" | "u1" | "u2" | "u3";

export interface ExtremeValue {
  value: number;
  x: number; // mm
}

export interface MemberDiagram {
  memberId: FeaId;
  length: number; // mm
  stations: MemberStation[];
  extremes: Record<StationComponent, { max: ExtremeValue; min: ExtremeValue }>;
}
