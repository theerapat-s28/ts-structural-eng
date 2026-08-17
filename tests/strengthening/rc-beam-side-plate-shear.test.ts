import { describe, it, expect } from "vitest";
import {
  sidePlateShearCapacityByWebYielding,
  sidePlateShearCapacityByTensionTie,
  compareSidePlateShearCapacity,
} from "@app-strg/rc-beam-side-plate-shear";
import { RCDesignError } from "@app-core/errors/rc-design.error";
import { StirrupShearSection } from "@app-core/types/rc-beam.type";
import { SidePlateShearProps, BoltProps } from "@app-core/types/plate-jacketing.type";

// Baseline section, hand calculation:
//   sqrt(fc') = sqrt(35) = 5.9161 MPa
//   Vc    = 0.17*1*5.9161*400*550 = 221,262 N = 221.26 kN  ->  phiVc = 165.95 kN
//   Vs    = 157*400*550/250       = 138,160 N = 138.16 kN  ->  phiVs = 103.62 kN
//   phiVn = 165.95 + 103.62 = 269.57 kN
//   maxVs = 0.66*5.9161*400*550 = 859,014 N = 859.01 kN
//   headroom = 859.01 - 138.16 = 720.85 kN
const section: StirrupShearSection = {
  fc_: 35,
  bw: 400,
  d: 550,
  Av: 157,
  fyt: 400,
  s: 250,
};

// Vertical strips 100 mm wide at 250 mm pitch, both faces: coverage = 100/250 = 0.4
const strips: SidePlateShearProps = {
  fy: 250,
  thickness: 6,
  depth: 500,
  configuration: "strips",
  width: 100,
  spacing: 250,
};

const continuous: SidePlateShearProps = {
  fy: 250,
  thickness: 4,
  depth: 500,
  configuration: "continuous",
};

// M16 bolt: Ase = 157 mm2, futa = 400 MPa, fya = 240 MPa
//   Vsa = 0.6*157*400 = 37,680 N = 37.68 kN  ->  phiVbolt = 0.65*37.68 = 24.49 kN
const m16: BoltProps = { Ase: 157, futa: 400, fya: 240, diameter: 16 };

describe("sidePlateShearCapacityByWebYielding — vertical strips", () => {
  // Vp = 2 * 0.6*250 * 6 * 500 * 0.4 = 360,000 N = 360 kN
  // phiVp = 0.75 * 360 = 270 kN,  phiVn = 269.57 + 270 = 539.57 kN
  const result = sidePlateShearCapacityByWebYielding(section, strips);

  it("reports the unstrengthened capacity", () => {
    expect(result.before.phiVn).toBeCloseTo(269.57, 2);
    expect(result.before.calculationDetails.phiVc).toBeCloseTo(165.95, 2);
    expect(result.before.calculationDetails.phiVs).toBeCloseTo(103.62, 2);
    expect(result.before.unit).toBe("kN");
  });

  it("adds the plate shear yield contribution", () => {
    expect(result.after.calculationDetails.tauY).toBeCloseTo(150, 2);
    expect(result.after.calculationDetails.coverageRatio).toBeCloseTo(0.4, 4);
    expect(result.after.calculationDetails.Vp).toBeCloseTo(360, 2);
    expect(result.after.phiVp).toBeCloseTo(270, 2);
    expect(result.after.phiVn).toBeCloseTo(539.57, 2);
  });

  it("is governed by the plate capacity when no anchorage is supplied", () => {
    expect(result.after.governedBy).toBe("plateCapacity");
    expect(result.after.calculationDetails.phiVanchorage).toBeNull();
  });

  it("warns that the model is not code sanctioned and that anchorage is unchecked", () => {
    expect(result.after.warnings.some((w) => w.message.includes("no provisions"))).toBe(true);
    expect(result.after.warnings.some((w) => w.message.includes("No anchorage"))).toBe(true);
  });

  it("warns on plate slenderness beyond the AISC shear yielding limit", () => {
    // dp/tp = 500/6 = 83.3 > 2.24*sqrt(200000/250) = 63.4
    expect(result.after.calculationDetails.slenderness).toBeCloseTo(83.3, 1);
    expect(result.after.calculationDetails.slendernessLimit).toBeCloseTo(63.4, 1);
    expect(result.after.warnings.some((w) => w.reference === "AISC360-22, G2.1")).toBe(true);
  });

  it("reports the method used", () => {
    expect(result.method).toBe("webYielding");
  });
});

