import type { Member, MemberLoad, NullArea } from "@app-fea/frame/types/model.type";
import type { AreaLoad, FeaId, FeaNode, Restraint } from "@app-fea/shared/types/model.type";
import type { ShellArea } from "@app-fea/shell/types/model.type";

/**
 * Fixed DOFs along a straight line: every node on the segment between two nodes, including the
 * nodes the engine generates when it meshes shell areas, e.g. a wall base fixed along its
 * length. `true` fixes the DOF; there are no line springs. Combined with point restraints at
 * the same node, a fixed DOF stays fixed.
 */
export interface LineRestraint {
  nodeIds: [FeaId, FeaId]; // the two ends of the line
  ux?: boolean;
  uy?: boolean;
  uz?: boolean;
  rx?: boolean;
  ry?: boolean;
  rz?: boolean;
}

export interface NodalLoad {
  loadCase: string; // id of the load case this load belongs to
  nodeId: FeaId;
  fx?: number; // kN, global X
  fy?: number; // kN, global Y
  fz?: number; // kN, global Z
  mx?: number; // kN·m, about global X
  my?: number; // kN·m, about global Y
  mz?: number; // kN·m, about global Z
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
 * themselves are listed in `FeaModel.nodalLoads` and `FeaModel.memberLoads`, each tagged
 * with its `loadCase`.
 */
export interface LoadCase {
  id: string;
  name?: string;
  type?: LoadCaseType;
  /**
   * Self-weight multiplier (1 = full self-weight). Applies `selfWeight · unitWeight · A` per unit
   * length of every member and `selfWeight · unitWeight · thickness` (times `modifiers.weight`)
   * per unit area of every shell, along global −Z. Default 0.
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

export interface FeaModel {
  nodes: FeaNode[];
  /** Frame members; omit for a model of shells only, e.g. a mat foundation. */
  members?: Member[];
  restraints: Restraint[];
  /** Fixed DOFs of every node along straight lines, generated mesh nodes included. */
  lineRestraints?: LineRestraint[];
  loadCases: LoadCase[];
  /** Nodal loads of every load case, each tagged with its `loadCase`. */
  nodalLoads?: NodalLoad[];
  /** Member loads of every load case, each tagged with its `loadCase`. */
  memberLoads?: MemberLoad[];
  /** Null areas that distribute `areaLoads` to the members along their edges. */
  areas?: NullArea[];
  /** Shell areas: four-node flat shell elements with membrane and/or plate stiffness. */
  shells?: ShellArea[];
  /** Area loads of every load case, each tagged with its `loadCase`. */
  areaLoads?: AreaLoad[];
  combinations?: LoadCombination[];
}
