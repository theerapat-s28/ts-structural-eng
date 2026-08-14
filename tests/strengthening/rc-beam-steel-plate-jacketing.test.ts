import { describe, it, expect } from "vitest";
import { calculateSteelJacketedBeamMomentCapacity } from "@app-strg/rc-beam-steel-plate-jacketing";

describe("calculateSteelJacketedBeamMomentCapacity", () => {
  const singlySection = {
    Es: 200_000,
    fc_: 28,
    fy: 390,
    As: 1472.6, // 3-DB25
    b: 300,
    h: 500,
    d: 440,
  };

  const doublySection = {
    ...singlySection,
    As_: 763.4, // 2-DB22
    d_: 50,
  };

  const plateMaterial = { Es: 200_000, fy: 245 }; // SS400

  it("increases capacity with a bottom plate", () => {
    const result = calculateSteelJacketedBeamMomentCapacity(singlySection, {
      ...plateMaterial,
      bottomSteelWidth: 300,
      bottomSteelThickness: 6,
    });

    expect(result.after.phiMn).toBeGreaterThan(result.before.phiMn);
    expect(result.before.unit).toBe("kN-m");
  });

  it("applies a top plate to an originally singly reinforced section", () => {
    const bottomOnly = calculateSteelJacketedBeamMomentCapacity(singlySection, {
      ...plateMaterial,
      bottomSteelWidth: 300,
      bottomSteelThickness: 6,
    });

    const bothPlates = calculateSteelJacketedBeamMomentCapacity(singlySection, {
      ...plateMaterial,
      topSteelWidth: 300,
      topSteelThickness: 6,
      bottomSteelWidth: 300,
      bottomSteelThickness: 6,
    });

    // The top plate must actually reach the calculation: a singly reinforced
    // section becomes doubly reinforced once one is present.
    expect(bothPlates.after.calculationDetails.As_).toBeGreaterThan(0);
    expect(bothPlates.after.phiMn).not.toBe(bottomOnly.after.phiMn);
  });

  it("places a top plate above the concrete face, at a negative depth", () => {
    const topThickness = 8;
    const result = calculateSteelJacketedBeamMomentCapacity(singlySection, {
      ...plateMaterial,
      topSteelWidth: 300,
      topSteelThickness: topThickness,
      bottomSteelWidth: 300,
      bottomSteelThickness: 6,
    });

    // Depths are measured from the extreme concrete compression fibre, so a
    // plate bonded on top of the beam sits half its thickness above it.
    expect(result.after.calculationDetails.d_).toBeCloseTo(-topThickness / 2, 3);
  });

  it("keeps the concrete stress block clear of the top plate", () => {
    const bottomThickness = 6;
    const withTopPlate = calculateSteelJacketedBeamMomentCapacity(singlySection, {
      ...plateMaterial,
      topSteelWidth: 300,
      topSteelThickness: 10,
      bottomSteelWidth: 300,
      bottomSteelThickness: bottomThickness,
    });

    // Adding a top plate must not shift the datum: d stays the tension centroid
    // measured from the concrete face, so the stress block laid down from that
    // datum covers concrete only and never spills into the plate.
    const n = plateMaterial.fy / singlySection.fy;
    const bottomPlateAs = n * 300 * bottomThickness;
    const expectedD =
      (singlySection.d * singlySection.As +
        (singlySection.h + bottomThickness / 2) * bottomPlateAs) /
      (singlySection.As + bottomPlateAs);

    expect(withTopPlate.after.calculationDetails.d).toBeCloseTo(expectedD, 2);
    expect(withTopPlate.after.calculationDetails.a).toBeLessThanOrEqual(singlySection.h);
  });

  it("adds the existing compression steel and the top plate together", () => {
    const topThickness = 6;
    const result = calculateSteelJacketedBeamMomentCapacity(doublySection, {
      ...plateMaterial,
      topSteelWidth: 300,
      topSteelThickness: topThickness,
      bottomSteelWidth: 300,
      bottomSteelThickness: 6,
    });

    const n = plateMaterial.fy / doublySection.fy;
    const plateAs_ = n * 300 * topThickness;
    expect(result.after.calculationDetails.As_).toBeCloseTo(doublySection.As_ + plateAs_, 3);

    // The combined centroid is the area-weighted mean of the rebar depth and
    // the plate depth, so it lies between them.
    const expectedD_ =
      (doublySection.d_ * doublySection.As_ + (-topThickness / 2) * plateAs_) /
      (doublySection.As_ + plateAs_);
    expect(result.after.calculationDetails.d_).toBeCloseTo(expectedD_, 3);
    expect(result.after.calculationDetails.d_).toBeLessThan(doublySection.d_);
    expect(result.after.calculationDetails.d_).toBeGreaterThan(-topThickness / 2);
  });

  it("leaves a bottom-only jacket unaffected by the datum convention", () => {
    // With no top plate the datum never moved even under the old convention,
    // so this result must be identical to the pre-1.4.0 value — a regression
    // guard on the far more common bottom-only jacket.
    const result = calculateSteelJacketedBeamMomentCapacity(singlySection, {
      ...plateMaterial,
      bottomSteelWidth: 300,
      bottomSteelThickness: 6,
    });

    expect(result.before.phiMn).toBe(206.64);
    expect(result.after.phiMn).toBe(362.1);
  });

  it("ignores a plate given a width but no thickness", () => {
    const withPlate = calculateSteelJacketedBeamMomentCapacity(singlySection, {
      ...plateMaterial,
      topSteelWidth: 300,
      bottomSteelWidth: 300,
      bottomSteelThickness: 6,
    });
    const withoutPlate = calculateSteelJacketedBeamMomentCapacity(singlySection, {
      ...plateMaterial,
      bottomSteelWidth: 300,
      bottomSteelThickness: 6,
    });

    expect(withPlate.after.phiMn).toBe(withoutPlate.after.phiMn);
  });

  it("returns the unjacketed capacity as `before`", () => {
    const result = calculateSteelJacketedBeamMomentCapacity(singlySection, {
      ...plateMaterial,
      bottomSteelWidth: 300,
      bottomSteelThickness: 6,
    });

    expect(result.before.calculationDetails.ro).toBeCloseTo(
      singlySection.As / (singlySection.b * singlySection.d),
      6,
    );
  });
});
