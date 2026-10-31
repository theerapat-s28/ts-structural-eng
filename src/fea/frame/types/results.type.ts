import type { Warnings } from "@app-core/types/output-message.type";
import type { FrameId, FrameNode, LoadCaseType } from "./model.type";

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
  memberId: FrameId;
  start: ReleaseDeformation;
  end: ReleaseDeformation;
}

/** A rotation direction at a node held by `analyzeFrame` because no member resists it. */
export interface AutoRestrainedDof {
  nodeId: FrameId;
  /** Unit vector of the held rotation axis, global X, Y, Z. */
  axis: [number, number, number];
  /** The global rotation DOF when `axis` is a global axis. */
  dof?: "rx" | "ry" | "rz";
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
  memberId: FrameId;
  length: number; // mm
  stations: MemberStation[];
  extremes: Record<StationComponent, { max: ExtremeValue; min: ExtremeValue }>;
}

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
  /** One entry per member with any released or spring end DOF, in model order. */
  releaseDeformations: MemberReleaseDeformations[];
  memberDiagrams: MemberDiagram[];
  /** One entry per shell area, in model order. */
  shellForces: ShellElementForces[];
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
  shells: {
    shellId: FrameId;
    corners: ({ nodeId: FrameId } & Record<ShellForceComponent, Bound<GoverningValue>>)[];
  }[];
}

export interface FrameResult {
  cases: Record<string, FrameCaseResult>;
  combinations: Record<string, FrameCaseResult>;
  /** Envelope over all combinations; absent when the model has none. */
  envelope?: FrameEnvelope;
  /** The shell mesh; absent when the model has no shells. */
  mesh?: FrameMesh;
  calculationDetails: {
    nodeCount: number;
    memberCount: number;
    shellCount: number;
    dofCount: number;
    freeDofCount: number;
    profileSize: number; // stored entries of the banded stiffness factor (memory / work measure)
    loadCaseCount: number;
    combinationCount: number;
    /** Joint rotations held because every member there releases them (e.g. truss joints). */
    autoRestrainedDofs: AutoRestrainedDof[];
  };
  units: {
    force: "kN";
    moment: "kN·m";
    length: "mm";
    rotation: "rad";
    forcePerLength: "kN/m";
    momentPerLength: "kN·m/m";
    stress: "MPa";
  };
  warnings: Warnings;
}
