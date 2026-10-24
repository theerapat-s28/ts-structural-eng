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

/**
 * How a member end DOF is tied to its node: `true` (or 0) is a full release that carries no
 * force, a positive number is a spring stiffness in series with the member end (partial
 * fixity), omitted/`false` is a rigid connection.
 */
export type DofRelease = boolean | number;

/** Local end DOFs of a member that are released (hinges, rollers…) or partially fixed. */
export interface MemberEndRelease {
  u1?: DofRelease; // axial: true | kN/mm
  u2?: DofRelease; // shear in local 2: true | kN/mm
  u3?: DofRelease; // shear in local 3: true | kN/mm
  r1?: DofRelease; // torsion: true | kN·m/rad
  r2?: DofRelease; // moment about local 2: true | kN·m/rad
  r3?: DofRelease; // moment about local 3: true | kN·m/rad
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

/**
 * Linearly varying load per unit length of member, from `w1` at `start` to `w2` at `end`
 * (triangular when one of them is 0).
 */
export interface TrapezoidalMemberLoad {
  loadCase: string; // id of the load case this load belongs to
  type: "trapezoidal";
  memberId: FrameId;
  direction: LoadDirection;
  w1: number; // kN/m at `start`, positive along the positive direction axis
  w2: number; // kN/m at `end`
  start?: number; // mm from the member start (default 0)
  end?: number; // mm from the member start (default member length)
}

/**
 * Uniform torque per unit length of member, about local axis 1 (right-hand rule), along the
 * whole member or from `start` to `end`.
 */
export interface TorqueMemberLoad {
  loadCase: string; // id of the load case this load belongs to
  type: "torque";
  memberId: FrameId;
  t: number; // kN·m/m, positive about +local 1
  start?: number; // mm from the member start (default 0)
  end?: number; // mm from the member start (default member length)
}

export type MemberLoad =
  | UniformMemberLoad
  | PointMemberLoad
  | TrapezoidalMemberLoad
  | TorqueMemberLoad;

/**
 * How a null area sends its load to the members along its edges:
 * - `"twoWay"`: each point to the nearest edge (corner bisectors); every edge needs members.
 * - `"oneWay"`: strips spanning between `supportEdges`, parallel to the unsupported edges.
 * - `"cantilever"`: everything to the one edge in `supportEdges`, as a line load plus a torque.
 */
export type AreaDistribution = "twoWay" | "oneWay" | "cantilever";

/**
 * A load-distribution-only area: it adds no stiffness and only turns area loads into member
 * loads on the members along its edges. Edge i runs from `nodeIds[i]` to `nodeIds[i + 1]`
 * (the last back to the first); local axis 3 is the normal by the right-hand rule around the
 * nodes, so nodes listed counter-clockwise seen from above give local 3 = +Z.
 */
export interface NullArea {
  id: FrameId;
  nodeIds: FrameId[]; // 3 or 4 corner nodes, in order around the area
  distribution: AreaDistribution;
  /** Edge indices that carry the load: one-way supports, or the one cantilever support. */
  supportEdges?: number[];
}

/** Area load direction: the area's local normal "3" or a global axis. */
export type AreaLoadDirection = "3" | "X" | "Y" | "Z";

export interface AreaLoad {
  loadCase: string; // id of the load case this load belongs to
  areaId: FrameId;
  direction: AreaLoadDirection;
  q: number; // kN/m² of true (not projected) area, positive along the positive direction axis
}

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
  /** Null areas that distribute `areaLoads` to the members along their edges. */
  areas?: NullArea[];
  /** Area loads of every load case, each tagged with its `loadCase`. */
  areaLoads?: AreaLoad[];
  combinations?: LoadCombination[];
}
