import { analyzeFrame } from "@app-frame/solver/analyze-frame";
import type { FrameModel, Member } from "@app-frame/types/model.type";
import type { FrameResult } from "@app-frame/types/results.type";
import type { SectionProperties } from "@app-core/types/section-properties.type";

const E = 200000; // MPa
const G = 80000; // MPa
const section = (I22: number, I33: number, A = 5000, J = 1e7): SectionProperties => ({
  E,
  G,
  A,
  I22,
  I33,
  J,
});
const I = 8e7; // mm⁴
const iso = section(I, I);

const disp = (r: FrameResult, id: string | number) =>
  r.nodalDisplacements.find((d) => d.nodeId === id)!;
const react = (r: FrameResult, id: string | number) => r.reactions.find((d) => d.nodeId === id)!;
const endForces = (r: FrameResult, id: string | number) =>
  r.memberEndForces.find((m) => m.memberId === id)!;

const fixedSupport = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

/** Cantilever of `n` equal members along a direction, fixed at node 0. */
const cantilever = (
  direction: [number, number, number],
  length: number,
  sec: SectionProperties = iso,
  angle = 0,
): FrameModel => ({
  nodes: [
    { id: 0, x: 0, y: 0, z: 0 },
    { id: 1, x: direction[0] * length, y: direction[1] * length, z: direction[2] * length },
  ],
  members: [{ id: "m", startNodeId: 0, endNodeId: 1, section: sec, angle }],
  restraints: [{ nodeId: 0, ...fixedSupport }],
});

describe("analyzeFrame — cantilever (analytical)", () => {
  const L = 3000;
  const P = 10; // kN
  const delta = (P * 1e3 * L ** 3) / (3 * E * I);
  const theta = (P * 1e3 * L ** 2) / (2 * E * I);

  it("tip load in global −Z bends about local 3 using I33 (beam along X)", () => {
    const model = cantilever([1, 0, 0], L, section(I / 4, I));
    model.nodalLoads = [{ nodeId: 1, fz: -P }];
    const r = analyzeFrame(model);
    expect(disp(r, 1).uz).toBeCloseTo(-delta, 4);
    expect(disp(r, 1).ry).toBeCloseTo(theta, 6); // right-hand rotation about Y
    expect(react(r, 0).fz).toBeCloseTo(P, 4);
    expect(react(r, 0).my).toBeCloseTo(-P * (L / 1000), 4); // resists the +PL moment of the load about Y
  });

  it("tip load in global −Y bends about local 2 using I22 (beam along X)", () => {
    const model = cantilever([1, 0, 0], L, section(I / 4, I));
    model.nodalLoads = [{ nodeId: 1, fy: -P }];
    const r = analyzeFrame(model);
    expect(disp(r, 1).uy).toBeCloseTo(-4 * delta, 4);
    expect(disp(r, 1).rz).toBeCloseTo(-4 * theta, 6);
  });

  it("member angle of 90° swaps which inertia governs", () => {
    const model = cantilever([1, 0, 0], L, section(I / 4, I), Math.PI / 2);
    model.nodalLoads = [{ nodeId: 1, fz: -P }];
    expect(disp(analyzeFrame(model), 1).uz).toBeCloseTo(-4 * delta, 4);
  });

  it("vertical column with a horizontal tip load: global X uses I33, global Y uses I22", () => {
    const column = cantilever([0, 0, 1], L, section(I / 4, I));
    column.nodalLoads = [{ nodeId: 1, fx: P }];
    expect(disp(analyzeFrame(column), 1).ux).toBeCloseTo(delta, 4);
    column.nodalLoads = [{ nodeId: 1, fy: P }];
    expect(disp(analyzeFrame(column), 1).uy).toBeCloseTo(4 * delta, 4);
  });

  it("gives the same tip deflection for any orientation (isotropic section)", () => {
    const dir: [number, number, number] = [1 / 3, 2 / 3, 2 / 3];
    const model = cantilever(dir, L);
    // load perpendicular to the member: (2, −1, 0)/√5 · P
    const s = 1 / Math.sqrt(5);
    model.nodalLoads = [{ nodeId: 1, fx: 2 * s * P, fy: -s * P }];
    const d = disp(analyzeFrame(model), 1);
    expect(Math.hypot(d.ux, d.uy, d.uz)).toBeCloseTo(delta, 4);
    // no axial component
    expect(d.ux * dir[0] + d.uy * dir[1] + d.uz * dir[2]).toBeCloseTo(0, 5);
  });

  it("axial load gives PL/EA", () => {
    const model = cantilever([1, 0, 0], L);
    model.nodalLoads = [{ nodeId: 1, fx: 100 }];
    expect(disp(analyzeFrame(model), 1).ux).toBeCloseTo((100e3 * L) / (E * 5000), 6);
  });

  it("end torque gives TL/GJ", () => {
    const model = cantilever([1, 0, 0], L);
    model.nodalLoads = [{ nodeId: 1, mx: 5 }];
    expect(disp(analyzeFrame(model), 1).rx).toBeCloseTo((5e6 * L) / (G * 1e7), 7);
  });

  it("passes the global equilibrium check without warnings", () => {
    const model = cantilever([1, 0, 0], L);
    model.nodalLoads = [{ nodeId: 1, fz: -P, fy: 3, mx: 2 }];
    const r = analyzeFrame(model);
    expect(r.warnings).toHaveLength(0);
    expect(r.calculationDetails.equilibriumResidual.force).toBeLessThan(1e-6);
    expect(r.calculationDetails.equilibriumResidual.moment).toBeLessThan(1e-6);
    expect(r.units).toEqual({ force: "kN", moment: "kN·m", length: "mm", rotation: "rad" });
  });
});