describe("sidePlateShearCapacityByTensionTie — vertical strips", () => {
  // ffe = min(250, 200000*0.004 = 800) = 250 MPa, so the plate reaches yield
  // Vp = 0.85 * 2 * 6 * 250 * 500 * 0.4 * (sin90 + cos90) = 510,000 N = 510 kN
  // phiVp = 0.75 * 510 = 382.5 kN,  phiVn = 269.57 + 382.5 = 652.07 kN
  const result = sidePlateShearCapacityByTensionTie(section, strips);

  it("takes the effective stress as fy when the strain cap does not bind", () => {
    expect(result.after.calculationDetails.ffe).toBeCloseTo(250, 2);
    expect(result.after.calculationDetails.strainLimitedStress).toBeCloseTo(800, 2);
  });

  it("applies psi_f to the plate contribution", () => {
    expect(result.after.calculationDetails.psi).toBe(0.85);
    expect(result.after.calculationDetails.Vp).toBeCloseTo(510, 2);
    expect(result.after.phiVp).toBeCloseTo(382.5, 2);
    expect(result.after.phiVn).toBeCloseTo(652.07, 2);
  });

  it("does not apply the shear buckling check, which is a web yielding concept", () => {
    expect(result.after.warnings.some((w) => w.reference === "AISC360-22, G2.1")).toBe(false);
  });

  it("accounts for the inclination of sloped strips", () => {
    // alpha = 45 deg: sin + cos = 1.4142, against 1.0 vertical, but the pitch
    // measured along the axis is unchanged, so Vp rises by that factor
    const inclined = sidePlateShearCapacityByTensionTie(section, { ...strips, angle: 45 });
    expect(inclined.after.calculationDetails.orientation).toBeCloseTo(1.4142, 3);
    expect(inclined.after.calculationDetails.Vp).toBeCloseTo(510 * 1.4142, 1);
  });
});

describe("side plate shear — anchorage limit", () => {
  // rows = floor(500/250) = 2, both faces, 3 bolts per row:
  //   phiVanchorage = 2 * 2 * 3 * 24.49 = 293.88 kN
  const anchorage = { bolt: m16, boltsPerRow: 3, rowSpacing: 250 };

  it("leaves the web yielding result plate governed", () => {
    // phiVpPlate = 270 kN < 293.88 kN
    const result = sidePlateShearCapacityByWebYielding(section, { ...strips, anchorage });
    expect(result.after.calculationDetails.phiVbolt).toBeCloseTo(24.49, 2);
    expect(result.after.calculationDetails.anchorageRows).toBe(2);
    expect(result.after.calculationDetails.phiVanchorage).toBeCloseTo(293.88, 2);
    expect(result.after.governedBy).toBe("plateCapacity");
    expect(result.after.phiVp).toBeCloseTo(270, 2);
  });

  it("governs the tension tie result and truncates phiVp", () => {
    // phiVpPlate = 382.5 kN > 293.88 kN
    const result = sidePlateShearCapacityByTensionTie(section, { ...strips, anchorage });
    expect(result.after.governedBy).toBe("anchorage");
    expect(result.after.phiVp).toBeCloseTo(293.88, 2);
    expect(result.after.phiVn).toBeCloseTo(269.57 + 293.88, 2);
  });

  it("counts a single row and warns when the row spacing exceeds the plate depth", () => {
    const result = sidePlateShearCapacityByWebYielding(section, {
      ...strips,
      anchorage: { ...anchorage, rowSpacing: 600 },
    });
    expect(result.after.calculationDetails.anchorageRows).toBe(1);
    expect(
      result.after.warnings.some((w) => w.message.includes("exceeds the engaged plate depth")),
    ).toBe(true);
  });

  it("carries the anchor breakout warning through from boltShearCapacity", () => {
    const result = sidePlateShearCapacityByWebYielding(section, { ...strips, anchorage });
    expect(result.after.warnings.some((w) => w.reference === "ACI318-19, 17.7.2")).toBe(true);
  });
});

