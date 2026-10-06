export class FrameAnalysisError extends Error {
  code: number; // Error code for identification
  message: string;

  constructor(std: FrameAnalysisErrorType = { code: 0, message: "Unknown error" }) {
    super(std.message);
    this.code = std.code;
    this.message = std.message;
    Object.setPrototypeOf(this, FrameAnalysisError.prototype);
  }
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
    message: "A member, restraint or load refers to a node or member id that is not in the model.",
  },
  DUPLICATE_ID: {
    code: 303,
    message: "Node ids, member ids and restrained node ids must each be unique.",
  },
  STRUCTURE_UNSTABLE: {
    code: 304,
    message:
      "The restrained structure is unstable (singular stiffness matrix); add supports or members to prevent a mechanism.",
  },
  INVALID_SECTION_PROPERTIES: {
    code: 305,
    message: "Member section properties E, G, A, I22, I33 and J must all be positive.",
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
};
