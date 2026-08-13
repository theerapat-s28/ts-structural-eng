import { describe, it, expect } from "vitest";
import {
  plateInterfaceShearFlow,
  boltShearCapacity,
  plateInterfaceBoltRequirement,
} from "@app-strg/rc-beam-plate-interface-bolts";
import { RCDesignError } from "@app-core/errors/rc-design.error";
import { RectBeamSection } from "@app-core/types/rc-beam.type";
import { SteelJacketedProps, BoltProps } from "@app-core/types/plate-jacketing.type";

const singlySection: RectBeamSection = {
  Es: 200000,
  fc_: 28,
  fy: 400,
  As: 1200,
  b: 300,
  h: 500,
  d: 440,
};

const doublySection: RectBeamSection = {
  ...singlySection,
  As_: 600,
  d_: 50,
};

const bottomOnly: SteelJacketedProps = {
  Es: 200000,
  fy: 250,
  bottomSteelWidth: 200,
  bottomSteelThickness: 10,
};

const topAndBottom: SteelJacketedProps = {
  ...bottomOnly,
  topSteelWidth: 200,
  topSteelThickness: 10,
};

// M16 bolt: Ase = 157 mm2, futa = 400 MPa, fya = 240 MPa
const m16: BoltProps = { Ase: 157, futa: 400, fya: 240, diameter: 16 };

describe("plateInterfaceShearFlow — bottom plate only", () => {
  // Hand calculation, cracked transformed section, datum at the concrete top face:
  //   Ec = 4700*sqrt(28) = 24870.1 MPa, n = 200000/24870.1 = 8.042
  //   NA:  150*y^2 + 25733.8*y - 12,368,306 = 0  ->  ybar = 213.9 mm
  //   Itr = 300*213.9^3/3 + 9650*(440-213.9)^2 + 16084*(505-213.9)^2 + 200*10^3/12*8.042
  //       = 2.835e9 mm^4
  //   Q   = 8.042*2000*(505-213.9) = 4.682e6 mm^3
  //   q   = 150000*4.682e6/2.835e9 = 247.7 N/mm
  const result = plateInterfaceShearFlow({
    section: singlySection,
    plates: bottomOnly,
    V: 150,
  });

  it("solves the cracked neutral axis and transformed inertia", () => {
    expect(result.calculationDetails.ybar).toBeCloseTo(213.9, 0);
    expect(result.calculationDetails.Itr).toBeCloseTo(2.835e9, -7);
    expect(result.calculationDetails.sectionState).toBe("cracked");
  });

  it("calculates q = VQ/I at the bottom interface", () => {
    expect(result.bottom).not.toBeNull();
    expect(result.bottom!.Q).toBeCloseTo(4.682e6, -4);
    expect(result.bottom!.q).toBeCloseTo(247.7, 0);
    expect(result.unit).toBe("N/mm");
  });

  it("returns null for the absent top interface", () => {
    expect(result.top).toBeNull();
  });

  it("scales linearly with the applied shear", () => {
    const doubled = plateInterfaceShearFlow({
      section: singlySection,
      plates: bottomOnly,
      V: 300,
    });
    expect(doubled.bottom!.q).toBeCloseTo(2 * result.bottom!.q, 1);
  });
});

describe("plateInterfaceShearFlow — top and bottom plates", () => {
  const both = plateInterfaceShearFlow({
    section: doublySection,
    plates: topAndBottom,
    V: 150,
  });

  it("returns a result at each interface", () => {
    expect(both.top).not.toBeNull();
    expect(both.bottom).not.toBeNull();
  });

  it("gives the top plate a much smaller q than the bottom plate", () => {
    // The top plate sits near the compression face, so its lever arm to the
    // neutral axis is short.
    expect(both.top!.leverArm).toBeLessThan(both.bottom!.leverArm);
    expect(both.top!.q).toBeLessThan(both.bottom!.q);
  });

  it("changes the bottom interface q compared with a bottom-only jacket", () => {
    // Adding the top plate stiffens the section and shifts the neutral axis,
    // so the two interfaces cannot be computed independently.
    const bottomOnlyResult = plateInterfaceShearFlow({
      section: doublySection,
      plates: bottomOnly,
      V: 150,
    });
    expect(both.bottom!.q).not.toBeCloseTo(bottomOnlyResult.bottom!.q, 1);
    expect(both.calculationDetails.Itr).toBeGreaterThan(bottomOnlyResult.calculationDetails.Itr);
  });
});