describe("side plate shear — web crushing cap", () => {
  it("truncates a continuous plate that outruns the remaining web capacity", () => {
    // Tension tie, continuous 4 mm plate:
    //   Vp = 0.85 * 2 * 4 * 250 * 500 = 850 kN > headroom 720.85 kN
    const result = sidePlateShearCapacityByTensionTie(section, continuous);
    expect(result.after.calculationDetails.Vp).toBeCloseTo(850, 2);
    expect(result.after.calculationDetails.headroom).toBeCloseTo(720.85, 2);
    expect(result.after.calculationDetails.VpEffective).toBeCloseTo(720.85, 2);
    expect(result.after.governedBy).toBe("webCrushing");
    expect(result.after.phiVp).toBeCloseTo(540.65, 1);
    expect(result.after.warnings.some((w) => w.reference === "ACI318-19, 22.5.1.2")).toBe(true);
  });

  it("leaves a plate within the headroom untouched", () => {
    // Web yielding, continuous 4 mm plate: Vp = 2*150*4*500 = 600 kN < 720.85 kN
    const result = sidePlateShearCapacityByWebYielding(section, continuous);
    expect(result.after.calculationDetails.Vp).toBeCloseTo(600, 2);
    expect(result.after.governedBy).toBe("plateCapacity");
    expect(result.after.phiVp).toBeCloseTo(450, 2);
  });

  it("throws 206 when the existing stirrups already exhaust the cap", () => {
    // Vs = 1570*400*550/150 = 2302.7 kN, well past maxVs = 859.01 kN
    const overStirruped: StirrupShearSection = { ...section, Av: 1570, s: 150 };
    try {
      sidePlateShearCapacityByWebYielding(overStirruped, strips);
      throw new Error("expected RCDesignError");
    } catch (error) {
      expect(error).toBeInstanceOf(RCDesignError);
      expect((error as RCDesignError).code).toBe(206);
    }
  });
});

describe("side plate shear — sections without stirrups", () => {
  const noStirrups: StirrupShearSection = { ...section, Av: 0, s: 0 };

  it("takes phiVs as zero instead of dividing by a zero spacing", () => {
    const result = sidePlateShearCapacityByWebYielding(noStirrups, strips);
    expect(result.before.calculationDetails.phiVs).toBe(0);
    expect(result.before.phiVn).toBeCloseTo(165.95, 2);
    expect(result.after.calculationDetails.headroom).toBeCloseTo(859.01, 2);
  });
});

describe("side plate shear — geometry validation", () => {
  const expectGeometryError = (plates: SidePlateShearProps, target = section) => {
    try {
      sidePlateShearCapacityByWebYielding(target, plates);
      throw new Error("expected RCDesignError");
    } catch (error) {
      expect(error).toBeInstanceOf(RCDesignError);
      expect((error as RCDesignError).code).toBe(205);
    }
  };

  it("rejects a non-positive thickness or depth", () => {
    expectGeometryError({ ...continuous, thickness: 0 });
    expectGeometryError({ ...continuous, depth: 0 });
  });

  it("rejects a plate deeper than the effective depth", () => {
    expectGeometryError({ ...continuous, depth: 600 });
  });

  it("rejects strips without a width or spacing", () => {
    expectGeometryError({ ...strips, width: undefined });
    expectGeometryError({ ...strips, spacing: undefined });
  });

  it("rejects a strip wider than its pitch", () => {
    expectGeometryError({ ...strips, width: 300, spacing: 250 });
  });

  it("rejects an inclination outside (0, 90]", () => {
    expectGeometryError({ ...strips, angle: 0 });
    expectGeometryError({ ...strips, angle: 120 });
  });

  it("rejects an anchorage with no bolts or no row spacing", () => {
    expectGeometryError({
      ...strips,
      anchorage: { bolt: m16, boltsPerRow: 0, rowSpacing: 250 },
    });
    expectGeometryError({
      ...strips,
      anchorage: { bolt: m16, boltsPerRow: 3, rowSpacing: 0 },
    });
  });
});