describe("analyzeFrame — member loads and diagrams", () => {
  const L = 6000;
  const w = 20; // kN/m
  const half = L / 2;

  /** Beam along X from x=0 to x=L through a mid node, so nodal results are available. */
  const beam = (supports: FrameModel["restraints"], members: Member[] = []): FrameModel => ({
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: half, y: 0, z: 0 },
      { id: "C", x: L, y: 0, z: 0 },
    ],
    members: members.length
      ? members
      : [
          { id: 1, startNodeId: "A", endNodeId: "B", section: iso },
          { id: 2, startNodeId: "B", endNodeId: "C", section: iso },
        ],
    restraints: supports,
    memberLoads: [
      { type: "udl", memberId: 1, direction: "Z", w: -w },
      { type: "udl", memberId: 2, direction: "Z", w: -w },
    ],
  });
  const pin = (nodeId: string, axial = false) => ({
    nodeId,
    ux: axial,
    uy: true,
    uz: true,
    rx: axial,
  });

  it("simply supported UDL: reactions wL/2, Mmax wL²/8, deflection 5wL⁴/384EI", () => {
    const r = analyzeFrame(beam([pin("A", true), pin("C")]));
    expect(react(r, "A").fz).toBeCloseTo((w * L) / 2 / 1000, 4);
    expect(react(r, "C").fz).toBeCloseTo((w * L) / 2 / 1000, 4);
    expect(disp(r, "B").uz).toBeCloseTo((-5 * w * L ** 4) / (384 * E * I), 3);
    const Mmax = (w * (L / 1000) ** 2) / 8;
    const m1 = r.memberDiagrams.find((d) => d.memberId === 1)!;
    const m2 = r.memberDiagrams.find((d) => d.memberId === 2)!;
    expect(Math.max(m1.extremes.M3.max.value, m2.extremes.M3.max.value)).toBeCloseTo(Mmax, 3);
    expect(m1.extremes.M3.max.x).toBeCloseTo(half, 3);
  });

  it("fixed–fixed UDL: end moments wL²/12 and midspan wL²/24", () => {
    const r = analyzeFrame(
      beam([
        { nodeId: "A", ...fixedSupport },
        { nodeId: "C", ...fixedSupport },
      ]),
    );
    const M = (w * (L / 1000) ** 2) / 12;
    expect(endForces(r, 1).start.m3).toBeCloseTo(M, 3);
    expect(endForces(r, 2).end.m3).toBeCloseTo(-M, 3);
    expect(disp(r, "B").uz).toBeCloseTo((-w * L ** 4) / (384 * E * I), 3);
    const m1 = r.memberDiagrams.find((d) => d.memberId === 1)!;
    expect(m1.extremes.M3.min.value).toBeCloseTo(-M, 3);
  });

  it("two equal spans under UDL: middle support moment wL²/8 and reactions 3/8, 10/8, 3/8 wL", () => {
    const span = 4000;
    const model: FrameModel = {
      nodes: [
        { id: "A", x: 0, y: 0, z: 0 },
        { id: "B", x: span, y: 0, z: 0 },
        { id: "C", x: 2 * span, y: 0, z: 0 },
      ],
      members: [
        { id: 1, startNodeId: "A", endNodeId: "B", section: iso },
        { id: 2, startNodeId: "B", endNodeId: "C", section: iso },
      ],
      restraints: [pin("A", true), pin("B"), pin("C")],
      memberLoads: [
        { type: "udl", memberId: 1, direction: "Z", w: -w },
        { type: "udl", memberId: 2, direction: "Z", w: -w },
      ],
    };
    const r = analyzeFrame(model);
    const wL = (w * span) / 1000;
    expect(react(r, "A").fz).toBeCloseTo((3 / 8) * wL, 3);
    expect(react(r, "B").fz).toBeCloseTo((10 / 8) * wL, 3);
    expect(react(r, "C").fz).toBeCloseTo((3 / 8) * wL, 3);
    expect(endForces(r, 1).end.m3).toBeCloseTo(-(w * (span / 1000) ** 2) / 8, 3);
  });

  it("point load at midspan of a simply supported beam: PL/4 and PL³/48EI", () => {
    const P = 30;
    const model = beam([pin("A", true), pin("C")]);
    model.memberLoads = [{ type: "point", memberId: 1, direction: "Z", P: -P, a: half }];
    const r = analyzeFrame(model);
    expect(react(r, "A").fz).toBeCloseTo(P / 2, 4);
    expect(disp(r, "B").uz).toBeCloseTo((-P * 1e3 * L ** 3) / (48 * E * I), 3);
    const m1 = r.memberDiagrams.find((d) => d.memberId === 1)!;
    expect(m1.extremes.M3.max.value).toBeCloseTo((P * (L / 1000)) / 4, 3);
  });

  it("point load inside a member: shear jumps by P and both sides are reported", () => {
    const P = 40;
    const a = 1500;
    const model = beam([pin("A", true), pin("C")]);
    model.memberLoads = [{ type: "point", memberId: 1, direction: "Z", P: -P, a }];
    const r = analyzeFrame(model);
    expect(react(r, "A").fz).toBeCloseTo((P * (L - a)) / L, 4); // 30 kN
    const m1 = r.memberDiagrams.find((d) => d.memberId === 1)!;
    const atLoad = m1.stations.filter((s) => s.x === a);
    expect(atLoad).toHaveLength(2);
    // V2 is the force on the positive (+1) face along local 2: −RA before the load, −RA + P after
    expect(atLoad[0].V2).toBeCloseTo(-30, 3);
    expect(atLoad[1].V2).toBeCloseTo(10, 3);
    expect(m1.extremes.M3.max.value).toBeCloseTo(
      (P * (a / 1000) * ((L - a) / 1000)) / (L / 1000),
      3,
    ); // Pab/L
  });

  it("partial UDL gives the same reactions as the statically equivalent load", () => {
    const model = beam([pin("A", true), pin("C")]);
    // 20 kN/m over the left half of member 1 only: resultant 20·1.5 m... on a 3 m member (full)
    model.memberLoads = [{ type: "udl", memberId: 1, direction: "Z", w: -w, start: 0, end: half }];
    const r = analyzeFrame(model);
    // resultant w·3 m = 60 kN at x = 1.5 m of a 6 m span → RA = 45, RC = 15
    expect(react(r, "A").fz).toBeCloseTo(45, 3);
    expect(react(r, "C").fz).toBeCloseTo(15, 3);
  });

  it("resolves global-direction member loads on an inclined member", () => {
    // 3-4-5 inclined cantilever in the X–Z plane, gravity UDL per unit member length
    const len = 5000;
    const model: FrameModel = {
      nodes: [
        { id: 0, x: 0, y: 0, z: 0 },
        { id: 1, x: 4000, y: 0, z: 3000 },
      ],
      members: [{ id: 1, startNodeId: 0, endNodeId: 1, section: iso }],
      restraints: [{ nodeId: 0, ...fixedSupport }],
      memberLoads: [{ type: "udl", memberId: 1, direction: "Z", w: -10 }],
    };
    const r = analyzeFrame(model);
    expect(react(r, 0).fz).toBeCloseTo((10 * len) / 1000, 4);
    // moment about the support from the resultant at mid-length (x = 2 m)
    expect(Math.abs(react(r, 0).my)).toBeCloseTo(50 * 2, 3);
  });

  it("loads along local axes 2, 3 and 1 give consistent reactions", () => {
    const model = cantilever([1, 0, 0], 4000);
    model.memberLoads = [
      { type: "udl", memberId: "m", direction: "2", w: 5 },
      { type: "udl", memberId: "m", direction: "3", w: 2 },
      { type: "udl", memberId: "m", direction: "1", w: 1 },
    ];
    const r = analyzeFrame(model);
    // local 1 = X, local 2 = Z, local 3 = −Y
    expect(react(r, 0).fx).toBeCloseTo(-4, 4);
    expect(react(r, 0).fz).toBeCloseTo(-20, 4);
    expect(react(r, 0).fy).toBeCloseTo(8, 4);
  });
});

