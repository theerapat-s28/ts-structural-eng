import type { SectionProperties } from "@app-core/types/section-properties.type";

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

/** Local end DOFs of a member that transmit no force (hinges, rollers…). */
export interface MemberEndRelease {
  u1?: boolean; // axial
  u2?: boolean; // shear in local 2
  u3?: boolean; // shear in local 3
  r1?: boolean; // torsion
  r2?: boolean; // moment about local 2
  r3?: boolean; // moment about local 3
}

export interface Member {
  id: FrameId;
  startNodeId: FrameId;
  endNodeId: FrameId;
  section: SectionProperties;
  angle?: number; // rad, rotation of local 2 and 3 about local 1 (right-hand rule); default 0
  releases?: { start?: MemberEndRelease; end?: MemberEndRelease };
}

export interface NodalLoad {
  loadCase: string; // id of the load case this load belongs to
  nodeId: FrameId;
  fx?: number; // kN, global X
  fy?: number; // kN, global Y
  fz?: number; // kN, global Z
  mx?: number; // kN·m, about global X
  my?: number; // kN·m, about global Y
  mz?: number; // kN·m, about global Z
}

/** Load direction: local member axes "1", "2", "3" or global axes "X", "Y", "Z". */
export type LoadDirection = "1" | "2" | "3" | "X" | "Y" | "Z";

/** Uniform load per unit length of member, along the whole member or from `start` to `end`. */
export interface UniformMemberLoad {
  loadCase: string; // id of the load case this load belongs to
  type: "udl";
  memberId: FrameId;
  direction: LoadDirection;
  w: number; // kN/m, positive along the positive direction axis
  start?: number; // mm from the member start (default 0)
  end?: number; // mm from the member start (default member length)
}

export interface PointMemberLoad {
  loadCase: string; // id of the load case this load belongs to
  type: "point";
  memberId: FrameId;
  direction: LoadDirection;
  P: number; // kN, positive along the positive direction axis
  a: number; // mm from the member start
}

export type MemberLoad = UniformMemberLoad | PointMemberLoad;

/** Descriptive category of a load case; it labels the case and does not change the analysis. */
export type LoadCaseType =
  | "dead"
  | "superDead"
  | "live"
  | "roofLive"
  | "snow"
  | "wind"
  | "seismic"
  | "other";

/**
 * One independently analysed set of loads, e.g. dead, superimposed dead or live. The loads
 * themselves are listed in `FrameModel.nodalLoads` and `FrameModel.memberLoads`, each tagged
 * with its `loadCase`.
 */
export interface LoadCase {
  id: string;
  name?: string;
  type?: LoadCaseType;
  /**
   * Self-weight multiplier (1 = full self-weight). Applies `selfWeight · unitWeight · A` per unit
   * length of every member along global −Z. Default 0.
   */
  selfWeight?: number;
}

/** One term of a load combination: a factor times a load case or another combination. */
export type CombinationTerm =
  | { case: string; factor: number }
  | { combination: string; factor: number };

/** A linear combination (sum of factored terms) of load cases and other combinations. */
export interface LoadCombination {
  id: string;
  name?: string;
  terms: CombinationTerm[];
}

export interface FrameModel {
  nodes: FrameNode[];
  members: Member[];
  restraints: Restraint[];
  loadCases: LoadCase[];
  /** Nodal loads of every load case, each tagged with its `loadCase`. */
  nodalLoads?: NodalLoad[];
  /** Member loads of every load case, each tagged with its `loadCase`. */
  memberLoads?: MemberLoad[];
  combinations?: LoadCombination[];
}
