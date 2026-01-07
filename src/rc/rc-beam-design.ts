import { RCDesignError, Errors } from "@app-core/errors/rc-design.error";
import * as MyMath from "src/utils/math";

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

export const rectBeamMomentCapacity = (section: RectBeamSection) => {
  let warnings: Warnings = [];
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
    let result = calculateRectSinglyMn({
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
    let result = calculateRectDoublyMn({
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

  let warnings: Warnings = [];
  const steelYieldStrain = fy / Es;
  let Ac = (As * fy) / (0.85 * fc_);
  let beta1 = concreteBeta(fc_);
  let a = Ac / b;
  let c = a / beta1;
  let tensileSteelStrain = (RCConstants.CONCRETE_ULTIMATE_STRAIN * (d - c)) / c;

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
  let warnings: Warnings = [];
  const steelYieldStrain = fy / Es;
  let beta1 = concreteBeta(fc_);

  // Assume Compression steel is not yielding and tensile steel is yielding.
  // Solving for c using quadratic equation
  const A = 0.85 * fc_ * b * beta1;
  const B = RCConstants.CONCRETE_ULTIMATE_STRAIN * As_ * Es - As * fy;
  const C = -RCConstants.CONCRETE_ULTIMATE_STRAIN * As_ * Es * d_;

  let quadResults = MyMath.solveQuadratic(A, B, C);
  let c = Math.max(...quadResults); // Take the maximum root for c
  let a = c * beta1;

  let tensileSteelStrain = (RCConstants.CONCRETE_ULTIMATE_STRAIN * (d - c)) / c;
  let compressionSteelStrain =
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

  console.log({
    b,
    h,
    d,
    d_,
  });

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

