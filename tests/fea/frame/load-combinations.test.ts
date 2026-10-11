import { FrameAnalysisError } from "@app-core/errors/frame-analysis.error";
import type { SectionProperties } from "@app-core/types/section-properties.type";
import { analyzeFrame } from "@app-fea/frame/solver/analyze-frame";
import type { FrameModel } from "@app-fea/frame/types/model.type";
import type { FrameCaseResult } from "@app-fea/frame/types/results.type";
import {
  flattenCases,
  type CaseWithLoads,
  type UntaggedMemberLoad,
  type UntaggedNodalLoad,
} from "./single-case";

const E = 200000; // MPa
const I = 8e7; // mm⁴
const A = 5000; // mm²
const section: SectionProperties = { E, G: 80000, A, I22: I, I33: I, J: 1e7, unitWeight: 78.5 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

const scaleNodal = (l: UntaggedNodalLoad, f: number): UntaggedNodalLoad => ({
  nodeId: l.nodeId,
  fx: (l.fx ?? 0) * f,
  fy: (l.fy ?? 0) * f,
  fz: (l.fz ?? 0) * f,
  mx: (l.mx ?? 0) * f,
  my: (l.my ?? 0) * f,
  mz: (l.mz ?? 0) * f,
});
const scaleMember = (l: UntaggedMemberLoad, f: number): UntaggedMemberLoad =>
  l.type === "udl" ? { ...l, w: l.w * f } : { ...l, P: l.P * f };

/** One load case holding the factored sum of the given cases (the superposition oracle). */
const prescaled = (cases: CaseWithLoads[], factors: Record<string, number>): CaseWithLoads => {
  const terms = cases.filter((c) => factors[c.id] !== undefined);
  return {
    id: "ORACLE",
    selfWeight: terms.reduce((s, c) => s + (c.selfWeight ?? 0) * factors[c.id], 0),
    nodalLoads: terms.flatMap((c) => (c.nodalLoads ?? []).map((l) => scaleNodal(l, factors[c.id]))),
    memberLoads: terms.flatMap((c) =>
      (c.memberLoads ?? []).map((l) => scaleMember(l, factors[c.id])),
    ),
  };
};

const expectSameResult = (a: FrameCaseResult, b: FrameCaseResult) => {
  a.nodalDisplacements.forEach((d, i) => {
    const e = b.nodalDisplacements[i];
    (["ux", "uy", "uz"] as const).forEach((k) => expect(d[k]).toBeCloseTo(e[k], 4));
    (["rx", "ry", "rz"] as const).forEach((k) => expect(d[k]).toBeCloseTo(e[k], 7));
  });
  a.reactions.forEach((r, i) =>
    (["fx", "fy", "fz", "mx", "my", "mz"] as const).forEach((k) =>
      expect(r[k]).toBeCloseTo(b.reactions[i][k], 3),
    ),
  );
  a.memberEndForces.forEach((m, i) =>
    (["start", "end"] as const).forEach((end) =>
      (["f1", "f2", "f3", "m1", "m2", "m3"] as const).forEach((k) =>
        expect(m[end][k]).toBeCloseTo(b.memberEndForces[i][end][k], 3),
      ),
    ),
  );
  a.memberDiagrams.forEach((d, i) =>
    (["N", "V2", "V3", "T", "M2", "M3", "u1", "u2", "u3"] as const).forEach((c) => {
      expect(d.extremes[c].max.value).toBeCloseTo(b.memberDiagrams[i].extremes[c].max.value, 3);
      expect(d.extremes[c].min.value).toBeCloseTo(b.memberDiagrams[i].extremes[c].min.value, 3);
    }),
  );
};

// 3D L-shaped frame: fixed column, beam along X, cantilever along Y with a hinge
const frame = (
  loadCases: CaseWithLoads[],
  combinations: FrameModel["combinations"] = [],
): FrameModel => ({
  nodes: [
    { id: "A", x: 0, y: 0, z: 0 },
    { id: "B", x: 0, y: 0, z: 3500 },
    { id: "C", x: 6000, y: 0, z: 3500 },
    { id: "D", x: 6000, y: 4000, z: 3500 },
  ],
  members: [
    { id: "AB", startNodeId: "A", endNodeId: "B", section },
    { id: "BC", startNodeId: "B", endNodeId: "C", section },
    {
      id: "CD",
      startNodeId: "C",
      endNodeId: "D",
      section,
      releases: { start: { r3: true } }, // hinge in the vertical plane at C
    },
  ],
  restraints: [
    { nodeId: "A", ...fixed },
    { nodeId: "D", uz: true },
  ],
  ...flattenCases(loadCases),
  combinations,
});

const D: CaseWithLoads = {
  id: "D",
  type: "dead",
  selfWeight: 1,
  memberLoads: [
    { type: "udl", memberId: "BC", direction: "Z", w: -12 },
    { type: "udl", memberId: "CD", direction: "Z", w: -8, start: 500, end: 3000 },
  ],
};
const L: CaseWithLoads = {
  id: "L",
  type: "live",
  memberLoads: [{ type: "point", memberId: "BC", direction: "Z", P: -40, a: 2200 }],
  nodalLoads: [{ nodeId: "C", fy: 6 }],
};
const W: CaseWithLoads = {
  id: "W",
  type: "wind",
  nodalLoads: [{ nodeId: "B", fx: 25, mz: 3 }],
};

describe("load combinations — superposition", () => {
  const result = analyzeFrame(
    frame(
      [D, L, W],
      [
        {
          id: "1.2D+1.6L",
          terms: [
            { case: "D", factor: 1.2 },
            { case: "L", factor: 1.6 },
          ],
        },
        {
          id: "0.9D+1.0W",
          terms: [
            { case: "D", factor: 0.9 },
            { case: "W", factor: 1 },
          ],
        },
        {
          id: "1.2D+1.0W+1.0L",
          terms: [
            { case: "D", factor: 1.2 },
            { case: "W", factor: 1 },
            { case: "L", factor: 1 },
          ],
        },
        {
          id: "0.9D-1.0W",
          terms: [
            { case: "D", factor: 0.9 },
            { case: "W", factor: -1 },
          ],
        },
      ],
    ),
  );

  it.each([
    ["1.2D+1.6L", { D: 1.2, L: 1.6 }],
    ["0.9D+1.0W", { D: 0.9, W: 1 }],
    ["1.2D+1.0W+1.0L", { D: 1.2, W: 1, L: 1 }],
    ["0.9D-1.0W", { D: 0.9, W: -1 }],
  ])("%s equals one analysis of the pre-scaled, summed loads", (id, factors) => {
    const oracle = analyzeFrame(frame([prescaled([D, L, W], factors)])).cases.ORACLE;
    expectSameResult(result.combinations[id], oracle);
  });

  it("reports each case independently of the case order", () => {
    const reordered = analyzeFrame(frame([W, L, D]));
    (["D", "L", "W"] as const).forEach((id) =>
      expectSameResult(reordered.cases[id], result.cases[id]),
    );
  });

  it("groups top-level loads by their load case regardless of their order", () => {
    const model = frame([D, L, W]);
    const shuffled: FrameModel = {
      ...model,
      nodalLoads: [...(model.nodalLoads ?? [])].reverse(),
      memberLoads: [...(model.memberLoads ?? [])].reverse(),
    };
    const r = analyzeFrame(shuffled);
    (["D", "L", "W"] as const).forEach((id) => expectSameResult(r.cases[id], result.cases[id]));
  });

  it("gives a load case with no loads zero results", () => {
    const r = analyzeFrame(frame([D, { id: "EMPTY" }])).cases.EMPTY;
    r.reactions.forEach((x) => expect(x.fz).toBe(0));
    r.nodalDisplacements.forEach((x) => expect(x.uz).toBe(0));
  });

  it("keeps case and combination metadata, counts and units", () => {
    expect(result.cases.D).toMatchObject({ id: "D", kind: "case", type: "dead" });
    expect(result.combinations["1.2D+1.6L"]).toMatchObject({
      id: "1.2D+1.6L",
      kind: "combination",
    });
    expect(result.calculationDetails).toMatchObject({ loadCaseCount: 3, combinationCount: 4 });
    expect(result.units).toEqual({ force: "kN", moment: "kN·m", length: "mm", rotation: "rad" });
    expect(result.warnings).toEqual([]);
    Object.values({ ...result.cases, ...result.combinations }).forEach((r) => {
      expect(r.equilibriumResidual.force).toBeLessThan(1e-6);
      expect(r.equilibriumResidual.moment).toBeLessThan(1e-6);
    });
  });
});

describe("load combinations — nesting", () => {
  it("expands combinations of combinations into net case factors", () => {
    const nested = analyzeFrame(
      frame(
        [D, L],
        [
          { id: "DEAD", terms: [{ case: "D", factor: 1 }] },
          {
            id: "SERVICE",
            terms: [
              { combination: "DEAD", factor: 1 },
              { case: "L", factor: 1 },
            ],
          },
          // 1.5·SERVICE − 0.5·DEAD = 1.0D + 1.5L
          {
            id: "MIX",
            terms: [
              { combination: "SERVICE", factor: 1.5 },
              { combination: "DEAD", factor: -0.5 },
            ],
          },
          // listed before the combination it references
          { id: "EARLY", terms: [{ combination: "LATE", factor: 2 }] },
          { id: "LATE", terms: [{ case: "L", factor: 1 }] },
        ],
      ),
    );
    const oracle = analyzeFrame(frame([prescaled([D, L], { D: 1, L: 1.5 })])).cases.ORACLE;
    expectSameResult(nested.combinations.MIX, oracle);
    const twoL = analyzeFrame(frame([prescaled([L], { L: 2 })])).cases.ORACLE;
    expectSameResult(nested.combinations.EARLY, twoL);
  });
});

describe("load combinations — exact combined diagrams", () => {
  // Simply supported 6 m beam. Case D: UDL 10 kN/m. Case P: 30 kN at 1.5 m.
  // D+P: RA = 30 + 22.5 = 52.5 kN; zero shear at x = 2.25 m;
  // M = 52.5·2.25 − 10·2.25²/2 − 30·0.75 = 70.3125 kN·m (case extremes 45 + 33.75 would give 78.75).
  const beam: FrameModel = {
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 },
      { id: 2, x: 6000, y: 0, z: 0 },
    ],
    members: [{ id: "m", startNodeId: 1, endNodeId: 2, section }],
    restraints: [
      { nodeId: 1, ux: true, uy: true, uz: true, rx: true },
      { nodeId: 2, uy: true, uz: true },
    ],
    loadCases: [{ id: "D" }, { id: "P" }],
    memberLoads: [
      { loadCase: "D", type: "udl", memberId: "m", direction: "Z", w: -10 },
      { loadCase: "P", type: "point", memberId: "m", direction: "Z", P: -30, a: 1500 },
    ],
    combinations: [
      {
        id: "D+P",
        terms: [
          { case: "D", factor: 1 },
          { case: "P", factor: 1 },
        ],
      },
    ],
  };
  const result = analyzeFrame(beam);

  it("finds the combined zero-shear moment peak, not the sum of case extremes", () => {
    expect(result.cases.D.memberDiagrams[0].extremes.M3.max.value).toBeCloseTo(45, 3);
    expect(result.cases.P.memberDiagrams[0].extremes.M3.max.value).toBeCloseTo(33.75, 3);
    const M3 = result.combinations["D+P"].memberDiagrams[0].extremes.M3.max;
    expect(M3.value).toBeCloseTo(70.3125, 3);
    expect(M3.x).toBeCloseTo(2250, 2);
  });

  it("keeps the shear jump of the point load in the combination", () => {
    const atLoad = result.combinations["D+P"].memberDiagrams[0].stations.filter(
      (s) => s.x === 1500,
    );
    expect(atLoad).toHaveLength(2);
    expect(atLoad[0].V2).toBeCloseTo(-37.5, 3);
    expect(atLoad[1].V2).toBeCloseTo(-7.5, 3);
  });
});

