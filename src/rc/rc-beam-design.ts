import { RCDesignError, Errors } from "@app-core/errors/rc-design.error";
import * as MyMath from "@app-utils/math";

import {
  RectBeamSection,
  RectSinglyBeamSection,
  RectDoublyBeamSection,
  isSinglyReinforced,
} from "@app-core/types/rc-beam.type";

import {
  Warnings,
  calculationResult,
} from "@app-core/types/output-message.type";

import * as RCConstants from "@app-core/constants/rc.constant";

import { concreteBeta, concreteElasticModulus } from "./general";

/**
 * Calculates the nominal moment capacity (φMn) of a rectangular RC beam section.
 *
 * Supports both singly and doubly reinforced sections. Automatically determines
 * the reinforcement configuration from the input and applies ACI 318-19 checks.
 *
 * @param section - Beam cross-section properties (singly or doubly reinforced)
 * @returns Object containing `phiMn` (kN·m), `calculationDetails`, `unit`, and `warnings`
 * @throws {RCDesignError} If the tensile steel does not yield
 */
export const rectBeamMomentCapacity = (section: RectBeamSection) => {
  const warnings: Warnings = [];
  const concreteUltimateStrain = RCConstants.CONCRETE_ULTIMATE_STRAIN;
  const steelYieldStrain = section.fy / section.Es;
  const beta1 = concreteBeta(section.fc_);
  const Ec = concreteElasticModulus(section.fc_);
  const minSteel = Math.max(
    (0.25 * Math.sqrt(section.fc_) * section.b * section.d) / section.fy,
    (1.4 * section.b * section.d) / section.fy,
  );

  if (section.As < minSteel) {
    // Add a warning if the area of steel is less than the minimum required.
    warnings.push({
      reference: "ACI318-19, 9.6.1.2",
      message: `As (${section.As} mm2) < min required (${minSteel} mm2)`,
    });
  }

  if (section.fy > 550) {
    // Add a warning if the yield strength of steel is greater than 550 MPa.
    warnings.push({
      reference: "ACI318-19, 9.6.1.2",
      message: `fy (${section.fy} MPa) > 550 MPa, consider using high-strength steel.`,
    });
  }

  let Mn: number;
  let calculationDetails: any;
  if (isSinglyReinforced(section)) {
    // Singly reinforced section
    const result = calculateRectSinglyMn({
      Es: section.Es,
      fy: section.fy,
      fc_: section.fc_,
      As: section.As,
      b: section.b,
      h: section.h,
      d: section.d,
    });
    Mn = result.Mn;
    calculationDetails = result.calculationDetails;
    warnings.push(...result.warnings);
  } else {
    // Doubly reinforced section
    const doublySection = section as RectDoublyBeamSection;
    const result = calculateRectDoublyMn({
      Es: doublySection.Es,
      fy: doublySection.fy,
      fc_: doublySection.fc_,
      As: doublySection.As,
      As_: doublySection.As_,
      b: doublySection.b,
      h: doublySection.h,
      d: doublySection.d,
      d_: doublySection.d_,
    });
    Mn = result.Mn;
    calculationDetails = result.calculationDetails;
    warnings.push(...result.warnings);
  }

  // Return the results
  return {
    phiMn: MyMath.roundToDecimalPlaces(
      RCConstants.FLEXURAL_STRENGTH_REDUCTION_FACTOR * Mn,
      2,
    ),
    calculationDetails: calculationDetails,
    unit: "kN-m",
    warnings: warnings,
  };
};

const calculateRectSinglyMn = (
  singlySection: RectSinglyBeamSection,
): calculationResult => {
  const { Es, fy, fc_, As, b, h, d } = singlySection;

  const warnings: Warnings = [];
  const steelYieldStrain = fy / Es;
  const Ac = (As * fy) / (0.85 * fc_);
  const beta1 = concreteBeta(fc_);
  const a = Ac / b;
  const c = a / beta1;
  const tensileSteelStrain = (RCConstants.CONCRETE_ULTIMATE_STRAIN * (d - c)) / c;

  if (
    tensileSteelStrain <
    steelYieldStrain + RCConstants.CONCRETE_ULTIMATE_STRAIN
  ) {
    throw new RCDesignError(Errors.TENSILE_STEEL_NOT_YIELDING);
  }

  const y_ = a / 2;

  return {
    Mn: As * fy * (d - y_) * 0.001 * 0.001, // Convert to kN-m
    calculationDetails: {
      ro: As / (b * d),
    },
    warnings: warnings,
  };
};

const calculateRectDoublyMn = (
  doublySection: RectDoublyBeamSection,
): calculationResult => {
  const { Es, fy, fc_, As, As_, b, h, d, d_ } = doublySection;
  const warnings: Warnings = [];
  const steelYieldStrain = fy / Es;
  const beta1 = concreteBeta(fc_);

  // Assume Compression steel is not yielding and tensile steel is yielding.
  // Solving for c using quadratic equation
  const A = 0.85 * fc_ * b * beta1;
  const B = RCConstants.CONCRETE_ULTIMATE_STRAIN * As_ * Es - As * fy;
  const C = -RCConstants.CONCRETE_ULTIMATE_STRAIN * As_ * Es * d_;

  const quadResults = MyMath.solveQuadratic(A, B, C);
  const c = Math.max(...quadResults); // Take the maximum root for c
  const a = c * beta1;

  const tensileSteelStrain = (RCConstants.CONCRETE_ULTIMATE_STRAIN * (d - c)) / c;
  const compressionSteelStrain =
    (RCConstants.CONCRETE_ULTIMATE_STRAIN * (c - d_)) / c;

  if (
    tensileSteelStrain <
    steelYieldStrain + RCConstants.CONCRETE_ULTIMATE_STRAIN
  ) {
    throw new RCDesignError(Errors.TENSILE_STEEL_NOT_YIELDING);
  }

  if (d_ > c) {
    throw new RCDesignError(Errors.COMP_STEEL_DISTANCE_OVER_AC);
  }

  const y_ = a / 2;

  const Ac = b * a;
  const fs_ = Es * compressionSteelStrain;

  return {
    Mn: (0.85 * fc_ * Ac * (d - y_) + As_ * fs_ * (d - d_)) * 0.001 * 0.001, // Convert to kN-m
    calculationDetails: {
      c: MyMath.roundToDecimalPlaces(c, 2),
      a: MyMath.roundToDecimalPlaces(a, 2),
      beta1: MyMath.roundToDecimalPlaces(beta1, 3),
      d: d,
      d_: d_,
      As: As,
      As_: As_,
      fs_: MyMath.roundToDecimalPlaces(fs_, 2),
      ro: MyMath.roundToDecimalPlaces(As / (b * d), 6),
      ro_: MyMath.roundToDecimalPlaces(As_ / (b * (h - d_)), 6), // TODO: check if this is correct
    },
    warnings: warnings,
  };
};

