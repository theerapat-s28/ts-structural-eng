import {
  BEAM_INERTIA_MODIFIER,
  COLUMN_INERTIA_MODIFIER,
  CONCRETE_POISSON_RATIO,
} from "@app-core/constants/frame.constant";
import type { Warnings } from "@app-core/types/output-message.type";
import type { RectBeamSection } from "@app-core/types/rc-beam.type";
import type { SectionProperties } from "@app-core/types/section-properties.type";

import { concreteElasticModulus } from "./general";

export interface SectionPropertiesOptions {
  /** Picks the ACI 318-19 6.6.3.1.1 inertia modifier: 0.35 beam, 0.70 column, 1.0 gross. Default "beam". */
  member?: "beam" | "column" | "gross";
  /** Overrides the modifier chosen by `member`. */
  inertiaModifier?: number;
  /** Poisson's ratio for G = E / (2(1 + ν)). Default 0.2. */
  poissonRatio?: number;
}

/**
 * Saint-Venant torsion constant of a solid rectangle:
 * `J = a·t³·(1/3 − 0.21·(t/a)·(1 − t⁴/(12a⁴)))`, with a the longer and t the shorter side.
 */
const rectangleTorsionConstant = (b: number, h: number): number => {
  const a = Math.max(b, h);
  const t = Math.min(b, h);
  return a * t ** 3 * (1 / 3 - 0.21 * (t / a) * (1 - t ** 4 / (12 * a ** 4)));
};

/**
 * Converts a rectangular RC beam section into `SectionProperties` for frame analysis.
 *
 * Local 2 is taken along the depth `h` and local 3 along the width `b`, so
 * `I33 = m·b·h³/12` (major axis) and `I22 = m·h·b³/12`, where m is the inertia modifier.
 * The modifier is applied to the bending inertias only; A and J are gross values.
 *
 * @param section - Rectangular RC section (uses `fc_`, `b` and `h`)
 * @param options - Member type or explicit inertia modifier, Poisson's ratio
 * @returns Object containing `sectionProperties`, `calculationDetails`, `unit`, and `warnings`
 */
export const rectBeamToSectionProperties = (
  section: Pick<RectBeamSection, "fc_" | "b" | "h">,
  options: SectionPropertiesOptions = {},
) => {
  const warnings: Warnings = [];
  const member = options.member ?? "beam";
  const modifier =
    options.inertiaModifier ??
    (member === "beam" ? BEAM_INERTIA_MODIFIER : member === "column" ? COLUMN_INERTIA_MODIFIER : 1);
  const nu = options.poissonRatio ?? CONCRETE_POISSON_RATIO;
  const { fc_, b, h } = section;

  if (modifier === 1) {
    warnings.push({
      reference: "ACI318-19, 6.6.3.1.1",
      message:
        "Gross-section inertia used; elastic analysis at factored load level should use the reduced moments of inertia (0.35Ig beams, 0.70Ig columns).",
    });
  }

  const E = concreteElasticModulus(fc_);
  const sectionProperties: SectionProperties = {
    E,
    G: E / (2 * (1 + nu)),
    A: b * h,
    I22: (modifier * h * b ** 3) / 12,
    I33: (modifier * b * h ** 3) / 12,
    J: rectangleTorsionConstant(b, h),
  };

  return {
    sectionProperties,
    calculationDetails: { inertiaModifier: modifier, poissonRatio: nu },
    unit: "N, mm, MPa",
    warnings,
  };
};