describe("load combinations — envelope", () => {
  const result = analyzeFrame(
    frame(
      [D, L, W],
      [
        { id: "1.4D", terms: [{ case: "D", factor: 1.4 }] },
        {
          id: "1.2D+1.6L",
          terms: [
            { case: "D", factor: 1.2 },
            { case: "L", factor: 1.6 },
          ],
        },
        {
          id: "0.9D+1.0W",
          terms: [
            { case: "D", factor: 0.9 },
            { case: "W", factor: 1 },
          ],
        },
        {
          id: "0.9D-1.0W",
          terms: [
            { case: "D", factor: 0.9 },
            { case: "W", factor: -1 },
          ],
        },
      ],
    ),
  );
  const combos = Object.values(result.combinations);
  const envelope = result.envelope!;

  it("lists the enveloped combinations", () => {
    expect(envelope.combinationIds).toEqual(["1.4D", "1.2D+1.6L", "0.9D+1.0W", "0.9D-1.0W"]);
  });

  it("takes max/min of each reaction with the governing combination", () => {
    const iA = envelope.reactions.findIndex((r) => r.nodeId === "A");
    for (const key of ["fx", "fz", "my"] as const) {
      const values = combos.map((c) => ({ id: c.id, value: c.reactions[iA][key] }));
      const max = values.reduce((a, b) => (b.value > a.value ? b : a));
      const min = values.reduce((a, b) => (b.value < a.value ? b : a));
      expect(envelope.reactions[iA][key].max).toEqual({ value: max.value, combinationId: max.id });
      expect(envelope.reactions[iA][key].min).toEqual({ value: min.value, combinationId: min.id });
    }
    // wind in ±X governs the base shear both ways
    expect(envelope.reactions[iA].fx.max.combinationId).toBe("0.9D-1.0W");
    expect(envelope.reactions[iA].fx.min.combinationId).toBe("0.9D+1.0W");
  });

  it("takes max/min of each member diagram component with position and combination", () => {
    const m = envelope.members.find((e) => e.memberId === "BC")!;
    const values = combos.map((c) => ({
      id: c.id,
      e: c.memberDiagrams.find((d) => d.memberId === "BC")!.extremes.M3,
    }));
    const max = values.reduce((a, b) => (b.e.max.value > a.e.max.value ? b : a));
    const min = values.reduce((a, b) => (b.e.min.value < a.e.min.value ? b : a));
    expect(m.extremes.M3.max).toEqual({ ...max.e.max, combinationId: max.id });
    expect(m.extremes.M3.min).toEqual({ ...min.e.min, combinationId: min.id });
    // BC cantilevers from the column (the hinge at C gives no vertical support): the largest
    // hogging moment at B comes from the gravity combination with live load
    expect(m.extremes.M3.min.combinationId).toBe("1.2D+1.6L");
    expect(m.extremes.M3.min.x).toBe(0);
  });

  it("takes max/min of displacements", () => {
    const iC = envelope.nodalDisplacements.findIndex((d) => d.nodeId === "C");
    expect(envelope.nodalDisplacements[iC].uz.min.combinationId).toBe("1.2D+1.6L");
  });

  it("is absent when the model has no combinations", () => {
    expect(analyzeFrame(frame([D])).envelope).toBeUndefined();
  });
});

