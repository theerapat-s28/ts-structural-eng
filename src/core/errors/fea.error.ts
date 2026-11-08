/**
 * Where a problem in an FEA model is, so a UI can highlight it. Only the fields that apply are set.
 */
export interface FeaErrorDetails {
  nodeId?: string | number;
  memberId?: string | number;
  areaId?: string | number;
  shellId?: string | number;
  stripId?: string | number;
  pierId?: string | number;
  spandrelId?: string | number;
  /** For a pier or spandrel cut: its elevation (pier) or distance from the left end (spandrel), mm. */
  position?: number;
  /** For an area: the edge index, edge i running from `nodeIds[i]` to `nodeIds[i + 1]`. */
  edge?: number;
  loadCaseId?: string;
  combinationId?: string;
  /** The offending input field, e.g. "x", "fz", "w", "direction", "uz". */
  field?: string;
  /** For an unstable structure: a degree of freedom involved in the mechanism. */
  dof?: "ux" | "uy" | "uz" | "rx" | "ry" | "rz";
}

export class FeaError extends Error {
  code: number; // Error code for identification
  message: string;
  details: FeaErrorDetails;
  /** Every problem found when the model was validated; this error is the first of them. */
  issues: FeaModelIssue[];

  constructor(
    std: FeaErrorType = { code: 0, message: "Unknown error" },
    details: FeaErrorDetails = {},
    issues?: FeaModelIssue[],
  ) {
    super(std.message);
    this.code = std.code;
    this.message = std.message;
    this.details = details;
    this.issues = issues ?? [{ code: std.code, message: std.message, details }];
    Object.setPrototypeOf(this, FeaError.prototype);
  }
}

/** One problem found in an FEA model, as returned by `validateModel`. */
export interface FeaModelIssue {
  code: number;
  message: string;
  details: FeaErrorDetails;
}

type FeaErrorType = {
  code: number;
  message: string;
};

