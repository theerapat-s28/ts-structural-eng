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

  /**
   * @deprecated Never thrown since 1.4.0. A section whose compression steel
   * lies below the neutral axis is valid — that steel acts in tension and
   * `rectBeamMomentCapacity` now returns a reduced Mn with a warning instead.
   * Retained so existing `Errors.COMP_STEEL_DISTANCE_OVER_AC` references and
   * `code === 101` checks keep compiling; safe to delete in the next major.
   */
  COMP_STEEL_DISTANCE_OVER_AC: {
    code: 101,
    message: "d' of compressive steel is greater than c, consider using singly reinforced section.",
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
    message: "Combined top and bottom rebar layers exceed the section height h.",
  },
  SHEAR_STRENGTH_EXCEEDS_MAX: {
    code: 105,
    message:
      "Vs exceeds 0.66*sqrt(fc')*bw*d (ACI318-19, 22.5.1.2); section is too small for shear, increase bw or d.",
  },

  // 2XX : Strengthening / plate-to-concrete connection errors
  NON_POSITIVE_SHEAR_FLOW: {
    code: 201,
    message:
      "Interface shear flow requires a positive shear force V and at least one jacketing plate with non-zero area.",
  },
  INVALID_BOLT_CAPACITY: {
    code: 202,
    message:
      "Resolved bolt shear capacity is not positive; check Ase, futa, or the supplied phiVboltOverride.",
  },
  PLATE_OUTSIDE_SECTION: {
    code: 203,
    message:
      "Inconsistent jacketed section geometry; plate and section dimensions must be positive and d must lie within h.",
  },
  CRACKED_NA_NOT_FOUND: {
    code: 204,
    message:
      "No valid cracked neutral axis was found within the concrete depth; check the section and plate properties.",
  },
};
