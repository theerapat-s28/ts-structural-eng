import { analyzeFrame, memberDemandEnvelope } from "@app-frame/index";
import { rectBeamToSectionProperties, rectBeamMomentCapacity } from "@app-rc/index";
import type { FrameModel } from "@app-frame/types/model.type";

describe("RC beam → frame analysis → demand envelope", () => {
  // Two 5 m spans, 300×600 beam, 40 kN/m factored; rollers at A and C, pin at B
  const section = { Es: 200000, fc_: 28, fy: 420, As: 1800, b: 300, h: 600, d: 540 };
  const { sectionProperties } = rectBeamToSectionProperties(section, { member: "beam" });
  const span = 5000;
  const w = 40;
  const support = { uy: true, uz: true };
  const model: FrameModel = {
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: span, y: 0, z: 0 },
      { id: "C", x: 2 * span, y: 0, z: 0 },
    ],
    members: [
      { id: "AB", startNodeId: "A", endNodeId: "B", section: sectionProperties },
      { id: "BC", startNodeId: "B", endNodeId: "C", section: sectionProperties },
    ],
    restraints: [
      { nodeId: "A", ux: true, rx: true, ...support },
      { nodeId: "B", ...support },
      { nodeId: "C", ...support },
    ],
    memberLoads: [
      { type: "udl", memberId: "AB", direction: "Z", w: -w },
      { type: "udl", memberId: "BC", direction: "Z", w: -w },
    ],
  };
  const result = analyzeFrame(model);

  it("gives the textbook two-span envelope (independent of the section stiffness)", () => {
    const L = span / 1000;
    const env = memberDemandEnvelope(result, "AB");
    expect(env.MuNegative).toBeCloseTo((w * L * L) / 8, 3); // support moment 125 kN·m
    expect(env.MuPositive).toBeCloseTo((9 * w * L * L) / 128, 3); // 9wL²/128 = 70.3125 kN·m
    expect(env.Vu).toBeCloseTo((5 * w * L) / 8, 3); // 5wL/8 at the middle support = 125 kN
  });

  it("takes Vu at the critical distance d from the support faces", () => {
    const env = memberDemandEnvelope(result, "AB", { shearCriticalDistance: 540 });
    expect(env.Vu).toBeCloseTo((5 * w * 5) / 8 - (w * 540) / 1000, 3); // 125 − 21.6
    expect(env.VuRange).toEqual({ from: 540, to: 4460 });
  });

  it("feeds the design check", () => {
    const env = memberDemandEnvelope(result, "AB");
    const { phiMn } = rectBeamMomentCapacity(section);
    expect(phiMn).toBeGreaterThan(env.MuPositive);
  });

  it("throws for an unknown member", () => {
    expect(() => memberDemandEnvelope(result, "nope")).toThrow();
  });
});