describe("self-weight", () => {
  const span = 6000;
  const w = (78.5 * A * 1e-6 * span) / 1000; // kN, γ·A·L
  const simple = (selfWeight: number, sec: SectionProperties = section): FrameModel => ({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 },
      { id: 2, x: span, y: 0, z: 0 },
    ],
    members: [{ id: "m", startNodeId: 1, endNodeId: 2, section: sec }],
    restraints: [
      { nodeId: 1, ux: true, uy: true, uz: true, rx: true },
      { nodeId: 2, uy: true, uz: true },
    ],
    loadCases: [{ id: "SW", selfWeight }],
  });

  it("applies γ·A per unit length along global −Z", () => {
    const r = analyzeFrame(simple(1)).cases.SW;
    expect(r.reactions[0].fz).toBeCloseTo(w / 2, 3); // reactions are presented to 4 decimals
    expect(r.reactions[1].fz).toBeCloseTo(w / 2, 3);
    expect(r.memberDiagrams[0].extremes.M3.max.value).toBeCloseTo((w * (span / 1000)) / 8, 3);
  });

  it("scales with the multiplier and is zero for a weightless member", () => {
    expect(analyzeFrame(simple(2)).cases.SW.reactions[0].fz).toBeCloseTo(w, 3);
    expect(analyzeFrame(simple(1, { ...section, unitWeight: 0 })).cases.SW.reactions[0].fz).toBe(0);
  });

  it("gives the cantilever tip deflection wL⁴/8EI along an inclined member", () => {
    const len = 3000;
    const r = analyzeFrame({
      nodes: [
        { id: 1, x: 0, y: 0, z: 0 },
        { id: 2, x: 0, y: len, z: 0 },
      ],
      members: [{ id: "m", startNodeId: 1, endNodeId: 2, section }],
      restraints: [{ nodeId: 1, ...fixed }],
      loadCases: [{ id: "SW", selfWeight: 1 }],
    }).cases.SW;
    const wNmm = 78.5 * A * 1e-6; // kN/m = N/mm
    expect(r.nodalDisplacements[1].uz).toBeCloseTo((-wNmm * len ** 4) / (8 * E * I), 5);
  });

  it("produces reactions on a 3D frame with no other loads assigned at all", () => {
    // Columns, beams and an inclined brace; the model has no nodalLoads / memberLoads keys
    const column: SectionProperties = { ...section, A: 160000, unitWeight: 24 };
    const girder: SectionProperties = { ...section, A: 180000, unitWeight: 24 };
    const nodes = [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: 6000, y: 0, z: 0 },
      { id: "C", x: 0, y: 0, z: 3500 },
      { id: "D", x: 6000, y: 0, z: 3500 },
      { id: "E", x: 6000, y: 4000, z: 3500 },
      { id: "F", x: 6000, y: 4000, z: 0 },
    ];
    const members = [
      { id: "AC", startNodeId: "A", endNodeId: "C", section: column },
      { id: "BD", startNodeId: "B", endNodeId: "D", section: column },
      { id: "FE", startNodeId: "F", endNodeId: "E", section: column },
      { id: "CD", startNodeId: "C", endNodeId: "D", section: girder },
      { id: "DE", startNodeId: "D", endNodeId: "E", section: girder },
      { id: "AD", startNodeId: "A", endNodeId: "D", section: column }, // inclined brace
    ];
    const model: FrameModel = {
      nodes,
      members,
      restraints: ["A", "B", "F"].map((nodeId) => ({ nodeId, ...fixed })),
      loadCases: [{ id: "D", type: "dead", selfWeight: 1 }],
    };
    const r = analyzeFrame(model).cases.D;

    // Σ γ·A·L over every member, in kN
    const node = (id: string) => nodes.find((n) => n.id === id)!;
    const weight = members.reduce((sum, m) => {
      const a = node(m.startNodeId);
      const b = node(m.endNodeId);
      const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 1000; // m
      return sum + (m.section.unitWeight as number) * m.section.A * 1e-6 * L;
    }, 0);
    const sum = (key: "fx" | "fy" | "fz") => r.reactions.reduce((s, x) => s + x[key], 0);

    expect(weight).toBeGreaterThan(100);
    expect(sum("fz")).toBeCloseTo(weight, 3);
    expect(sum("fx")).toBeCloseTo(0, 4);
    expect(sum("fy")).toBeCloseTo(0, 4);
    // every support picks up part of the weight
    ["A", "B", "F"].forEach((id) =>
      expect(r.reactions.find((x) => x.nodeId === id)!.fz).toBeGreaterThan(0),
    );
    // a column's own weight is axial compression
    const AC = r.memberDiagrams.find((d) => d.memberId === "AC")!;
    expect(AC.extremes.N.min.value).toBeLessThan(0);
    expect(r.equilibriumResidual.force).toBeLessThan(1e-6);
  });

  it("is ignored when the multiplier is 0 even without a unit weight", () => {
    const { unitWeight: _omit, ...noWeight } = section;
    expect(analyzeFrame(simple(0, noWeight)).cases.SW.reactions[0].fz).toBe(0);
  });
});

