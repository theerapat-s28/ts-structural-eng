import type { Warnings } from "@app-core/types/output-message.type";
import type { FrameId, LoadCaseType } from "./model.type";

export interface NodalDisplacement {
  nodeId: FrameId;
  ux: number; // mm
  uy: number; // mm
  uz: number; // mm
  rx: number; // rad
  ry: number; // rad
  rz: number; // rad
}

export interface NodalReaction {
  nodeId: FrameId;
  fx: number; // kN
  fy: number; // kN
  fz: number; // kN
  mx: number; // kN·m
  my: number; // kN·m
  mz: number; // kN·m
}

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
  memberId: FrameId;
  start: MemberEndForce;
  end: MemberEndForce;
}

/**
 * Internal forces and displacements at a distance `x` from the member start. Forces act on
 * the positive (+1) face of the cut; N is positive in tension. Displacements include the
 * rigid-body motion of the member, so at the ends they equal the node displacements (except
 * across a released translation).
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
  memberId: FrameId;
  length: number; // mm
  stations: MemberStation[];
  extremes: Record<StationComponent, { max: ExtremeValue; min: ExtremeValue }>;
}

/** Max or min of a result across combinations, with the combination that produces it. */
export interface GoverningValue {
  value: number;
  combinationId: string;
}

export interface GoverningExtremeValue extends GoverningValue {
  x: number; // mm from the member start
}

export type Bound<T> = { max: T; min: T };

/** Results of one load case or one load combination. */
export interface FrameCaseResult {
  id: string;
  kind: "case" | "combination";
  name?: string;
  type?: LoadCaseType; // load cases only
  nodalDisplacements: NodalDisplacement[];
  reactions: NodalReaction[];
  memberEndForces: MemberEndForces[];
  memberDiagrams: MemberDiagram[];
  equilibriumResidual: { force: number; moment: number }; // kN, kN·m
  warnings: Warnings;
}

/** Max/min of every result across a set of combinations, with the governing combination. */
export interface FrameEnvelope {
  combinationIds: string[];
  nodalDisplacements: ({ nodeId: FrameId } & Record<
    "ux" | "uy" | "uz" | "rx" | "ry" | "rz",
    Bound<GoverningValue>
  >)[];
  reactions: ({ nodeId: FrameId } & Record<
    "fx" | "fy" | "fz" | "mx" | "my" | "mz",
    Bound<GoverningValue>
  >)[];
  members: {
    memberId: FrameId;
    extremes: Record<StationComponent, Bound<GoverningExtremeValue>>;
  }[];
}

export interface FrameResult {
  cases: Record<string, FrameCaseResult>;
  combinations: Record<string, FrameCaseResult>;
  /** Envelope over all combinations; absent when the model has none. */
  envelope?: FrameEnvelope;
  calculationDetails: {
    nodeCount: number;
    memberCount: number;
    dofCount: number;
    freeDofCount: number;
    profileSize: number; // stored entries of the banded stiffness factor (memory / work measure)
    loadCaseCount: number;
    combinationCount: number;
  };
  units: { force: "kN"; moment: "kN·m"; length: "mm"; rotation: "rad" };
  warnings: Warnings;
}
