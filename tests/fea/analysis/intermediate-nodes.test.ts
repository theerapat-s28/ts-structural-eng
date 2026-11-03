import type { SectionProperties } from "@app-core/types/section-properties.type";
import { FeaError } from "@app-core/errors/fea.error";
import { memberConnectivity } from "@app-fea/analysis/mesh/member-connectivity";
import { analyze } from "@app-fea/analysis/solver/analyze";
import type { FeaModel } from "@app-fea/analysis/types/model.type";
import type { FeaCaseResult } from "@app-fea/analysis/types/results.type";
import type { Member, MemberLoad } from "@app-fea/frame/types/model.type";
import type { FeaNode, Restraint } from "@app-fea/shared/types/model.type";

const E = 200000; // MPa
const I = 8e7; // mm⁴
const sec: SectionProperties = { E, G: 80000, A: 5000, I22: I, I33: I, J: 1e7 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const L = 6000; // mm

const disp = (r: FeaCaseResult, id: string) => r.nodalDisplacements.find((d) => d.nodeId === id)!;
const diagram = (r: FeaCaseResult, id: string) => r.memberDiagrams.find((d) => d.memberId === id)!;

/** Simply supported girder G from N1 to N3 along X, with node N2 at `n2`. */
const girder = (
  n2: [number, number, number],
  over: { members?: Member[]; nodes?: FeaNode[]; restraints?: Restraint[] } = {},
  g: Partial<Member> = {},
) => ({
  nodes: [
    { id: "N1", x: 0, y: 0, z: 0 },
    { id: "N2", x: n2[0], y: n2[1], z: n2[2] },
    { id: "N3", x: L, y: 0, z: 0 },
    ...(over.nodes ?? []),
  ],
  members: [
    { id: "G", startNodeId: "N1", endNodeId: "N3", section: sec, ...g },
    ...(over.members ?? []),
  ],
  restraints: [
    { nodeId: "N1", ux: true, uy: true, uz: true, rx: true },
    { nodeId: "N3", uy: true, uz: true },
    ...(over.restraints ?? []),
  ],
});

/** Girder with a column from N2 down to a fixed base N4, under a UDL on the girder. */
const girderOnColumn = (n2: [number, number, number], g: Partial<Member> = {}): FeaModel => ({
  ...girder(
    n2,
    {
      nodes: [{ id: "N4", x: n2[0], y: n2[1], z: -3000 }],
      members: [{ id: "C", startNodeId: "N4", endNodeId: "N2", section: sec }],
      restraints: [{ nodeId: "N4", ...fixed }],
    },
    g,
  ),
  loadCases: [{ id: "D" }],
  memberLoads: [{ loadCase: "D", type: "udl", memberId: "G", direction: "Z", w: -10 }],
});

describe("analyze — nodes lying on a member between its ends", () => {
  it("connects a node at mid-span: simply supported beam with a central point load", () => {
    const result = analyze({
      ...girder([L / 2, 0, 0]),
      loadCases: [{ id: "D" }],
      nodalLoads: [{ loadCase: "D", nodeId: "N2", fz: -10 }],
    });
    const r = result.cases.D;
    const P = 10e3; // N
    expect(disp(r, "N2").uz).toBeCloseTo(-(P * L ** 3) / (48 * E * I), 4); // −2.8125 mm
    expect(r.reactions.find((x) => x.nodeId === "N1")!.fz).toBeCloseTo(5, 6);
    expect(r.reactions.find((x) => x.nodeId === "N3")!.fz).toBeCloseTo(5, 6);

    // still one member in the results, with its full length and a moment PL/4 at the node
    expect(r.memberDiagrams).toHaveLength(1);
    expect(r.memberEndForces).toHaveLength(1);
    const g = diagram(r, "G");
    expect(g.length).toBe(L);
    const m3 = g.extremes.M3;
    const peak = Math.abs(m3.max.value) > Math.abs(m3.min.value) ? m3.max : m3.min;
    expect(Math.abs(peak.value)).toBeCloseTo((P * L) / 4 / 1e6, 6); // 15 kN·m
    expect(peak.x).toBe(L / 2);
    // the shear jump at the node shows on both sides
    const atNode = g.stations.filter((s) => s.x === L / 2).map((s) => Math.abs(s.V2));
    expect(atNode).toEqual([5, 5]);

    expect(result.calculationDetails.intermediateNodes).toEqual([
      { memberId: "G", nodeId: "N2", x: 3000 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("gives the same answer as splitting the member by hand", () => {
    const loads = (ids: string[]): MemberLoad[] =>
      ids.length === 1
        ? [
            { loadCase: "D", type: "udl", memberId: "G", direction: "Z", w: -8 },
            { loadCase: "D", type: "point", memberId: "G", direction: "Y", P: 4, a: 1500 },
            {
              loadCase: "D",
              type: "trapezoidal",
              memberId: "G",
              direction: "Z",
              w1: -2,
              w2: -6,
              start: 2000,
              end: 5000,
            },
          ]
        : [
            { loadCase: "D", type: "udl", memberId: "G1", direction: "Z", w: -8 },
            { loadCase: "D", type: "udl", memberId: "G2", direction: "Z", w: -8 },
            { loadCase: "D", type: "point", memberId: "G1", direction: "Y", P: 4, a: 1500 },
            {
              loadCase: "D",
              type: "trapezoidal",
              memberId: "G1",
              direction: "Z",
              w1: -2,
              w2: -2 - (4 * 500) / 3000,
              start: 2000,
              end: 2500,
            },
            {
              loadCase: "D",
              type: "trapezoidal",
              memberId: "G2",
              direction: "Z",
              w1: -2 - (4 * 500) / 3000,
              w2: -6,
              start: 0,
              end: 2500,
            },
          ];
    const n2: [number, number, number] = [2500, 0, 0];
    const auto = analyze({ ...girderOnColumn(n2), memberLoads: loads(["G"]) }).cases.D;
    const base = girderOnColumn(n2);
    const manual = analyze({
      ...base,
      members: [
        { id: "G1", startNodeId: "N1", endNodeId: "N2", section: sec },
        { id: "G2", startNodeId: "N2", endNodeId: "N3", section: sec },
        base.members![1],
      ],
      memberLoads: loads(["G1", "G2"]),
    }).cases.D;

    for (const id of ["N1", "N2", "N3", "N4"]) {
      const [a, b] = [disp(auto, id), disp(manual, id)];
      for (const k of ["ux", "uy", "uz", "rx", "ry", "rz"] as const) {
        expect(a[k]).toBeCloseTo(b[k], 6);
      }
    }
    const g = auto.memberEndForces.find((m) => m.memberId === "G")!;
    expect(g.start).toEqual(manual.memberEndForces.find((m) => m.memberId === "G1")!.start);
    expect(g.end).toEqual(manual.memberEndForces.find((m) => m.memberId === "G2")!.end);
    const [d1, d2] = [diagram(manual, "G1"), diagram(manual, "G2")];
    expect(diagram(auto, "G").extremes.M3.min.value).toBeCloseTo(
      Math.min(d1.extremes.M3.min.value, d2.extremes.M3.min.value),
      6,
    );
  });

  it("supports the girder on a column landing mid-span", () => {
    const result = analyze(girderOnColumn([L / 2, 0, 0]));
    const r = result.cases.D;
    // the column takes load; the girder's peak moment is far below the simple-span wL²/8
    expect(r.memberEndForces.find((m) => m.memberId === "C")!.end.f1).not.toBe(0);
    expect(Math.abs(diagram(r, "G").extremes.M3.max.value)).toBeLessThan(45 / 2);
    expect(result.calculationDetails.intermediateNodes).toEqual([
      { memberId: "G", nodeId: "N2", x: 3000 },
    ]);
  });

  it("leaves the node unconnected when the member sets connectIntermediateNodes: false", () => {
    const result = analyze(girderOnColumn([L / 2, 0, 0], { connectIntermediateNodes: false }));
    const r = result.cases.D;
    expect(diagram(r, "G").extremes.M3.max.value).toBeCloseTo(45, 6); // wL²/8, simple span
    expect(r.memberEndForces.find((m) => m.memberId === "C")!.end.f1).toBe(0);
    expect(result.calculationDetails.intermediateNodes).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("a node used by nothing else and loaded on an opted-out member is unstable", () => {
    expect(() =>
      analyze({
        ...girder([L / 2, 0, 0], {}, { connectIntermediateNodes: false }),
        loadCases: [{ id: "D" }],
        nodalLoads: [{ loadCase: "D", nodeId: "N2", fz: -10 }],
      }),
    ).toThrow(FeaError);
  });

  it("connects a node at every member passing through it, in member order", () => {
    // two crossing braces in plan, both through the centre node C
    const result = analyze({
      nodes: [
        { id: "A", x: 0, y: 0, z: 0 },
        { id: "B", x: 4000, y: 4000, z: 0 },
        { id: "P", x: 4000, y: 0, z: 0 },
        { id: "Q", x: 0, y: 4000, z: 0 },
        { id: "C", x: 2000, y: 2000, z: 0 },
      ],
      members: [
        { id: "X1", startNodeId: "A", endNodeId: "B", section: sec },
        { id: "X2", startNodeId: "P", endNodeId: "Q", section: sec },
      ],
      restraints: ["A", "B", "P", "Q"].map((nodeId) => ({ nodeId, ...fixed })),
      loadCases: [{ id: "D" }],
      nodalLoads: [{ loadCase: "D", nodeId: "C", fz: -10 }],
    });
    const half = Math.round(2000 * Math.SQRT2 * 1000) / 1000;
    expect(result.calculationDetails.intermediateNodes).toEqual([
      { memberId: "X1", nodeId: "C", x: half },
      { memberId: "X2", nodeId: "C", x: half },
    ]);
    // symmetric: each brace carries half the load
    const r = result.cases.D;
    const sum = ["A", "B", "P", "Q"].reduce(
      (s, id) => s + r.reactions.find((x) => x.nodeId === id)!.fz,
      0,
    );
    expect(sum).toBeCloseTo(10, 6);
    expect(r.reactions.find((x) => x.nodeId === "A")!.fz).toBeCloseTo(2.5, 6);
  });
});

describe("analyze — nodes close to a member but not on it", () => {
  it("warns about a node a few mm off the member and does not connect it", () => {
    const result = analyze(girderOnColumn([L / 2, 5, 0]));
    expect(result.warnings).toEqual([
      {
        reference: "Member connectivity",
        message:
          'Node "N2" is 5 mm from member "G" (3000 mm from its start) but not on it, so it is not connected to the member; move the node onto the member if they should be connected.',
      },
    ]);
    expect(result.calculationDetails.intermediateNodes).toEqual([]);
    expect(result.calculationDetails.nearMissNodes).toEqual([
      { memberId: "G", nodeId: "N2", x: 3000, distance: 5 },
    ]);
    expect(diagram(result.cases.D, "G").extremes.M3.max.value).toBeCloseTo(45, 6);
  });

  it("stays quiet beyond 1 % of the member length", () => {
    const result = analyze(girderOnColumn([L / 2, 61, 0])); // 1 % of 6000 = 60 mm
    expect(result.warnings).toEqual([]);
  });

  it("caps the near-miss distance at 100 mm on long members", () => {
    const long = (offset: number): FeaModel => {
      const m = girderOnColumn([L / 2, offset, 0]);
      return { ...m, nodes: m.nodes.map((n) => (n.id === "N3" ? { ...n, x: 20000 } : n)) };
    };
    expect(analyze(long(150)).warnings).toEqual([]); // under 1 % (200 mm), over the cap
    expect(analyze(long(90)).warnings).toHaveLength(1);
  });

  it("does not check members that opt out of connecting", () => {
    const result = analyze(girderOnColumn([L / 2, 5, 0], { connectIntermediateNodes: false }));
    expect(result.warnings).toEqual([]);
  });

  it("ignores nodes beyond the member's ends", () => {
    const result = analyze({
      ...girder([L + 3, 1, 0], {
        nodes: [{ id: "N4", x: L + 3, y: 1, z: -3000 }],
        members: [{ id: "C", startNodeId: "N4", endNodeId: "N2", section: sec }],
        restraints: [{ nodeId: "N4", ...fixed }],
      }),
      loadCases: [{ id: "D" }],
    });
    expect(result.warnings).toEqual([]);
  });
});

describe("memberConnectivity — the same check without analysing", () => {
  it("matches what analyze connects and reports", () => {
    for (const y of [0, 5, 200]) {
      const model = girderOnColumn([L / 2, y, 0]);
      const result = analyze(model);
      const c = memberConnectivity(model);
      expect(c.intermediateNodes).toEqual(result.calculationDetails.intermediateNodes);
      expect(c.nearMissNodes).toEqual(result.calculationDetails.nearMissNodes);
      expect(c.warnings).toEqual(result.warnings);
    }
  });

  it("reports a near miss where analyze throws because the node is left unstable", () => {
    const model: FeaModel = {
      ...girder([L / 2, 2.5, 0]),
      loadCases: [{ id: "D" }],
      nodalLoads: [{ loadCase: "D", nodeId: "N2", fz: -10 }],
    };
    expect(() => analyze(model)).toThrow(FeaError);
    expect(memberConnectivity(model).nearMissNodes).toEqual([
      { memberId: "G", nodeId: "N2", x: 3000, distance: 2.5 },
    ]);
  });

  it("checks a model that is still being edited, skipping what is invalid", () => {
    const model = {
      nodes: [
        { id: "N1", x: 0, y: 0, z: 0 },
        { id: "N2", x: 3000, y: 0, z: 0 },
        { id: "N3", x: L, y: 0, z: 0 },
        { id: "N4", x: Number.NaN, y: 0, z: 0 }, // half-typed coordinate
        { id: "N5", x: 1000, y: 3, z: 0 },
      ],
      members: [
        { id: "G", startNodeId: "N1", endNodeId: "N3", section: sec },
        { id: "U", startNodeId: "N1", endNodeId: "missing", section: sec },
        { id: "Z", startNodeId: "N1", endNodeId: "N1", section: sec },
        { id: "B", startNodeId: "N4", endNodeId: "N3", section: sec },
      ],
      restraints: [],
      loadCases: [],
    } as FeaModel;
    const c = memberConnectivity(model);
    expect(c.intermediateNodes).toEqual([{ memberId: "G", nodeId: "N2", x: 3000 }]);
    expect(c.nearMissNodes).toEqual([{ memberId: "G", nodeId: "N5", x: 1000, distance: 3 }]);
    expect(memberConnectivity({ nodes: [], restraints: [], loadCases: [] })).toEqual({
      intermediateNodes: [],
      nearMissNodes: [],
      warnings: [],
    });
  });
});
