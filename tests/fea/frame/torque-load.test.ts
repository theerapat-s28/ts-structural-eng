import type { SectionProperties } from "@app-core/types/section-properties.type";
import type { FrameCaseResult, MemberStation } from "@app-fea/frame/types/results.type";
import { analyzeSingleCase, type SingleCaseModel } from "./single-case";

const section: SectionProperties = { E: 200000, G: 80000, A: 5000, I22: 2e7, I33: 8e7, J: 1e7 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

const at = (stations: MemberStation[], x: number) => {
  const s = stations.find((st) => Math.abs(st.x - x) < 1e-6);
  if (!s) throw new Error(`no station at x = ${x}`);
  return s;
};
const reaction = (r: FrameCaseResult, nodeId: number) =>
  r.reactions.find((x) => x.nodeId === nodeId)!;

/** Single member from (0,0,0) to `end`, both ends fixed unless `restraints` is given. */
const member = (
  end: { x: number; y: number; z: number },
  memberLoads: SingleCaseModel["memberLoads"],
  rest: Partial<SingleCaseModel> = {},
): SingleCaseModel => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, ...end },
  ],
  members: [{ id: "m", startNodeId: 1, endNodeId: 2, section }],
  restraints: [
    { nodeId: 1, ...fixed },
    { nodeId: 2, ...fixed },
  ],
  memberLoads,
  ...rest,
});

const L = 6000; // mm
const t = 2; // kN·m/m

describe("torque member load", () => {
  it("fixed–fixed, full length: tL/2 at each end and a linear T diagram through 0 at midspan", () => {
    const r = analyzeSingleCase(
      member({ x: L, y: 0, z: 0 }, [{ type: "torque", memberId: "m", t }]),
    );
    expect(reaction(r, 1).mx).toBeCloseTo((-t * L * 1e-3) / 2, 6); // −6 kN·m
    expect(reaction(r, 2).mx).toBeCloseTo((-t * L * 1e-3) / 2, 6);
    const d = r.memberDiagrams[0];
    expect(at(d.stations, 0).T).toBeCloseTo(6, 6);
    expect(at(d.stations, 1500).T).toBeCloseTo(3, 6);
    expect(at(d.stations, 3000).T).toBeCloseTo(0, 6);
    expect(at(d.stations, L).T).toBeCloseTo(-6, 6);
    expect(d.extremes.T.max).toEqual({ value: 6, x: 0 });
    expect(d.extremes.T.min).toEqual({ value: -6, x: L });
  });

  it("fixed–fixed, partial: ends share the torque like an axial load, ∫t·(1 − x/L) and ∫t·x/L", () => {
    const r = analyzeSingleCase(
      member({ x: L, y: 0, z: 0 }, [{ type: "torque", memberId: "m", t, start: 1000, end: 4000 }]),
    );
    // ∫₁₀₀₀⁴⁰⁰⁰ (1 − x/6000) dx = 1750 mm, ∫ x/6000 dx = 1250 mm
    expect(reaction(r, 1).mx).toBeCloseTo(-3.5, 6);
    expect(reaction(r, 2).mx).toBeCloseTo(-2.5, 6);
    const d = r.memberDiagrams[0];
    expect(at(d.stations, 0).T).toBeCloseTo(3.5, 6);
    expect(at(d.stations, 1000).T).toBeCloseTo(3.5, 6); // constant outside the loaded length
    expect(at(d.stations, 4000).T).toBeCloseTo(-2.5, 6);
    expect(at(d.stations, L).T).toBeCloseTo(-2.5, 6);
  });

  it("acts about the member axis of an inclined cantilever", () => {
    const Lc = 4000;
    const c = Lc / Math.SQRT2;
    const r = analyzeSingleCase(
      member({ x: c, y: c, z: 0 }, [{ type: "torque", memberId: "m", t: 3 }], {
        restraints: [{ nodeId: 1, ...fixed }],
      }),
    );
    // reaction = −t·L along local 1 = (1, 1, 0)/√2
    const tL = 3 * Lc * 1e-3; // 12 kN·m
    expect(reaction(r, 1).mx).toBeCloseTo(-tL / Math.SQRT2, 4);
    expect(reaction(r, 1).my).toBeCloseTo(-tL / Math.SQRT2, 4);
    expect(reaction(r, 1).mz).toBeCloseTo(0, 6);
    const d = r.memberDiagrams[0];
    expect(at(d.stations, 0).T).toBeCloseTo(tL, 6);
    expect(at(d.stations, Lc).T).toBeCloseTo(0, 6);
  });

  it("goes entirely to the other end when one end releases torsion", () => {
    const r = analyzeSingleCase(
      member({ x: L, y: 0, z: 0 }, [{ type: "torque", memberId: "m", t }], {
        members: [
          { id: "m", startNodeId: 1, endNodeId: 2, section, releases: { start: { r1: true } } },
        ],
      }),
    );
    expect(reaction(r, 1).mx).toBeCloseTo(0, 6);
    expect(reaction(r, 2).mx).toBeCloseTo(-t * L * 1e-3, 6);
    expect(at(r.memberDiagrams[0].stations, 0).T).toBeCloseTo(0, 6);
    expect(at(r.memberDiagrams[0].stations, L).T).toBeCloseTo(-12, 6);
  });
});