export const FeaErrors: Record<string, FeaErrorType> = {
  // 3XX : FEA errors
  ZERO_LENGTH_MEMBER: {
    code: 301,
    message: "A member's start and end nodes coincide; the member has zero length.",
  },
  UNKNOWN_NODE_REFERENCE: {
    code: 302,
    message:
      "A member, restraint, area or load refers to a node, member or area id that is not in the model.",
  },
  DUPLICATE_ID: {
    code: 303,
    message:
      "Node ids, member ids and restrained node ids must each be unique, area ids must be unique across null areas and shells, strip ids must be unique, and load case and combination ids must be unique across both lists.",
  },
  STRUCTURE_UNSTABLE: {
    code: 304,
    message:
      "The restrained structure is unstable (singular stiffness matrix); add supports or members to prevent a mechanism.",
  },
  INVALID_SECTION_PROPERTIES: {
    code: 305,
    message:
      "Member section properties E, G, A, I22, I33 and J must all be positive, and unitWeight, when given, must not be negative.",
  },
  NO_RESTRAINTS: {
    code: 306,
    message: "The model has no restrained degrees of freedom.",
  },
  INVALID_RELEASE: {
    code: 307,
    message:
      "The end releases on a member make it a mechanism (rigid-body motion within the member).",
  },
  LOAD_OUTSIDE_MEMBER: {
    code: 308,
    message: "A member load lies outside the member, or its start is not before its end.",
  },
  UNKNOWN_LOAD_CASE: {
    code: 309,
    message:
      "A load or a load combination term refers to a load case or combination that is not in the model, or a term names neither.",
  },
  CIRCULAR_COMBINATION: {
    code: 310,
    message: "Load combinations reference each other in a loop.",
  },
  INVALID_LOAD_FACTOR: {
    code: 311,
    message:
      "A combination factor or self-weight multiplier is not a finite number, or a load combination has no terms.",
  },
  NO_LOAD_CASES: {
    code: 312,
    message: "The model has no load cases; define at least one in loadCases.",
  },
  MISSING_UNIT_WEIGHT: {
    code: 313,
    message:
      "A load case requests self-weight but a member or shell section has no unitWeight; set unitWeight (0 for a weightless member or shell).",
  },
  INVALID_INPUT_VALUE: {
    code: 314,
    message:
      "An input value is invalid: a number that is not finite (NaN, Infinity or not a number), a negative spring stiffness, or a value outside its allowed options.",
  },
  INVALID_AREA_GEOMETRY: {
    code: 315,
    message:
      "An area must have 3 or 4 distinct nodes forming a planar, convex polygon with no three corners in line; a cantilever area must be a rectangle.",
  },
  AREA_EDGE_UNSUPPORTED: {
    code: 316,
    message:
      "An area edge that carries load is not fully covered by members: every segment between the nodes along the edge needs a member.",
  },
  INVALID_AREA_DISTRIBUTION: {
    code: 317,
    message:
      "An area's supportEdges do not fit its distribution: two-way takes none; one-way needs at least one edge left unsupported, with every unsupported edge parallel to the others (the span direction); cantilever needs exactly one, and its loads may not act along that edge.",
  },
  INVALID_SHELL_GEOMETRY: {
    code: 326,
    message:
      "A shell area must have 4 distinct nodes, listed in order around it, forming a convex quadrilateral that is close to flat (each corner within 0.1·√A of the mean plane).",
  },
  INVALID_SHELL_SECTION: {
    code: 327,
    message:
      "A shell section's thickness and E must be positive, nu must be at least 0 and below 0.5, and unitWeight, when given, must not be negative.",
  },
  SHELL_DOF_UNSUPPORTED: {
    code: 328,
    message:
      'A model node connected only to shells has a translation that nothing resists: a membrane carries no load out of its plane and a plate none in its plane. Restrain that DOF, connect a member, or use type "shell".',
  },
  INVALID_SHELL_MESH: {
    code: 329,
    message:
      "Shell areas cannot be meshed: no division counts make the meshes of areas sharing edges meet node to node, a generated element is not a valid quadrilateral, or a generated id is already in use. Divide the areas so they meet edge to edge, or change their mesh sizes.",
  },
  INVALID_STRIP_GEOMETRY: {
    code: 330,
    message:
      "A strip needs at least 2 points in one plane normal to its normal (default +Z), with no zero-length segment and no segment turning straight back on the previous one; its normal must not be zero, its widths must not be negative, and they must not both be zero.",
  },
  INVALID_PIER_GEOMETRY: {
    code: 331,
    message:
      "A pier or spandrel must list existing shell areas and members, each at most once and in no other pier (or spandrel); a pier needs at least one area or member, a spandrel at least one area. Pier areas must be vertical and pier members not horizontal; a spandrel's areas must lie in one vertical plane and its members must not be normal to its length. Every cut must lie within the group and on the mesh lines of its areas: divide an area that a cut crosses.",
  },
  SHELL_LOAD_UNSUPPORTED: {
    code: 332,
    message:
      'A load case acts on generated mesh nodes along a direction their shells cannot carry, so the load has no path: a membrane carries no load out of its plane and a plate none in its plane. Use type "shell", the type that carries this load, or a null area to pass it to members.',
  },
};

// ---- Names before 3.2.0, kept as deprecated aliases until 4.0.0 ------------------------

/** @deprecated Renamed `FeaError`; this alias is removed in 4.0.0. */
export const FrameAnalysisError = FeaError;
/** @deprecated Renamed `FeaError`; this alias is removed in 4.0.0. */
export type FrameAnalysisError = FeaError;
/** @deprecated Renamed `FeaErrors`; this alias is removed in 4.0.0. */
export const FrameErrors = FeaErrors;
/** @deprecated Renamed `FeaErrorDetails`; this alias is removed in 4.0.0. */
export type FrameErrorDetails = FeaErrorDetails;
/** @deprecated Renamed `FeaModelIssue`; this alias is removed in 4.0.0. */
export type FrameModelIssue = FeaModelIssue;
