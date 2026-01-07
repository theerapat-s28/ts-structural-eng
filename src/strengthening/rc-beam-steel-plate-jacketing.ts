import { rectBeamMomentCapacity } from "@app-rc/rc-beam-design";
import { roundToDecimalPlaces } from "src/utils/math";

import { unit } from "@app-core/types/unit.type";

import {
  RectBeamSection,
  RectSinglyBeamSection,
  RectDoublyBeamSection,
  isSinglyReinforced,
} from "@app-core/types/rc-beam.type";

import { SteelJacketedProps } from "@app-core/types/plate-jacketing.type";

import {
  Warnings,
  calculationResult,
} from "@app-core/types/output-message.type";

import { mergeWarnings } from "@app-utils/merge-warning";

export const calculateSteelJacketedBeamMomentCapacity = (
  section: RectBeamSection,
  jacketedProperties: SteelJacketedProps,
) => {
  let warnings: Warnings = [];
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

  // Calculate the moment capacity of the modified section
  let result = rectBeamMomentCapacity(modifiedSection);

  result = { ...result, warnings: mergeWarnings(result.warnings, warnings) };

  return result;
};