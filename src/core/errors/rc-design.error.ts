export class RCDesignError extends Error {
  code: number; // Error code for identification
  message: string;

  constructor(std: RCDesignErrorType = { code: 0, message: "Unknown error" }) {
    super(std.message);
    this.code = std.code;
    this.message = std.message;
    Object.setPrototypeOf(this, RCDesignError.prototype);
  }
}

type RCDesignErrorType = {
  code: number;
  message: string;
};

export const Errors: Record<string, RCDesignErrorType> = {
  // 1XX : RC Beam Design Errors
  COMP_STEEL_DISTANCE_OVER_AC: {
    code: 101,
    message:
      "d' of compressive steel is greater than c, consider using singly reinforced section.",
  },
  TENSILE_STEEL_NOT_YIELDING: {
    code: 102,
    message: "Out of tension controlled region, tensile steel is not yielding.",
  },
};