describe("plateInterfaceShearFlow — section state", () => {
  it("gives a lower q on the uncracked section than the cracked one", () => {
    const cracked = plateInterfaceShearFlow({
      section: singlySection,
      plates: bottomOnly,
      V: 150,
      sectionState: "cracked",
    });
    const uncracked = plateInterfaceShearFlow({
      section: singlySection,
      plates: bottomOnly,
      V: 150,
      sectionState: "uncracked",
    });
    expect(uncracked.calculationDetails.Itr).toBeGreaterThan(cracked.calculationDetails.Itr);
    expect(uncracked.bottom!.q).toBeLessThan(cracked.bottom!.q);
    expect(uncracked.calculationDetails.sectionState).toBe("uncracked");
  });
});

describe("plateInterfaceShearFlow — errors", () => {
  it("throws 201 when V is not positive", () => {
    expect(() =>
      plateInterfaceShearFlow({
        section: singlySection,
        plates: bottomOnly,
        V: 0,
      }),
    ).toThrow(RCDesignError);
    try {
      plateInterfaceShearFlow({
        section: singlySection,
        plates: bottomOnly,
        V: 0,
      });
    } catch (error) {
      expect((error as RCDesignError).code).toBe(201);
    }
  });

  it("throws 201 when neither plate is present", () => {
    try {
      plateInterfaceShearFlow({
        section: singlySection,
        plates: { Es: 200000, fy: 250 },
        V: 150,
      });
    } catch (error) {
      expect((error as RCDesignError).code).toBe(201);
    }
  });

  it("throws 203 when d does not lie within h", () => {
    try {
      plateInterfaceShearFlow({
        section: { ...singlySection, d: 600 },
        plates: bottomOnly,
        V: 150,
      });
    } catch (error) {
      expect((error as RCDesignError).code).toBe(203);
    }
  });
});

describe("boltShearCapacity", () => {
  it("calculates phiVsa per ACI318-19 17.7.1.2b", () => {
    // Vsa = 0.6 * 157 * 400 = 37,680 N; phiVsa = 0.65 * 37.68 = 24.49 kN
    const result = boltShearCapacity(m16);
    expect(result.calculationDetails.Vsa).toBeCloseTo(37.68, 2);
    expect(result.phiVbolt).toBeCloseTo(24.49, 2);
    expect(result.unit).toBe("kN");
  });

  it("scales with the number of shear planes", () => {
    const single = boltShearCapacity(m16);
    const double = boltShearCapacity({ ...m16, shearPlanes: 2 });
    expect(double.phiVbolt).toBeCloseTo(2 * single.phiVbolt, 2);
  });

  it("always warns that breakout and pryout are not checked", () => {
    const result = boltShearCapacity(m16);
    expect(result.warnings.some((w) => w.reference === "ACI318-19, 17.7.2")).toBe(true);
  });

  it("caps futa at min(1.9*fya, 860) and warns", () => {
    // 1.9 * 240 = 456 MPa < futa = 800 MPa
    const result = boltShearCapacity({ ...m16, futa: 800 });
    expect(result.calculationDetails.futaEffective).toBeCloseTo(456, 2);
    expect(result.warnings.some((w) => w.reference === "ACI318-19, 17.6.1.2")).toBe(true);
  });

  it("uses phiVboltOverride when supplied", () => {
    const result = boltShearCapacity({ ...m16, phiVboltOverride: 30 });
    expect(result.phiVbolt).toBe(30);
    expect(result.calculationDetails.source).toBe("override");
  });

  it("throws 202 on a non-positive capacity", () => {
    try {
      boltShearCapacity({ ...m16, Ase: 0 });
    } catch (error) {
      expect((error as RCDesignError).code).toBe(202);
    }
  });
});

