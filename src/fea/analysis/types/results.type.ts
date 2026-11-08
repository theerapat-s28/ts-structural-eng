import type { Warnings } from "@app-core/types/output-message.type";
import type {
  MemberDiagram,
  MemberEndForces,
  MemberIntermediateNode,
  MemberNearMissNode,
  MemberReleaseDeformations,
  StationComponent,
} from "@app-fea/frame/types/results.type";
import type { FeaId } from "@app-fea/shared/types/model.type";
import type {
  FeaMesh,
  ShellElementForces,
  ShellForceComponent,
  StripForceComponent,
  StripForces,
} from "@app-fea/shell/types/results.type";

import type { LoadCaseType } from "./model.type";

export interface NodalDisplacement {
  nodeId: FeaId;
  ux: number; // mm
  uy: number; // mm
  uz: number; // mm
  rx: number; // rad
  ry: number; // rad
  rz: number; // rad
}

export interface NodalReaction {
  nodeId: FeaId;
  fx: number; // kN
  fy: number; // kN
  fz: number; // kN
  mx: number; // kN·m
  my: number; // kN·m
  mz: number; // kN·m
}

/** A rotation direction at a node held by `analyze` because no member resists it. */
export interface AutoRestrainedDof {
  nodeId: FeaId;
  /** Unit vector of the held rotation axis, global X, Y, Z. */
  axis: [number, number, number];
  /** The global rotation DOF when `axis` is a global axis. */
  dof?: "rx" | "ry" | "rz";
}

/**
 * A translation direction at a generated mesh node, held by `analyze` because the shells there
 * do not resist it (a membrane's out-of-plane or a plate's in-plane direction).
 */