describe("side plate shear — detailing warnings", () => {
  it("warns when the strip pitch exceeds the maximum shear reinforcement spacing", () => {
    // max spacing = min(0.5*550, 600) = 275 mm
    const result = sidePlateShearCapacityByWebYielding(section, {
      ...strips,
      width: 100,
      spacing: 400,
    });
    expect(result.after.warnings.some((w) => w.reference === "ACI318-19, 9.7.6.2.2")).toBe(true);
  });

  it("warns when the plate does not span the full effective depth", () => {
    const result = sidePlateShearCapacityByWebYielding(section, strips);
    expect(
      result.after.warnings.some((w) => w.message.includes("less than the effective depth")),
    ).toBe(true);
  });

  it("warns when the 0.004 strain cap holds the plate below yield", () => {
    // A hypothetical high strength plate: fy = 900 MPa > Es*0.004 = 800 MPa
    const result = sidePlateShearCapacityByTensionTie(section, { ...strips, fy: 900 });
    expect(result.after.calculationDetails.ffe).toBeCloseTo(800, 2);
    expect(result.after.warnings.some((w) => w.reference === "ACI440.2R-17, 11.4")).toBe(true);
  });

  it("does not apply the withdrawn ACI 440.2R-08 wf + d/4 strip pitch rule", () => {
    // ACI 440.2R-17 11.4.2 defers to the ACI 318 spacing limits instead, so the only
    // pitch warning is the 9.7.6.2.2 one raised in assembleResult.
    const result = sidePlateShearCapacityByWebYielding(section, strips);
    expect(result.after.warnings.some((w) => w.message.includes("d/4"))).toBe(false);
  });

  it("warns that a one-sided plate loads the section eccentrically", () => {
    const result = sidePlateShearCapacityByWebYielding(section, { ...strips, sides: 1 });
    expect(result.after.warnings.some((w) => w.message.includes("one face only"))).toBe(true);
    // Half the plate, so half the contribution: Vp = 1 * 150 * 6 * 500 * 0.4 = 180 kN
    expect(result.after.calculationDetails.Vp).toBeCloseTo(180, 2);
  });

  it("warns when the bolt row spacing falls below the minimum anchor spacing", () => {
    // 4 * da = 64 mm against a 50 mm row spacing
    const result = sidePlateShearCapacityByWebYielding(section, {
      ...strips,
      anchorage: { bolt: m16, boltsPerRow: 3, rowSpacing: 50 },
    });
    expect(result.after.warnings.some((w) => w.reference === "ACI318-19, 17.9.2")).toBe(true);
  });
});

describe("side plate shear — max strip spacing switches on Vs + Vp", () => {
  // Threshold of ACI 318-19 9.7.6.2.2:
  //   0.33*sqrt(35)*400*550 = 429,509 N = 429.51 kN
  // Low branch  max spacing = min(0.5*550, 600) = 275 mm
  // High branch max spacing = min(0.25*550, 300) = 137.5 mm
  const at200 = { ...strips, width: 100, spacing: 200 }; // coverage 0.5, wp + d/4 = 237.5 > 200

  it("uses the low shear limit when Vs + Vp stays under the threshold", () => {
    // 2 mm plate: Vp = 2 * 150 * 2 * 500 * 0.5 = 150 kN, Vs + Vp = 288.16 kN < 429.51
    const result = sidePlateShearCapacityByWebYielding(section, { ...at200, thickness: 2 });
    expect(result.after.calculationDetails.Vp).toBeCloseTo(150, 2);
    // 200 mm pitch is inside the 275 mm low branch limit, so nothing is raised
    expect(result.after.warnings.some((w) => w.reference === "ACI318-19, 9.7.6.2.2")).toBe(false);
  });

  it("tightens to the high shear limit once the plate pushes Vs + Vp past it", () => {
    // 6 mm plate: Vp = 2 * 150 * 6 * 500 * 0.5 = 450 kN, Vs + Vp = 588.16 kN > 429.51
    const result = sidePlateShearCapacityByWebYielding(section, at200);
    expect(result.after.calculationDetails.Vp).toBeCloseTo(450, 2);
    const spacing = result.after.warnings.find((w) => w.reference === "ACI318-19, 9.7.6.2.2");
    expect(spacing).toBeDefined();
    // Same 200 mm pitch as above, now over the 137.5 mm limit
    expect(spacing?.message).toContain("137.5 mm");
    expect(spacing?.message).toContain("tightened because");
  });

  it("keys the threshold off the truncated Vp, not the raw plate capacity", () => {
    // The tension tie on the same strips: Vp = 0.85 * 2 * 6 * 250 * 500 * 0.5 = 637.5 kN,
    // under the 720.85 kN headroom, so nothing is truncated and the high branch applies
    const result = sidePlateShearCapacityByTensionTie(section, at200);
    expect(result.after.calculationDetails.VpEffective).toBeCloseTo(637.5, 2);
    expect(result.after.warnings.some((w) => w.reference === "ACI318-19, 9.7.6.2.2")).toBe(true);
  });
});

describe("compareSidePlateShearCapacity", () => {
  const comparison = compareSidePlateShearCapacity(section, strips);

  it("returns both models", () => {
    expect(comparison.webYielding.after.phiVn).toBeCloseTo(539.57, 2);
    expect(comparison.tensionTie.after.phiVn).toBeCloseTo(652.07, 2);
  });

  it("reports the lower result as governing", () => {
    expect(comparison.governing.method).toBe("webYielding");
    expect(comparison.governing.phiVn).toBeCloseTo(539.57, 2);
    expect(comparison.governing.phiVp).toBeCloseTo(270, 2);
    expect(comparison.governing.governedBy).toBe("plateCapacity");
  });
});
