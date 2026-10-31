import type { SectionProperties } from "@app-core/types/section-properties.type";
import type { FeaId } from "@app-fea/shared/types/model.type";

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
  id: FeaId;
  startNodeId: FeaId;
  endNodeId: FeaId;
  section: SectionProperties;
  angle?: number; // rad, rotation of local 2 and 3 about local 1 (right-hand rule); default 0
  releases?: { start?: MemberEndRelease; end?: MemberEndRelease };
}

/** Load direction: local member axes "1", "2", "3" or global axes "X", "Y", "Z". */
export type LoadDirection = "1" | "2" | "3" | "X" | "Y" | "Z";

/**
 * Uniform load per unit length of member, along the whole member or from `start` to `end`.
 * With `projected: true` (global directions only) `w` is per unit length projected onto the
 * plane normal to `direction`, e.g. snow on a rafter per unit plan length; it is applied as
 * `w · Lproj / L` per member length.
 */
export interface UniformMemberLoad {
  loadCase: string; // id of the load case this load belongs to
  type: "udl";
  memberId: FeaId;
  direction: LoadDirection;
  w: number; // kN/m, positive along the positive direction axis
  start?: number; // mm from the member start (default 0)
  end?: number; // mm from the member start (default member length)
  projected?: boolean; // w per unit projected length (global directions only); default false
}

export interface PointMemberLoad {
  loadCase: string; // id of the load case this load belongs to
  type: "point";
  memberId: FeaId;
  direction: LoadDirection;
  P: number; // kN, positive along the positive direction axis
  a: number; // mm from the member start
}

/**
 * Linearly varying load per unit length of member, from `w1` at `start` to `w2` at `end`
 * (triangular when one of them is 0). `projected` works as for a uniform load; `start` and
 * `end` stay measured along the member.
 */
export interface TrapezoidalMemberLoad {
  loadCase: string; // id of the load case this load belongs to
  type: "trapezoidal";
  memberId: FeaId;
  direction: LoadDirection;
  w1: number; // kN/m at `start`, positive along the positive direction axis
  w2: number; // kN/m at `end`
  start?: number; // mm from the member start (default 0)
  end?: number; // mm from the member start (default member length)
  projected?: boolean; // w1, w2 per unit projected length (global directions only); default false
}

/**
 * Uniform torque per unit length of member, about local axis 1 (right-hand rule), along the
 * whole member or from `start` to `end`.
 */
export interface TorqueMemberLoad {
  loadCase: string; // id of the load case this load belongs to
  type: "torque";
  memberId: FeaId;
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
  id: FeaId;
  nodeIds: FeaId[]; // 3 or 4 corner nodes, in order around the area
  distribution: AreaDistribution;
  /** Edge indices that carry the load: one-way supports, or the one cantilever support. */
  supportEdges?: number[];
}