describe("analyzeFrame — portal frame (slope-deflection solution)", () => {
  // Fixed-base portal in the X–Z plane, columns 4 m, beam 6 m, lateral load 50 kN at B.
  // Slope-deflection (independent solution): Δ = 11.1111 mm, θB = θC = 1.38889e-3 rad,
  // M_AB = 55.5556 kN·m (base), M_BA = 44.4444 kN·m (beam end), base shear 25 kN each.
  const Ic = 8e7;
  const Ib = 1.6e8;
  const rigidAxial = 5e7; // mm², suppresses axial deformation, which slope-deflection ignores
  const model: FrameModel = {
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: 0, y: 0, z: 4000 },
      { id: "C", x: 6000, y: 0, z: 4000 },
      { id: "D", x: 6000, y: 0, z: 0 },
    ],
    members: [
      { id: "AB", startNodeId: "A", endNodeId: "B", section: section(Ic, Ic, rigidAxial) },
      { id: "BC", startNodeId: "B", endNodeId: "C", section: section(Ib, Ib, rigidAxial) },
      { id: "DC", startNodeId: "D", endNodeId: "C", section: section(Ic, Ic, rigidAxial) },
    ],
    restraints: [
      { nodeId: "A", ...fixedSupport },
      { nodeId: "D", ...fixedSupport },
    ],
    nodalLoads: [{ nodeId: "B", fx: 50 }],
  };
  const r = analyzeFrame(model);

  it("matches the sway, joint rotations, moments and reactions", () => {
    expect(disp(r, "B").ux).toBeCloseTo(11.1111, 3);
    expect(disp(r, "C").ux).toBeCloseTo(11.1111, 3);
    expect(Math.abs(disp(r, "B").ry)).toBeCloseTo(1.38889e-3, 7);
    expect(Math.abs(disp(r, "C").ry)).toBeCloseTo(1.38889e-3, 7);
    expect(react(r, "A").fx).toBeCloseTo(-25, 3);
    expect(react(r, "D").fx).toBeCloseTo(-25, 3);
    expect(Math.abs(react(r, "A").my)).toBeCloseTo(55.5556, 3);
    expect(Math.abs(endForces(r, "BC").start.m3)).toBeCloseTo(44.4444, 3);
  });

  it("is in global equilibrium", () => {
    expect(r.warnings).toHaveLength(0);
    expect(react(r, "A").fx + react(r, "D").fx + 50).toBeCloseTo(0, 6);
  });
});

