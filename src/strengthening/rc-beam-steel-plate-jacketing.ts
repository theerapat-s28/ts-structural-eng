import { rectBeamMomentCapacity } from "@app-rc/rc-beam-design";
import { roundToDecimalPlaces } from "@app-utils/math";

import {
  RectBeamSection,
  RectDoublyBeamSection,
  isSinglyReinforced,
} from "@app-core/types/rc-beam.type";

import {
  SteelJacketedProps,
  hasTopPlate,
  hasBottomPlate,
} from "@app-core/types/plate-jacketing.type";

import { Warnings } from "@app-core/types/output-message.type";

import { mergeWarnings } from "@app-utils/merge-warning";

/**
 * Calculates the moment capacity of an RC beam strengthened with steel plate jacketing.
 *
 * Converts steel plate areas into equivalent rebar areas, adjusts the effective depth,
 * and delegates to `rectBeamMomentCapacity` for the actual capacity calculation.
 *
 * The bottom plate is added to the tension steel and the top plate to the
 * compression steel — including on an originally singly reinforced section,
 * which a top plate turns into a doubly reinforced one.
 *
 * @param section - Original beam cross-section properties
 * @param jacketedProperties - Steel plate dimensions, modulus, and yield strength
 * @returns `before` and `after` results, each with `phiMn` (kN·m), `calculationDetails`,
 *   `unit`, and `warnings`
 * @throws {RCDesignError} 102 if either section is not tension controlled — the
 *   added plate steel can push a jacketed section out of the tension-controlled region
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

  // A plate only counts when both its width and thickness are positive, so a
  // bottom-only jacket may omit the top plate fields entirely.
  const topSteelThickness = hasTopPlate(jacketedProperties)
    ? (jacketedProperties.topSteelThickness as number)
    : 0;
  const bottomSteelThickness = hasBottomPlate(jacketedProperties)
    ? (jacketedProperties.bottomSteelThickness as number)
    : 0;

  // Calculate the effective area of the steel plates converted to rebar.
  const plateTopSteelArea = hasTopPlate(jacketedProperties)
    ? n * (jacketedProperties.topSteelWidth as number) * topSteelThickness
    : 0;
  const plateBottomSteelArea = hasBottomPlate(jacketedProperties)
    ? n * (jacketedProperties.bottomSteelWidth as number) * bottomSteelThickness
    : 0;

  // Existing compression steel, if any. A section the type guard reports as
  // singly reinforced contributes nothing here, but a top plate still can.
  const existingAs_ = isSinglyReinforced(section) ? 0 : (section as RectDoublyBeamSection).As_;
  const existingD_ = isSinglyReinforced(section) ? 0 : (section as RectDoublyBeamSection).d_;

  // Depths stay measured from the extreme concrete compression fibre — the top
  // face of the concrete — so the equivalent rectangular stress block that
  // `rectBeamMomentCapacity` lays down from that datum covers concrete only.
  // Existing depths are therefore unchanged; the bottom plate sits below the
  // soffit and the top plate above the datum, at a negative depth.
  const newD = roundToDecimalPlaces(
    (section.d * section.As + (section.h + bottomSteelThickness / 2) * plateBottomSteelArea) /
      (section.As + plateBottomSteelArea),
    3,
  );

  const jacketedAs_ = existingAs_ + plateTopSteelArea;

  let modifiedSection: RectBeamSection;
  if (jacketedAs_ <= 0) {
    // No compression steel and no top plate — the jacketed section stays singly
    // reinforced.
    modifiedSection = {
      ...section,
      As: section.As + plateBottomSteelArea,
      d: newD,
    };
  } else {
    // A top plate acts as compression steel, so a bare singly reinforced
    // section becomes doubly reinforced once one is added. Its centroid is half
    // a plate thickness above the concrete face, hence the negative depth.
    const newD_ = roundToDecimalPlaces(
      (existingD_ * existingAs_ + (-topSteelThickness / 2) * plateTopSteelArea) / jacketedAs_,
      3,
    );
    modifiedSection = {
      ...section,
      As: section.As + plateBottomSteelArea,
      As_: jacketedAs_,
      d: newD,
      d_: newD_,
    };
  }

  // Calculate the moment capacity of the modified (after strengthening) section
  let jacketedResult = rectBeamMomentCapacity(modifiedSection);

  jacketedResult = {
    ...jacketedResult,
    warnings: mergeWarnings(jacketedResult.warnings, warnings),
  };

  return {
    before: originalResult,
    after: jacketedResult,
  };
};
