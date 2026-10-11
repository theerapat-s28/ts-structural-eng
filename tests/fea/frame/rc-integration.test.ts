import { analyzeFrame, memberDemandEnvelope } from "@app-fea/frame/index";
import { rectBeamToSectionProperties, rectBeamMomentCapacity } from "@app-rc/index";
import type { FrameModel } from "@app-fea/frame/types/model.type";

describe("RC beam → load cases → combinations → demand envelope", () => {
  // Two 5 m spans, 300×600 beam; rollers at A and C, pin at B.
  // D = self-weight (24 kN/m³ · 0.18 m² = 4.32 kN/m), SD = 10 kN/m, L = 15 kN/m.
  const section = { Es: 200000, fc_: 28, fy: 420, As: 1800, b: 300, h: 600, d: 540 };
  const { sectionProperties } = rectBeamToSectionProperties(section, { member: "beam" });
  const span = 5000;
  const L = span / 1000;
  const support = { uy: true, uz: true };
  const udl = (loadCase: string, memberId: string, w: number) =>
    ({ loadCase, type: "udl", memberId, direction: "Z", w }) as const;
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
    loadCases: [
      { id: "D", type: "dead", selfWeight: 1 },
      { id: "SD", type: "superDead" },
      { id: "L", type: "live" },
    ],
    memberLoads: [
      udl("SD", "AB", -10),
      udl("SD", "BC", -10),
      udl("L", "AB", -15),
      udl("L", "BC", -15),
    ],
    combinations: [
      {
        id: "DEAD",
        terms: [
          { case: "D", factor: 1 },
          { case: "SD", factor: 1 },
        ],
      },
      { id: "1.4D", terms: [{ combination: "DEAD", factor: 1.4 }] },
      {
        id: "1.2D+1.6L",
        terms: [
          { combination: "DEAD", factor: 1.2 },
          { case: "L", factor: 1.6 },
        ],
      },
    ],
  };
  const result = analyzeFrame(model);
  const wU = 1.2 * (4.32 + 10) + 1.6 * 15; // 41.184 kN/m

  it("gives the textbook two-span envelope for the governing combination", () => {
    const env = memberDemandEnvelope(result, "AB", { combinations: ["1.4D", "1.2D+1.6L"] });
    expect(env.MuNegative).toBeCloseTo((wU * L * L) / 8, 3); // 128.7 kN·m at the middle support
    expect(env.MuPositive).toBeCloseTo((9 * wU * L * L) / 128, 3); // 72.39375 kN·m
    expect(env.Vu).toBeCloseTo((5 * wU * L) / 8, 3); // 128.7 kN
    expect(env.governing).toEqual({
      MuPositive: "1.2D+1.6L",
      MuNegative: "1.2D+1.6L",
      Vu: "1.2D+1.6L",
      Nu: null,
    });
  });

  it("applies self-weight from the section's unit weight", () => {
    const reactionA = result.cases.D.reactions.find((r) => r.nodeId === "A")!;
    expect(reactionA.fz).toBeCloseTo((3 / 8) * 4.32 * L, 4); // 8.1 kN
  });

  it("takes Vu at the critical distance d from the support faces", () => {
    const env = memberDemandEnvelope(result, "AB", { shearCriticalDistance: 540 });
    expect(env.Vu).toBeCloseTo((5 * wU * L) / 8 - wU * 0.54, 3); // 128.7 − 22.239
    expect(env.VuRange).toEqual({ from: 540, to: 4460 });
  });

  it("can envelope load cases instead of combinations", () => {
    const env = memberDemandEnvelope(result, "AB", { cases: ["L"] });
    expect(env.MuNegative).toBeCloseTo((15 * L * L) / 8, 3);
    expect(env.governing.MuNegative).toBe("L");
  });

  it("feeds the design check", () => {
    const env = memberDemandEnvelope(result, "AB");
    const { phiMn } = rectBeamMomentCapacity(section);
    expect(phiMn).toBeGreaterThan(env.MuPositive);
  });

  it("throws for an unknown member or id", () => {
    expect(() => memberDemandEnvelope(result, "nope")).toThrow();
    expect(() => memberDemandEnvelope(result, "AB", { combinations: ["nope"] })).toThrow();
    expect(() => memberDemandEnvelope(result, "AB", { cases: ["nope"] })).toThrow();
  });
});
