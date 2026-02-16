import { rectBeamMomentCapacity } from "@app-rc/rc-beam-design";
import { roundToDecimalPlaces } from "@app-utils/math";

import {
  RectBeamSection,
  RectDoublyBeamSection,
  isSinglyReinforced,
} from "@app-core/types/rc-beam.type";

import { SteelJacketedProps } from "@app-core/types/plate-jacketing.type";

import { Warnings } from "@app-core/types/output-message.type";

import { mergeWarnings } from "@app-utils/merge-warning";

/**
 * Calculates the moment capacity of an RC beam strengthened with steel plate jacketing.
 *
 * Converts steel plate areas into equivalent rebar areas, adjusts the effective depth,
 * and delegates to `rectBeamMomentCapacity` for the actual capacity calculation.
 *
 * @param section - Original beam cross-section properties
 * @param jacketedProperties - Steel plate dimensions, modulus, and yield strength
 * @returns Object containing `phiMn` (kN·m), `calculationDetails`, `unit`, and `warnings`
 */
export const calculateSteelJacketedBeamMomentCapacity = (
  section: RectBeamSection,
  jacketedProperties: SteelJacketedProps,
) => {
  const warnings: Warnings = [];

  // Calculate the moment capacity of the original (before strengthening) section
  const originalResult = rectBeamMomentCapacity(section);

  // Convert steel plate strength to the same as rebar strength
  const n = jacketedProperties.fy / section.fy;

  // Calculate the effective area of the steel plates converted to rebar.
  const plateTopSteelArea =
    n * jacketedProperties.topSteelWidth * jacketedProperties.topSteelThickness;
  const plateBottomSteelArea =
    n *
    jacketedProperties.bottomSteelWidth *
    jacketedProperties.bottomSteelThickness;

  let newD =
    ((jacketedProperties.topSteelThickness + section.d) * section.As +
      (jacketedProperties.topSteelThickness +
        section.h +
        jacketedProperties.bottomSteelThickness / 2) *
      plateBottomSteelArea) /
    (section.As + plateBottomSteelArea);
  let newD_ = undefined;

  let modifiedSection: RectBeamSection;
  // Check if the section is singly or doubly reinforced
  if (isSinglyReinforced(section)) {
    // Singly reinforced section
    modifiedSection = {
      ...section,
      As: section.As + plateBottomSteelArea,
      d: newD,
    };
  } else {
    // Doubly reinforced section
    const doublySection = section as RectDoublyBeamSection;
    newD_ =
      ((jacketedProperties.topSteelThickness + doublySection.d_) *
        doublySection.As_ +
        (jacketedProperties.topSteelThickness / 2) * plateTopSteelArea) /
      (doublySection.As_ + plateTopSteelArea);
    modifiedSection = {
      ...doublySection,
      As: doublySection.As + plateBottomSteelArea,
      As_: doublySection.As_ + plateTopSteelArea,
      d: newD,
      d_: newD_,
    };
  }

  newD = roundToDecimalPlaces(newD, 3);
  if (newD_ !== undefined) {
    newD_ = roundToDecimalPlaces(newD_, 3);
  }

  // Calculate the moment capacity of the modified (after strengthening) section
  let jacketedResult = rectBeamMomentCapacity(modifiedSection);

  jacketedResult = { ...jacketedResult, warnings: mergeWarnings(jacketedResult.warnings, warnings) };

  return {
    before: originalResult,
    after: jacketedResult,
  };
};