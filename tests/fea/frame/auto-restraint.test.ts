import { FrameAnalysisError } from "@app-core/errors/frame-analysis.error";
import { analyzeFrame } from "@app-fea/frame/solver/analyze-frame";
import type { FrameModel, Member, MemberEndRelease } from "@app-fea/frame/types/model.type";
import type { FrameResult } from "@app-fea/frame/types/results.type";
import { toLoadCaseModel, type SingleCaseModel } from "./single-case";

const section = { E: 200000, G: 80000, A: 2000, I22: 2e6, I33: 2e6, J: 1e6 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const pinned = { r2: true, r3: true } satisfies MemberEndRelease;
/** ETABS-style truss member: moments released at both ends, torsion at the start. */
const trussMember = (id: string, startNodeId: string, endNodeId: string): Member => ({
  id,
  startNodeId,
  endNodeId,
  section,
  releases: { start: { ...pinned, r1: true }, end: pinned },
});

/**
 * Two-panel truss in the XZ plane: A(0,0) B(4,0) C(8,0) D(4,3) m, pin at A, roller at C,
 * every node held out of plane (uy), 20 kN down at B and 30 kN down at D.
 */
const truss = (member = trussMember, extra: Partial<SingleCaseModel> = {}): SingleCaseModel => ({
  nodes: [
    { id: "A", x: 0, y: 0, z: 0 },
    { id: "B", x: 4000, y: 0, z: 0 },
    { id: "C", x: 8000, y: 0, z: 0 },
    { id: "D", x: 4000, y: 0, z: 3000 },
  ],
  members: [
    member("AB", "A", "B"),
    member("BC", "B", "C"),
    member("AD", "A", "D"),
    member("DC", "D", "C"),
    member("BD", "B", "D"),
  ],
  restraints: [
    { nodeId: "A", ux: true, uy: true, uz: true },
    { nodeId: "B", uy: true },
    { nodeId: "C", uy: true, uz: true },
    { nodeId: "D", uy: true },
  ],
  nodalLoads: [
    { nodeId: "B", fz: -20 },
    { nodeId: "D", fz: -30 },
  ],
  ...extra,
});

const run = (model: SingleCaseModel): FrameResult => analyzeFrame(toLoadCaseModel(model));
const axial = (r: FrameResult, id: string) => {
  const d = r.cases.LC.memberDiagrams.find((m) => m.memberId === id)!;
  return d.stations[0].N;
};

describe("analyzeFrame — automatic restraint of unresisted joint rotations", () => {
  it("pin-jointed truss solves without 304 and matches the method of joints", () => {
    const r = run(truss());
    // R_A = R_C = 25 kN; joint A: F_AD·3/5 = −25, F_AB = −F_AD·4/5; joint B: F_BD = 20
    expect(axial(r, "AD")).toBeCloseTo(-125 / 3, 4);
    expect(axial(r, "DC")).toBeCloseTo(-125 / 3, 4);
    expect(axial(r, "AB")).toBeCloseTo(100 / 3, 4);
    expect(axial(r, "BC")).toBeCloseTo(100 / 3, 4);
    expect(axial(r, "BD")).toBeCloseTo(20, 4);
    // members carry axial force only
    for (const d of r.cases.LC.memberDiagrams) {
      for (const c of ["V2", "V3", "T", "M2", "M3"] as const) {
        expect(Math.abs(d.extremes[c].max.value)).toBeLessThan(1e-6);
        expect(Math.abs(d.extremes[c].min.value)).toBeLessThan(1e-6);
      }
    }
    expect(r.cases.LC.equilibriumResidual.force).toBeLessThan(1e-6);
  });

  it("reports every held rotation: all three at each joint when torsion is released too", () => {
    const held = run(truss()).calculationDetails.autoRestrainedDofs;
    expect(held).toHaveLength(12);
    for (const node of ["A", "B", "C", "D"]) {
      expect(held.filter((h) => h.nodeId === node).map((h) => h.dof)).toEqual(["rx", "ry", "rz"]);
    }
    expect(held[0]).toEqual({ nodeId: "A", axis: [1, 0, 0], dof: "rx" });
  });

  describe("with member torsion connected at both ends", () => {
    const withTorsion = (id: string, a: string, b: string): Member => ({
      id,
      startNodeId: a,
      endNodeId: b,
      section,
      releases: { start: pinned, end: pinned },
    });

    it("holds only the out-of-plane rotation once supports ground the torsion", () => {
      const model = truss(withTorsion);
      model.restraints[0] = { ...model.restraints[0], rx: true, rz: true }; // A
      model.restraints[2] = { ...model.restraints[2], rx: true, rz: true }; // C
      const r = run(model);
      expect(r.calculationDetails.autoRestrainedDofs.map((h) => [h.nodeId, h.dof])).toEqual([
        ["A", "ry"],
        ["B", "ry"],
        ["C", "ry"],
        ["D", "ry"],
      ]);
      expect(axial(r, "AD")).toBeCloseTo(-125 / 3, 4);
    });

    it("throws 304 when nothing grounds it: joints and members can spin about in-plane axes", () => {
      // a real rigid-body mechanism (each member turning about its own axis), not a joint rotation
      // that no member resists — release torsion at one end of each truss member instead
      expect(() => run(truss(withTorsion))).toThrow(FrameAnalysisError);
    });
  });

  it("gives the same result as restraining the joint rotations by hand", () => {
    const auto = run(truss()).cases.LC;
    const manual = run({
      ...truss(),
      restraints: truss().restraints.map((rs) => ({ ...rs, rx: true, ry: true, rz: true })),
    });
    expect(manual.calculationDetails.autoRestrainedDofs).toEqual([]);
    expect(auto.memberEndForces).toEqual(manual.cases.LC.memberEndForces);
    auto.nodalDisplacements.forEach((d, i) => {
      for (const key of ["ux", "uy", "uz"] as const) {
        expect(d[key]).toBeCloseTo(manual.cases.LC.nodalDisplacements[i][key], 5);
      }
    });
  });

  it("still throws 304 when a load has a moment about a held axis, naming node and case", () => {
    try {
      run(truss(trussMember, { nodalLoads: [{ nodeId: "D", my: 5 }] }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FrameAnalysisError);
      expect((e as FrameAnalysisError).code).toBe(304);
      expect((e as FrameAnalysisError).details).toEqual({
        nodeId: "D",
        dof: "ry",
        loadCaseId: "LC",
      });
    }
  });

  it("finds an inclined null axis: torsion resists the member axis, not the two normal to it", () => {
    // two collinear members along (1, 0, 1)/√2 with moment releases; middle node held in translation
    const c = 3000;
    const r = run({
      nodes: [
        { id: "A", x: 0, y: 0, z: 0 },
        { id: "M", x: c, y: 0, z: c },
        { id: "B", x: 2 * c, y: 0, z: 2 * c },
      ],
      members: [
        { id: "AM", startNodeId: "A", endNodeId: "M", section, releases: { end: pinned } },
        { id: "MB", startNodeId: "M", endNodeId: "B", section, releases: { start: pinned } },
      ],
      restraints: [
        { nodeId: "A", ...fixed },
        { nodeId: "M", ux: true, uy: true, uz: true },
        { nodeId: "B", ...fixed },
      ],
      // a torque about the member axis is carried by torsion, half into each member
      nodalLoads: [{ nodeId: "M", mx: 10 / Math.SQRT2, mz: 10 / Math.SQRT2 }],
    });
    const h = Math.SQRT1_2;
    expect(r.calculationDetails.autoRestrainedDofs).toHaveLength(2);
    const [inclined, normal] = r.calculationDetails.autoRestrainedDofs;
    expect(inclined.nodeId).toBe("M");
    expect(inclined.dof).toBeUndefined();
    inclined.axis.forEach((v, i) => expect(v).toBeCloseTo([h, 0, -h][i], 9));
    expect(normal).toEqual({ nodeId: "M", axis: [0, 1, 0], dof: "ry" });
    const torque = (id: string) =>
      Math.abs(r.cases.LC.memberDiagrams.find((d) => d.memberId === id)!.stations[0].T);
    expect(torque("AM")).toBeCloseTo(5, 4);
    expect(torque("MB")).toBeCloseTo(5, 4);
  });

  it("adds nothing where a continuous column or a partial-fixity spring resists rotation", () => {
    // portal: continuous columns, beam pinned into them at both ends
    const portal: SingleCaseModel = {
      nodes: [
        { id: 1, x: 0, y: 0, z: 0 },
        { id: 2, x: 0, y: 0, z: 3000 },
        { id: 3, x: 6000, y: 0, z: 3000 },
        { id: 4, x: 6000, y: 0, z: 0 },
      ],
      members: [
        { id: "c1", startNodeId: 1, endNodeId: 2, section },
        {
          id: "b",
          startNodeId: 2,
          endNodeId: 3,
          section,
          releases: { start: pinned, end: pinned },
        },
        { id: "c2", startNodeId: 4, endNodeId: 3, section },
      ],
      restraints: [
        { nodeId: 1, ...fixed },
        { nodeId: 4, ...fixed },
      ],
      nodalLoads: [{ nodeId: 2, fx: 10 }],
    };
    expect(run(portal).calculationDetails.autoRestrainedDofs).toEqual([]);
    const semiRigid = (id: string, a: string, b: string): Member => ({
      ...trussMember(id, a, b),
      releases: { start: { r2: 100, r3: 100, r1: 100 }, end: { r2: 100, r3: 100 } },
    });
    expect(run(truss(semiRigid)).calculationDetails.autoRestrainedDofs).toEqual([]);
  });

  it("leaves a joint without members to the stiffness check (304)", () => {
    const model: FrameModel = toLoadCaseModel({
      ...truss(),
      nodes: [...truss().nodes, { id: "lonely", x: 0, y: 5000, z: 0 }],
    });
    expect(() => analyzeFrame(model)).toThrow(FrameAnalysisError);
  });
});
