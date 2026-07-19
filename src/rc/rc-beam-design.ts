import { RCDesignError, Errors } from "@app-core/errors/rc-design.error";
import * as MyMath from "@app-utils/math";

import {
  RectBeamSection,
  RectSinglyBeamSection,
  RectDoublyBeamSection,
  RectShearSection,
  StirrupShearSection,
  ShearReinforcementCheckInput,
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

/**
 * Calculates the concrete contribution to shear capacity (φVc) of a beam section
 * per ACI 318-19 22.5.5.1, Table 22.5.5.1(a): Vc = 0.17 λ √f'c bw d
 *
 * @param section - Shear section properties (fc_, bw, d, optional lambda)
 * @returns Object containing `phiVc` (kN), `calculationDetails`, `unit`, and `warnings`
 */
export const concreteShearCapacity = (section: RectShearSection) => {
  const warnings: Warnings = [];
  const lambda = section.lambda ?? 1.0;
  const sqrtFc = Math.sqrt(section.fc_);

  if (sqrtFc > RCConstants.SQRT_FC_SHEAR_LIMIT) {
    warnings.push({
      reference: "ACI318-19, 22.5.3.1",
      message: `sqrt(fc') (${MyMath.roundToDecimalPlaces(sqrtFc, 2)}) > ${RCConstants.SQRT_FC_SHEAR_LIMIT} MPa limit for Vc; capped at ${RCConstants.SQRT_FC_SHEAR_LIMIT} MPa unless minimum shear reinforcement per 9.6.3.3 is provided.`,
    });
  }
  const cappedSqrtFc = Math.min(sqrtFc, RCConstants.SQRT_FC_SHEAR_LIMIT);

  const Vc =
    RCConstants.CONCRETE_SHEAR_VC_COEFFICIENT *
    lambda *
    cappedSqrtFc *
    section.bw *
    section.d; // N

  return {
    phiVc: MyMath.roundToDecimalPlaces(
      RCConstants.SHEAR_STRENGTH_REDUCTION_FACTOR * Vc * 0.001,
      2,
    ),
    calculationDetails: {
      Vc: MyMath.roundToDecimalPlaces(Vc * 0.001, 2),
      lambda,
    },
    unit: "kN",
    warnings,
  };
};

/**
 * Calculates the stirrup (shear reinforcement) contribution to shear capacity (φVs)
 * of a beam section per ACI 318-19 22.5.10.5.3: Vs = Av fyt d / s
 *
 * @param section - Stirrup shear properties (fc_, bw, d, Av, fyt, s)
 * @returns Object containing `phiVs` (kN), `calculationDetails`, `unit`, and `warnings`
 * @throws {RCDesignError} If Vs exceeds the ACI 318-19 22.5.1.2 maximum (section too small)
 */
export const stirrupShearCapacity = (section: StirrupShearSection) => {
  const warnings: Warnings = [];
  const { fc_, bw, d, Av, fyt, s } = section;

  const Vs = (Av * fyt * d) / s; // N
  const maxVs = RCConstants.MAX_VS_COEFFICIENT * Math.sqrt(fc_) * bw * d; // N

  if (Vs > maxVs) {
    throw new RCDesignError(Errors.SHEAR_STRENGTH_EXCEEDS_MAX);
  }

  return {
    phiVs: MyMath.roundToDecimalPlaces(
      RCConstants.SHEAR_STRENGTH_REDUCTION_FACTOR * Vs * 0.001,
      2,
    ),
    calculationDetails: {
      Vs: MyMath.roundToDecimalPlaces(Vs * 0.001, 2),
      maxVs: MyMath.roundToDecimalPlaces(maxVs * 0.001, 2),
    },
    unit: "kN",
    warnings,
  };
};

/**
 * Checks whether shear reinforcement (stirrups) is required at a section, and if so,
 * whether it may be at the code minimum or must be designed for strength, per
 * ACI 318-19 9.6.3.1 (requirement thresholds), 9.6.3.3 (Av,min), and 9.7.6.2.2 (max spacing).
 *
 * If `Av` and `s` are supplied, the provided reinforcement is checked against the
 * required Av/s ratio and maximum spacing, adding warnings on shortfalls.
 *
 * @param input - Section and demand properties (fc_, bw, d, Vu, fyt, optional Av, s, lambda)
 * @returns Object containing requirement classification, required Av/s and max spacing, and warnings
 * @throws {RCDesignError} If required Vs exceeds the ACI 318-19 22.5.1.2 maximum (section too small)
 */
export const checkStirrupRequirement = (
  input: ShearReinforcementCheckInput,
) => {
  const warnings: Warnings = [];
  const { fc_, bw, d, Vu, fyt, Av, s } = input;

  const { phiVc, calculationDetails } = concreteShearCapacity({
    fc_,
    bw,
    d,
    lambda: input.lambda,
  });
  const Vc = calculationDetails.Vc; // kN

  const halfPhiVc = 0.5 * phiVc;

  let required = false;
  let minimumOnly = false;
  let requiredAvOverS = 0; // mm^2/mm
  let maxSpacing: number | null = null;

  if (Vu > halfPhiVc) {
    required = true;

    const sqrtFc = Math.sqrt(fc_);
    const minAvOverS = Math.max(
      (RCConstants.MIN_AV_SQRT_FC_COEFFICIENT * sqrtFc * bw) / fyt,
      (RCConstants.MIN_AV_ABSOLUTE_COEFFICIENT * bw) / fyt,
    );

    if (Vu <= phiVc) {
      minimumOnly = true;
      requiredAvOverS = minAvOverS;
      maxSpacing =
        RCConstants.MAX_STIRRUP_SPACING_LOW_VS_DEPTH_FACTOR * d <
        RCConstants.MAX_STIRRUP_SPACING_LOW_VS
          ? RCConstants.MAX_STIRRUP_SPACING_LOW_VS_DEPTH_FACTOR * d
          : RCConstants.MAX_STIRRUP_SPACING_LOW_VS;
    } else {
      const requiredVs =
        Vu / RCConstants.SHEAR_STRENGTH_REDUCTION_FACTOR - Vc; // kN
      const maxVs =
        (RCConstants.MAX_VS_COEFFICIENT * sqrtFc * bw * d) * 0.001; // kN

      if (requiredVs > maxVs) {
        throw new RCDesignError(Errors.SHEAR_STRENGTH_EXCEEDS_MAX);
      }

      const strengthAvOverS = (requiredVs * 1000) / (fyt * d); // mm^2/mm
      requiredAvOverS = Math.max(minAvOverS, strengthAvOverS);

      const vsThreshold =
        (RCConstants.VS_SPACING_THRESHOLD_COEFFICIENT * sqrtFc * bw * d) *
        0.001; // kN
      maxSpacing =
        requiredVs <= vsThreshold
          ? Math.min(
              RCConstants.MAX_STIRRUP_SPACING_LOW_VS_DEPTH_FACTOR * d,
              RCConstants.MAX_STIRRUP_SPACING_LOW_VS,
            )
          : Math.min(
              RCConstants.MAX_STIRRUP_SPACING_HIGH_VS_DEPTH_FACTOR * d,
              RCConstants.MAX_STIRRUP_SPACING_HIGH_VS,
            );
    }

    if (Av !== undefined && s !== undefined) {
      const providedAvOverS = Av / s;
      if (providedAvOverS < requiredAvOverS) {
        warnings.push({
          reference: "ACI318-19, 9.6.3.1",
          message: `Provided Av/s (${MyMath.roundToDecimalPlaces(providedAvOverS, 4)} mm2/mm) < required Av/s (${MyMath.roundToDecimalPlaces(requiredAvOverS, 4)} mm2/mm).`,
        });
      }
      if (maxSpacing !== null && s > maxSpacing) {
        warnings.push({
          reference: "ACI318-19, 9.7.6.2.2",
          message: `Provided spacing s (${s} mm) > max allowed spacing (${MyMath.roundToDecimalPlaces(maxSpacing, 2)} mm).`,
        });
      }
    }
  }

  return {
    required,
    minimumOnly,
    calculationDetails: {
      phiVc,
      halfPhiVc: MyMath.roundToDecimalPlaces(halfPhiVc, 2),
      requiredAvOverS: MyMath.roundToDecimalPlaces(requiredAvOverS, 4),
      maxSpacing: maxSpacing === null ? null : MyMath.roundToDecimalPlaces(maxSpacing, 2),
    },
    unit: "kN",
    warnings,
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

