import { describe, it, expect } from "vitest";
import { rectBeamMomentCapacity } from "@app-rc/rc-beam-design";
import { RCDesignError } from "@app-core/errors/rc-design.error";

describe("rectBeamMomentCapacity", () => {
  const baseSinglySection = {
    Es: 207_000,
    fc_: 25,
    fy: 400,
    As: 1520, // 4-DB22
    b: 250,
    h: 500,
    d: 450,
  };

  const baseDoublySection = {
    ...baseSinglySection,
    As_: 603, // 2-DB20
    d_: 50,
  };

  it("calculates phiMn for a singly reinforced section", () => {
    const result = rectBeamMomentCapacity(baseSinglySection);
    expect(result.phiMn).toBeGreaterThan(0);
    expect(result.unit).toBe("kN-m");
    expect(result.warnings).toBeDefined();
  });

  it("calculates phiMn for a doubly reinforced section", () => {
    const result = rectBeamMomentCapacity(baseDoublySection);
    expect(result.phiMn).toBeGreaterThan(0);
    expect(result.unit).toBe("kN-m");
    expect(result.calculationDetails).toHaveProperty("c");
    expect(result.calculationDetails).toHaveProperty("a");
  });

  it("adds a warning when As < minimum steel", () => {
    const tinyAs = { ...baseSinglySection, As: 50 };
    const result = rectBeamMomentCapacity(tinyAs);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].reference).toContain("ACI318");
  });

  it("adds a warning when fy > 550 MPa", () => {
    // Use a large beam with low reinforcement ratio so it stays tension-controlled at fy=600
    const highFy = {
      Es: 207_000,
      fc_: 25,
      fy: 600,
      As: 400,
      b: 300,
      h: 600,
      d: 550,
    };
    const result = rectBeamMomentCapacity(highFy);
    const fyWarning = result.warnings.find((w: { message: string }) => w.message.includes("550"));
    expect(fyWarning).toBeDefined();
  });

  it("passes As_ through as compression rebar in calculationDetails", () => {
    const result = rectBeamMomentCapacity(baseDoublySection);
    expect(result.calculationDetails).toHaveProperty("As_", baseDoublySection.As_);
    expect(result.calculationDetails).toHaveProperty("d_", baseDoublySection.d_);
    expect(result.calculationDetails.fs_).toBeGreaterThan(0);
    expect(result.calculationDetails.ro_).toBeGreaterThan(0);
  });

  it("reports the same calculationDetails keys for singly and doubly sections", () => {
    const singly = rectBeamMomentCapacity(baseSinglySection);
    const doubly = rectBeamMomentCapacity(baseDoublySection);

    // Everything the singly branch reports must also come back from the doubly
    // branch, so callers can read c / a / d / As without branching first.
    for (const key of Object.keys(singly.calculationDetails)) {
      expect(doubly.calculationDetails).toHaveProperty(key);
    }
    expect(Object.keys(singly.calculationDetails)).toEqual(
      expect.arrayContaining(["c", "a", "beta1", "d", "As", "ro"]),
    );
  });

  it("reports ro and ro_ on the same basis", () => {
    const { ro, ro_ } = rectBeamMomentCapacity(baseDoublySection).calculationDetails;
    const { As, As_, b, d } = baseDoublySection;

    expect(ro_).toBeDefined();
    expect(ro).toBeCloseTo(As / (b * d), 6);
    expect(ro_ ?? 0).toBeCloseTo(As_ / (b * d), 6);
    // The two ratios are comparable, so their quotient is just the steel ratio.
    expect((ro_ ?? 0) / ro).toBeCloseTo(As_ / As, 3);
  });

  it("doubly reinforced phiMn ≥ singly reinforced phiMn", () => {
    const singly = rectBeamMomentCapacity(baseSinglySection);
    const doubly = rectBeamMomentCapacity(baseDoublySection);
    expect(doubly.phiMn).toBeGreaterThanOrEqual(singly.phiMn);
  });

  describe("compression steel strain compatibility", () => {
    // 150x300 with 4-DB12 top and bottom — symmetric light reinforcement puts
    // the compression steel just below the neutral axis (c ≈ 69.6 < d' = 70.5).
    const compSteelBelowNA = {
      Es: 200_000,
      fc_: 24,
      fy: 392,
      As: 452.4,
      As_: 452.4,
      b: 150,
      h: 300,
      d: 229.5,
      d_: 70.5,
    };

    it("returns a capacity with a warning when d' > c instead of throwing", () => {
      const result = rectBeamMomentCapacity(compSteelBelowNA);

      expect(result.phiMn).toBeGreaterThan(0);
      expect(result.calculationDetails.c).toBeLessThan(compSteelBelowNA.d_);

      const warning = result.warnings.find((w: { message: string }) => w.message.includes("d'"));
      expect(warning).toBeDefined();
      expect(warning?.reference).toBe("ACI318-19, 22.2.1.2");
    });

    it("treats compression steel below the neutral axis as being in tension", () => {
      const result = rectBeamMomentCapacity(compSteelBelowNA);
      // A negative fs_ is the whole point: that steel pulls rather than pushes.
      expect(result.calculationDetails.fs_).toBeLessThan(0);

      // Sitting a hair below the neutral axis, it carries almost no force, so
      // the result must stay within 1% of the same section without it — the
      // equilibrium shifts but the capacity barely moves.
      const { As_, d_, ...singly } = compSteelBelowNA;
      const singlyResult = rectBeamMomentCapacity(singly);
      expect(result.phiMn).toBeCloseTo(singlyResult.phiMn, 0);
      expect(Math.abs(result.phiMn - singlyResult.phiMn) / singlyResult.phiMn).toBeLessThan(0.01);
    });

    it("caps fs_ at fy when the compression steel yields", () => {
      // Heavy tension steel with shallow compression steel: the elastic solve
      // returns fs_ ≈ 467 MPa, above fy, so equilibrium must be re-solved.
      const compSteelYields = {
        Es: 200_000,
        fc_: 24,
        fy: 392,
        As: 3189,
        As_: 800,
        b: 300,
        h: 560,
        d: 500,
        d_: 40,
      };

      const result = rectBeamMomentCapacity(compSteelYields);
      expect(result.calculationDetails.fs_).toBe(compSteelYields.fy);
      // c follows from equilibrium with the compression steel at yield.
      expect(result.calculationDetails.c).toBeCloseTo(180.0, 1);
    });
  });
});
