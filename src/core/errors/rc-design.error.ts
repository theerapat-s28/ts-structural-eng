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
  SECTION_TOO_NARROW_FOR_BAR: {
    code: 103,
    message:
      "Section width is too narrow to fit even one bar of the given diameter with the required cover and spacing.",
  },
  BAR_LAYOUT_EXCEEDS_SECTION_HEIGHT: {
    code: 104,
    message:
      "Combined top and bottom rebar layers exceed the section height h.",
  },
  SHEAR_STRENGTH_EXCEEDS_MAX: {
    code: 105,
    message:
      "Vs exceeds 0.66*sqrt(fc')*bw*d (ACI318-19, 22.5.1.2); section is too small for shear, increase bw or d.",
  },
};