describe("plateInterfaceBoltRequirement", () => {
  const design = plateInterfaceBoltRequirement({
    section: singlySection,
    plates: bottomOnly,
    V: 150,
    bolt: m16,
    boltsPerRow: 2,
    transferLength: 2000,
  });

  it("derives the bolt pitch from the interface shear flow", () => {
    // s = 2 * 24,492 N / 247.7 N/mm = 197.8 mm
    expect(design.bottom!.requiredSpacing).toBeCloseTo(197.8, 0);
  });

  it("counts bolt rows over the transfer length", () => {
    // rows = ceil(2000 / 197.8) + 1 = 12, at 2 bolts per row
    expect(design.bottom!.calculationDetails.rows).toBe(12);
    expect(design.bottom!.calculationDetails.boltCountFromShearFlow).toBe(24);
  });

  it("also checks the full plate yield force", () => {
    // Ap*fy = 2000 * 250 = 500 kN; ceil(500 / 24.49) = 21 bolts
    expect(design.bottom!.calculationDetails.plateForce).toBeCloseTo(500, 1);
    expect(design.bottom!.calculationDetails.boltCountFromPlateForce).toBe(21);
  });

  it("reports the governing requirement and the larger count", () => {
    expect(design.bottom!.governedBy).toBe("shearFlow");
    expect(design.bottom!.boltCount).toBe(24);
  });

  it("lets the plate force govern when the shear flow is low", () => {
    const lowShear = plateInterfaceBoltRequirement({
      section: singlySection,
      plates: bottomOnly,
      V: 20,
      bolt: m16,
      boltsPerRow: 2,
      transferLength: 2000,
    });
    expect(lowShear.bottom!.governedBy).toBe("plateForce");
    expect(lowShear.bottom!.boltCount).toBe(
      lowShear.bottom!.calculationDetails.boltCountFromPlateForce,
    );
  });

  it("caps the pitch at the detailing limit and warns", () => {
    const lowShear = plateInterfaceBoltRequirement({
      section: singlySection,
      plates: bottomOnly,
      V: 20,
      bolt: m16,
      boltsPerRow: 2,
      transferLength: 2000,
    });
    expect(lowShear.bottom!.requiredSpacing).toBe(300);
    expect(lowShear.warnings.some((w) => w.message.includes("detailing limit"))).toBe(true);
  });

  it("warns when the required pitch falls below 4*da", () => {
    // A single small bolt against a heavy shear demand forces a tight pitch.
    const tight = plateInterfaceBoltRequirement({
      section: singlySection,
      plates: bottomOnly,
      V: 400,
      bolt: { Ase: 20, futa: 400, fya: 240, diameter: 30 },
      boltsPerRow: 1,
      transferLength: 2000,
    });
    expect(tight.warnings.some((w) => w.reference === "ACI318-19, 17.9.2")).toBe(true);
  });

  it("designs both interfaces for a top-and-bottom jacket", () => {
    const both = plateInterfaceBoltRequirement({
      section: doublySection,
      plates: topAndBottom,
      V: 150,
      bolt: m16,
      boltsPerRow: 2,
      transferLength: 2000,
    });
    expect(both.top).not.toBeNull();
    expect(both.bottom).not.toBeNull();
    // The top plate carries little shear flow, so developing its yield force controls.
    expect(both.top!.governedBy).toBe("plateForce");
  });

  it("throws 203 on a non-positive transfer length", () => {
    try {
      plateInterfaceBoltRequirement({
        section: singlySection,
        plates: bottomOnly,
        V: 150,
        bolt: m16,
        boltsPerRow: 2,
        transferLength: 0,
      });
    } catch (error) {
      expect((error as RCDesignError).code).toBe(203);
    }
  });
});