export interface AutoRestrainedTranslation {
  nodeId: FeaId;
  /** Unit vector of the held direction, global X, Y, Z. */
  axis: [number, number, number];
  /** The global translation DOF when `axis` is a global axis. */
  dof?: "ux" | "uy" | "uz";
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

/**
 * The resultant on a pier or spandrel cut, in its axes 1, 2, 3 and about the centroid of the
 * cut section, acting on the face whose outward normal is +1 (the part below a pier cut, left
 * of a spandrel cut) — the signs of a member's internal forces (`MemberStation`) with the same
 * local axes:
 *
 * - `P` axial force along 1, positive in tension (kN)
 * - `V2`, `V3` shear along 2 and 3 (kN)
 * - `T` torsion about 1, `M2`, `M3` moments about 2 and 3, right-hand rule (kN·m)
 */
export interface WallResultants {
  P: number;
  V2: number;
  V3: number;
  T: number;
  M2: number;
  M3: number;
}

/** A pier or spandrel resultant. */
export type WallForceComponent = keyof WallResultants;

/** Where one shell area crosses a pier or spandrel cut: a straight leg of the cut section. */
export interface WallSectionLeg {
  areaId: FeaId;
  /** End points of the leg on the cut, global X, Y, Z (mm). */
  start: [number, number, number];
  end: [number, number, number];
  length: number; // mm
  thickness: number; // mm
}

/** Where one member crosses a pier or spandrel cut. */
export interface WallSectionMember {
  memberId: FeaId;
  /** The member's axis on the cut, global X, Y, Z (mm). */
  point: [number, number, number];
  A: number; // mm², its section area
}

/** The section a pier or spandrel cut passes through. */
export interface WallCutSection {
  legs: WallSectionLeg[];
  members: WallSectionMember[];
  /** Total length of the legs (mm). */
  length: number;
  /** Σ length × thickness of the legs plus Σ A of the members (mm²). */
  area: number;
  /** Geometric centroid of the section (legs and members by area), global X, Y, Z (mm); the point the moments are about. */
  centroid: [number, number, number];
}

/**
 * Which side of a pier cut the forces come from: `"bottom"` the elements above it (the bottom
 * of a lift), `"top"` those below it (the top of a lift), `"cut"` an extra cut, from below.
 * A level shared by two lifts has a `"top"` and a `"bottom"` cut; they differ by what is
 * applied at that level (a floor, nodal loads).
 */
export type PierCutFace = "bottom" | "top" | "cut";

/** The resultant on one pier cut. */
export interface PierCut extends WallResultants {
  z: number; // mm, the cut's elevation
  face: PierCutFace;
  section: WallCutSection;
}

/** Forces of one pier in one load case or combination. */
export interface PierForces {
  pierId: FeaId;
  /** Pier axes 1, 2, 3 (rows) in global components. */
  axes: [[number, number, number], [number, number, number], [number, number, number]];
  /** In order up the pier; at a shared level the `"top"` of the lift below comes first. */
  cuts: PierCut[];
}

/**
 * Which side of a spandrel cut the forces come from: `"left"` the elements right of the left
 * end, `"right"` those left of the right end, `"cut"` an extra cut, from the left.
 */
export type SpandrelCutFace = "left" | "right" | "cut";

/** The resultant on one spandrel cut. */
export interface SpandrelCut extends WallResultants {
  x: number; // mm from the left end along axis 1
  face: SpandrelCutFace;
  section: WallCutSection;
}

/** Forces of one spandrel in one load case or combination. */
export interface SpandrelForces {
  spandrelId: FeaId;
  /** Spandrel axes 1, 2, 3 (rows) in global components. */
  axes: [[number, number, number], [number, number, number], [number, number, number]];
  /** Distance from the left end to the right end along axis 1 (mm). */
  length: number;
  /** In order from left to right. */
  cuts: SpandrelCut[];
}

/** Results of one load case or one load combination. */
export interface FeaCaseResult {
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
  /** One entry per shell element, area by area in model order (see `FeaResult.mesh`). */
  shellForces: ShellElementForces[];
  /** One entry per strip, in model order (see `FeaModel.strips`); empty without strips. */
  stripForces: StripForces[];
  /** One entry per pier, in model order (see `FeaModel.piers`); empty without piers. */
  pierForces: PierForces[];
  /** One entry per spandrel, in model order (see `FeaModel.spandrels`); empty without spandrels. */
  spandrelForces: SpandrelForces[];
  equilibriumResidual: { force: number; moment: number }; // kN, kN·m
  warnings: Warnings;
}

/** Max/min of every result across a set of combinations, with the governing combination. */
export interface FeaEnvelope {
  combinationIds: string[];
  nodalDisplacements: ({ nodeId: FeaId } & Record<
    "ux" | "uy" | "uz" | "rx" | "ry" | "rz",
    Bound<GoverningValue>
  >)[];
  reactions: ({ nodeId: FeaId } & Record<
    "fx" | "fy" | "fz" | "mx" | "my" | "mz",
    Bound<GoverningValue>
  >)[];
  members: {
    memberId: FeaId;
    extremes: Record<StationComponent, Bound<GoverningExtremeValue>>;
  }[];
  shells: {
    shellId: FeaId;
    corners: ({ nodeId: FeaId } & Record<ShellForceComponent, Bound<GoverningValue>>)[];
  }[];
  /**
   * Per strip: max/min of each resultant at every station (for envelope diagrams), of its
   * per-width value, and over the whole strip.
   */
  strips: {
    stripId: FeaId;
    stations: ({
      x: number; // mm
      segment: number;
      perWidth: Record<StripForceComponent, Bound<GoverningValue>>;
    } & Record<StripForceComponent, Bound<GoverningValue>>)[];
    extremes: Record<StripForceComponent, Bound<GoverningExtremeValue>>;
  }[];
  /** Per pier: max/min of each resultant at every cut. */
  piers: {
    pierId: FeaId;
    cuts: ({ z: number; face: PierCutFace } & Record<WallForceComponent, Bound<GoverningValue>>)[];
  }[];
  /** Per spandrel: max/min of each resultant at every cut. */
  spandrels: {
    spandrelId: FeaId;
    cuts: ({ x: number; face: SpandrelCutFace } & Record<
      WallForceComponent,
      Bound<GoverningValue>
    >)[];
  }[];
}

export interface FeaResult {
  cases: Record<string, FeaCaseResult>;
  combinations: Record<string, FeaCaseResult>;
  /** Envelope over all combinations; absent when the model has none. */
  envelope?: FeaEnvelope;
  /** The shell mesh; absent when the model has no shells. */
  mesh?: FeaMesh;
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
    /** Translations held at generated mesh nodes of membrane and plate areas; they stay 0. */
    autoRestrainedTranslations: AutoRestrainedTranslation[];
    /**
     * Model nodes lying on a member between its ends that were connected to it (see
     * `Member.connectIntermediateNodes`), member by member from its start.
     */
    intermediateNodes: MemberIntermediateNode[];
    /**
     * Model nodes close to a member but not on it, so not connected to it, each with a
     * "Member connectivity" warning; same order.
     */
    nearMissNodes: MemberNearMissNode[];
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