describe("load case and combination errors", () => {
  const codeOf = (model: FrameModel): number | undefined => {
    try {
      analyzeFrame(model);
    } catch (e) {
      expect(e).toBeInstanceOf(FrameAnalysisError);
      return (e as FrameAnalysisError).code;
    }
    return undefined;
  };

  it("302: a load case refers to an unknown node or member", () => {
    expect(codeOf(frame([{ id: "X", nodalLoads: [{ nodeId: "Z", fz: 1 }] }]))).toBe(302);
    expect(
      codeOf(
        frame([{ id: "X", memberLoads: [{ type: "udl", memberId: "Z", direction: "Z", w: 1 }] }]),
      ),
    ).toBe(302);
  });

  it("303: duplicate ids among load cases and combinations", () => {
    expect(codeOf(frame([D, { ...L, id: "D" }]))).toBe(303);
    expect(codeOf(frame([D], [{ id: "D", terms: [{ case: "D", factor: 1 }] }]))).toBe(303);
    expect(
      codeOf(
        frame(
          [D],
          [
            { id: "C", terms: [{ case: "D", factor: 1 }] },
            { id: "C", terms: [{ case: "D", factor: 2 }] },
          ],
        ),
      ),
    ).toBe(303);
  });

  it("309: a term refers to an unknown case or combination, or names neither", () => {
    expect(codeOf(frame([D], [{ id: "C", terms: [{ case: "L", factor: 1 }] }]))).toBe(309);
    expect(codeOf(frame([D], [{ id: "C", terms: [{ combination: "X", factor: 1 }] }]))).toBe(309);
    expect(
      codeOf(
        frame(
          [D],
          [{ id: "C", terms: [{ factor: 1 } as unknown as { case: string; factor: number }] }],
        ),
      ),
    ).toBe(309);
  });

  it("309: a load tagged with a load case that is not in the model", () => {
    const nodal = frame([D]);
    nodal.nodalLoads = [{ loadCase: "X", nodeId: "B", fx: 1 }];
    expect(codeOf(nodal)).toBe(309);
    const member = frame([D]);
    member.memberLoads = [{ loadCase: "X", type: "udl", memberId: "BC", direction: "Z", w: 1 }];
    expect(codeOf(member)).toBe(309);
  });

  it("310: combinations that reference each other in a loop", () => {
    expect(
      codeOf(
        frame(
          [D],
          [
            { id: "C1", terms: [{ combination: "C2", factor: 1 }] },
            { id: "C2", terms: [{ combination: "C1", factor: 1 }] },
          ],
        ),
      ),
    ).toBe(310);
    expect(codeOf(frame([D], [{ id: "C", terms: [{ combination: "C", factor: 1 }] }]))).toBe(310);
  });

  it("311: non-finite factors, empty combinations, non-finite self-weight", () => {
    expect(codeOf(frame([D], [{ id: "C", terms: [{ case: "D", factor: Number.NaN }] }]))).toBe(311);
    expect(codeOf(frame([D], [{ id: "C", terms: [] }]))).toBe(311);
    expect(codeOf(frame([{ id: "X", selfWeight: Number.POSITIVE_INFINITY }]))).toBe(311);
  });

  it("312: no load cases", () => {
    expect(codeOf(frame([]))).toBe(312);
  });

  it("313: self-weight requested for a member without unitWeight", () => {
    const { unitWeight: _omit, ...noWeight } = section;
    const model = frame([{ id: "SW", selfWeight: 1 }]);
    model.members[1].section = noWeight;
    expect(codeOf(model)).toBe(313);
  });

  it("305: a negative unitWeight", () => {
    const model = frame([L]);
    model.members[0].section = { ...section, unitWeight: -1 };
    expect(codeOf(model)).toBe(305);
  });
});
