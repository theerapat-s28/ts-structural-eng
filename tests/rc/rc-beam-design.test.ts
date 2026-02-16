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

    it("doubly reinforced phiMn ≥ singly reinforced phiMn", () => {
        const singly = rectBeamMomentCapacity(baseSinglySection);
        const doubly = rectBeamMomentCapacity(baseDoublySection);
        expect(doubly.phiMn).toBeGreaterThanOrEqual(singly.phiMn);
    });
});
