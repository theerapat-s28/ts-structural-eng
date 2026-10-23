/**
 * Where a frame-analysis problem is, so a UI can highlight it. Only the fields that apply are set.
 */
export interface FrameErrorDetails {
  nodeId?: string | number;
  memberId?: string | number;
  areaId?: string | number;
  /** For an area: the edge index, edge i running from `nodeIds[i]` to `nodeIds[i + 1]`. */
  edge?: number;
  loadCaseId?: string;
  combinationId?: string;
  /** The offending input field, e.g. "x", "fz", "w", "direction", "uz". */
  field?: string;
  /** For an unstable structure: a degree of freedom involved in the mechanism. */
  dof?: "ux" | "uy" | "uz" | "rx" | "ry" | "rz";
}

export class FrameAnalysisError extends Error {
  code: number; // Error code for identification
  message: string;
  details: FrameErrorDetails;
  /** Every problem found when the model was validated; this error is the first of them. */
  issues: FrameModelIssue[];

  constructor(
    std: FrameAnalysisErrorType = { code: 0, message: "Unknown error" },
    details: FrameErrorDetails = {},
    issues?: FrameModelIssue[],
  ) {
    super(std.message);
    this.code = std.code;
    this.message = std.message;
    this.details = details;
    this.issues = issues ?? [{ code: std.code, message: std.message, details }];
    Object.setPrototypeOf(this, FrameAnalysisError.prototype);
  }
}

/** One problem found in a frame model, as returned by `validateFrameModel`. */
export interface FrameModelIssue {
  code: number;
  message: string;
  details: FrameErrorDetails;
}

type FrameAnalysisErrorType = {
  code: number;
  message: string;
};

export const FrameErrors: Record<string, FrameAnalysisErrorType> = {
  // 3XX : Frame analysis errors
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
      "Node ids, member ids, area ids and restrained node ids must each be unique, and load case and combination ids must be unique across both lists.",
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
      "A load case requests self-weight but a member section has no unitWeight; set unitWeight (0 for a weightless member).",
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
};
