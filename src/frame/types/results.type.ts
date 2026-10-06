import type { Warnings } from "@app-core/types/output-message.type";
import type { FrameId } from "./model.type";

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

/** Internal forces at a distance `x` from the member start; N is positive in tension. */
export interface MemberStation {
  x: number; // mm
  N: number; // kN
  V2: number; // kN
  V3: number; // kN
  T: number; // kN·m
  M2: number; // kN·m
  M3: number; // kN·m, positive when it causes tension on the local +2 face's opposite side (sagging for local 2 up)
}

export type StationComponent = "N" | "V2" | "V3" | "T" | "M2" | "M3";

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

export interface FrameResult {
  nodalDisplacements: NodalDisplacement[];
  reactions: NodalReaction[];
  memberEndForces: MemberEndForces[];
  memberDiagrams: MemberDiagram[];
  calculationDetails: {
    nodeCount: number;
    memberCount: number;
    dofCount: number;
    freeDofCount: number;
    equilibriumResidual: { force: number; moment: number }; // kN, kN·m
  };
  units: { force: "kN"; moment: "kN·m"; length: "mm"; rotation: "rad" };
  warnings: Warnings;
}
