import type { Member, MemberLoad, NullArea } from "@app-fea/frame/types/model.type";
import type { AreaLoad, FeaId, FeaNode, Restraint } from "@app-fea/shared/types/model.type";
import type { ShellArea, ShellStrip } from "@app-fea/shell/types/model.type";

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

/**
 * A wall pier, as in ETABS: shell areas (one or more wall legs, planar or not, connected or
 * not) and members (boundary or embedded columns) whose forces `analyze` sums on horizontal
 * cuts into one resultant per cut (`pierForces`). Cuts are taken at the bottom and top of each
 * lift — between consecutive elevations where any of its areas or members starts or ends — and
 * at the extra elevations in `cuts`.
 *
 * Pier axes: 1 = global +Z (up); 2 horizontal, along the longest area of the pier (pointing
 * toward +X, or +Y for an area parallel to Y), or global X rotated by `angle` about +Z when
 * given; 3 = 1 × 2. A pier adds nothing to the analysis.
 */
export interface WallPier {
  id: FeaId;
  /** Shell areas of the pier; all vertical. */
  areaIds?: FeaId[];
  /** Members of the pier; none horizontal. */
  memberIds?: FeaId[];
  /** Extra cut elevations (mm, global Z), within the pier and on the mesh lines of its areas. */
  cuts?: number[];
  /** Rotation of pier axis 2 from global X about +Z (rad); default along the longest area. */
  angle?: number;
}

/**
 * A wall spandrel (coupling beam), as in ETABS: shell areas in one vertical plane, and members
 * (beams along it), whose forces `analyze` sums on vertical cuts into one resultant per cut
 * (`spandrelForces`): at its left and right ends and at the distances in `cuts`.
 *
 * Spandrel axes: 1 horizontal along the wall plane, pointing toward +X (toward +Y for a wall
 * parallel to Y), or the opposite way with `reverse: true`; its left end is where 1 starts.
 * 2 = global +Z, 3 = 1 × 2 (out of the wall plane). A spandrel adds nothing to the analysis.
 */
export interface WallSpandrel {
  id: FeaId;
  /** Shell areas of the spandrel (at least one), all in one vertical plane. */
  areaIds: FeaId[];
  /** Members of the spandrel; none normal to its axis 1. */
  memberIds?: FeaId[];
  /** Extra cuts, as distances from the left end along axis 1 (mm), on the mesh lines. */
  cuts?: number[];
  /** Reverse axis 1 (and so swap the left and right ends). Default false. */
  reverse?: boolean;
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
  /**
   * Design strips across the shells: `analyze` returns the forces on cuts across each strip in
   * every load case and combination (`stripForces`). They add nothing to the analysis.
   */
  strips?: ShellStrip[];
  /**
   * Wall piers: `analyze` returns the resultant on cuts across each pier in every load case and
   * combination (`pierForces`). They add nothing to the analysis.
   */
  piers?: WallPier[];
  /**
   * Wall spandrels: `analyze` returns the resultant on cuts across each spandrel in every load
   * case and combination (`spandrelForces`). They add nothing to the analysis.
   */
  spandrels?: WallSpandrel[];
}