describe("analyzeFrame — end releases and springs", () => {
  it("a hinge between two members makes the left cantilever carry wL² at the support", () => {
    // Fixed at A, hinge at B (released at the end of member 1), roller at C, UDL w on both members
    const L = 4000;
    const w = 12;
    const model: FrameModel = {
      nodes: [
        { id: "A", x: 0, y: 0, z: 0 },
        { id: "B", x: L, y: 0, z: 0 },
        { id: "C", x: 2 * L, y: 0, z: 0 },
      ],
      members: [
        {
          id: 1,
          startNodeId: "A",
          endNodeId: "B",
          section: iso,
          releases: { end: { r3: true, r2: true } },
        },
        { id: 2, startNodeId: "B", endNodeId: "C", section: iso },
      ],
      restraints: [
        { nodeId: "A", ...fixedSupport },
        { nodeId: "C", uy: true, uz: true },
      ],
      memberLoads: [
        { type: "udl", memberId: 1, direction: "Z", w: -w },
        { type: "udl", memberId: 2, direction: "Z", w: -w },
      ],
    };
    const r = analyzeFrame(model);
    const Lm = L / 1000;
    expect(endForces(r, 1).end.m3).toBeCloseTo(0, 6);
    expect(endForces(r, 1).end.m2).toBeCloseTo(0, 6);
    expect(endForces(r, 2).start.m3).toBeCloseTo(0, 4);
    expect(react(r, "C").fz).toBeCloseTo((w * Lm) / 2, 4);
    expect(Math.abs(endForces(r, 1).start.m3)).toBeCloseTo(w * Lm ** 2, 3);
    expect(react(r, "A").fz).toBeCloseTo(w * Lm * 1.5, 4);
  });

  it("a spring support deflects by F/k", () => {
    const L = 3000;
    const model = cantilever([1, 0, 0], L);
    model.restraints = [
      { nodeId: 0, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
      { nodeId: 1, uz: 2 }, // 2 kN/mm
    ];
    model.nodalLoads = [{ nodeId: 1, fz: -10 }];
    const r = analyzeFrame(model);
    const k = 2000; // N/mm
    const kBeam = (3 * E * I) / L ** 3;
    expect(disp(r, 1).uz).toBeCloseTo(-10e3 / (k + kBeam), 4);
    expect(react(r, 1).fz).toBeCloseTo(-disp(r, 1).uz * 2, 4);
  });
});
