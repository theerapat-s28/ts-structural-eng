import { describe, it, expect } from "vitest";
import {
    concreteShearCapacity,
    stirrupShearCapacity,
    checkStirrupRequirement,
} from "@app-rc/rc-beam-design";
import { RCDesignError } from "@app-core/errors/rc-design.error";

describe("concreteShearCapacity", () => {
    const baseSection = { fc_: 25, bw: 250, d: 450 };

    it("calculates phiVc per ACI318-19 22.5.5.1", () => {
        // Vc = 0.17 * 1 * sqrt(25) * 250 * 450 = 95,625 N = 95.625 kN
        const result = concreteShearCapacity(baseSection);
        expect(result.calculationDetails.Vc).toBeCloseTo(95.63, 1);
        expect(result.phiVc).toBeCloseTo(0.75 * 95.625, 2);
        expect(result.unit).toBe("kN");
    });

    it("applies lambda for lightweight concrete", () => {
        const normal = concreteShearCapacity(baseSection);
        const light = concreteShearCapacity({ ...baseSection, lambda: 0.75 });
        expect(light.phiVc).toBeCloseTo(normal.phiVc * 0.75, 2);
    });

    it("warns when sqrt(fc') exceeds the 8.3 MPa shear limit", () => {
        const highFc = { fc_: 100, bw: 250, d: 450 }; // sqrt(100) = 10 > 8.3
        const result = concreteShearCapacity(highFc);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0].reference).toContain("ACI318-19, 22.5.3.1");
    });
});

describe("stirrupShearCapacity", () => {
    it("calculates phiVs per ACI318-19 22.5.10.5.3", () => {
        // Vs = 157 * 240 * 450 / 150 = 113,040 N = 113.04 kN
        const result = stirrupShearCapacity({
            fc_: 25,
            bw: 250,
            d: 450,
            Av: 157,
            fyt: 240,
            s: 150,
        });
        expect(result.calculationDetails.Vs).toBeCloseTo(113.04, 1);
        expect(result.phiVs).toBeCloseTo(0.75 * 113.04, 1);
        expect(result.unit).toBe("kN");
    });

    it("throws when Vs exceeds the ACI318-19 22.5.1.2 maximum", () => {
        const overloaded = {
            fc_: 25,
            bw: 250,
            d: 450,
            Av: 1000,
            fyt: 400,
            s: 50,
        };
        expect(() => stirrupShearCapacity(overloaded)).toThrow(RCDesignError);
    });
});

describe("checkStirrupRequirement", () => {
    const baseSection = { fc_: 25, bw: 250, d: 450, fyt: 240 };

    it("does not require stirrups when Vu <= 0.5 phiVc", () => {
        const result = checkStirrupRequirement({ ...baseSection, Vu: 10 });
        expect(result.required).toBe(false);
        expect(result.minimumOnly).toBe(false);
    });

    it("requires only minimum stirrups when 0.5 phiVc < Vu <= phiVc", () => {
        // phiVc ~ 71.72 kN, halfPhiVc ~ 35.86 kN
        const result = checkStirrupRequirement({ ...baseSection, Vu: 60 });
        expect(result.required).toBe(true);
        expect(result.minimumOnly).toBe(true);
        expect(result.calculationDetails.requiredAvOverS).toBeGreaterThan(0);
        expect(result.calculationDetails.maxSpacing).toBeGreaterThan(0);
    });

    it("requires strength-based stirrups when Vu > phiVc", () => {
        const result = checkStirrupRequirement({ ...baseSection, Vu: 150 });
        expect(result.required).toBe(true);
        expect(result.minimumOnly).toBe(false);
        expect(result.calculationDetails.requiredAvOverS).toBeGreaterThan(0);
        expect(result.calculationDetails.maxSpacing).toBeGreaterThan(0);
    });

    it("throws when required Vs exceeds the ACI318-19 22.5.1.2 maximum", () => {
        // maxVs ~ 371.25 kN -> Vu/phi - Vc must exceed this
        const hugeVu = { ...baseSection, Vu: 500 };
        expect(() => checkStirrupRequirement(hugeVu)).toThrow(RCDesignError);
    });

    it("warns when provided Av/s is below the required ratio", () => {
        const result = checkStirrupRequirement({
            ...baseSection,
            Vu: 150,
            Av: 50, // deliberately undersized
            s: 200,
        });
        expect(result.warnings.some((w) => w.reference?.includes("9.6.3.1"))).toBe(true);
    });

    it("warns when provided spacing exceeds the max allowed spacing", () => {
        const result = checkStirrupRequirement({
            ...baseSection,
            Vu: 150,
            Av: 300,
            s: 400, // deliberately too wide
        });
        expect(result.warnings.some((w) => w.reference?.includes("9.7.6.2.2"))).toBe(true);
    });

    it("does not warn when provided reinforcement satisfies both requirements", () => {
        const result = checkStirrupRequirement({
            ...baseSection,
            Vu: 150,
            Av: 300,
            s: 150,
        });
        expect(result.warnings.length).toBe(0);
    });
});
