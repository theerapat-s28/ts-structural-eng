import type { Warnings } from "@app-core/types/output-message.type";
import type {
  MemberDiagram,
  MemberEndForces,
  MemberReleaseDeformations,
  StationComponent,
} from "@app-fea/frame/types/results.type";
import type { FeaId } from "@app-fea/shared/types/model.type";
import type {
  FeaMesh,
  ShellElementForces,
  ShellForceComponent,
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
