import { FrameAnalysisError } from "@app-core/errors/frame-analysis.error";
import { analyzeFrame, createFrameAnalysis } from "@app-fea/frame/solver/analyze-frame";
import { memberDemandEnvelope } from "@app-fea/frame/post/demand-envelope";
import type { FrameModel } from "@app-fea/frame/types/model.type";
import { validateFrameModel } from "@app-fea/frame/validation/validate-model";

const sec = { E: 200000, G: 80000, A: 5000, I22: 8e7, I33: 8e7, J: 1e7 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

const model = (over: Partial<FrameModel> = {}): FrameModel => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 3000, y: 0, z: 0 },
  ],
  members: [{ id: "m", startNodeId: 1, endNodeId: 2, section: sec }],
  restraints: [{ nodeId: 1, ...fixed }],
  loadCases: [{ id: "D" }],
  nodalLoads: [{ loadCase: "D", nodeId: 2, fz: -10 }],
  ...over,
});

/** Casts a deliberately malformed value past the types, as untyped UI input would arrive. */
const bad = <T>(value: unknown) => value as T;

const thrown = (m: FrameModel): FrameAnalysisError => {
  try {
    analyzeFrame(m);
  } catch (e) {
    expect(e).toBeInstanceOf(FrameAnalysisError);
    return e as FrameAnalysisError;
  }
  throw new Error("expected analyzeFrame to throw");
};

describe("input values a form can produce", () => {
  it.each([
    [
      "NaN node coordinate",
      model({
        nodes: [
          { id: 1, x: 0, y: 0, z: 0 },
          { id: 2, x: Number.NaN, y: 0, z: 0 },
        ],
      }),
      { nodeId: 2, field: "x" },
    ],
    [
      "NaN nodal load",
      model({ nodalLoads: [{ loadCase: "D", nodeId: 2, fz: Number.NaN }] }),
      { loadCaseId: "D", nodeId: 2, field: "fz" },
    ],
    [
      "a number typed as a string",
      model({ nodalLoads: [{ loadCase: "D", nodeId: 2, fz: bad<number>("-10") }] }),
      { loadCaseId: "D", nodeId: 2, field: "fz" },
    ],
    [
      "NaN member angle",
      model({
        members: [{ id: "m", startNodeId: 1, endNodeId: 2, section: sec, angle: Number.NaN }],
      }),
      { memberId: "m", field: "angle" },
    ],
    [
      "NaN uniform load",
      model({
        memberLoads: [{ loadCase: "D", type: "udl", memberId: "m", direction: "Z", w: Number.NaN }],
      }),
      { loadCaseId: "D", memberId: "m", field: "w" },
    ],
    [
      "NaN trapezoidal end intensity",
      model({
        memberLoads: [
          {
            loadCase: "D",
            type: "trapezoidal",
            memberId: "m",
            direction: "Z",
            w1: -5,
            w2: Number.NaN,
          },
        ],
      }),
      { loadCaseId: "D", memberId: "m", field: "w2" },
    ],
    [
      "infinite point-load position",
      model({
        memberLoads: [
          { loadCase: "D", type: "point", memberId: "m", direction: "Z", P: -1, a: Infinity },
        ],
      }),
      { loadCaseId: "D", memberId: "m", field: "a" },
    ],
    [
      "negative spring stiffness",
      model({
        restraints: [
          { nodeId: 1, ...fixed },
          { nodeId: 2, uz: -5 },
        ],
      }),
      { nodeId: 2, field: "uz" },
    ],
    [
      "lower-case direction",
      model({
        memberLoads: [
          { loadCase: "D", type: "udl", memberId: "m", direction: bad<"Z">("z"), w: -5 },
        ],
      }),
      { loadCaseId: "D", memberId: "m", field: "direction" },
    ],
    [
      "unknown member load type",
      model({
        memberLoads: [
          bad({ loadCase: "D", type: "trapezoid", memberId: "m", direction: "Z", w: -5 }),
        ],
      }),
      { loadCaseId: "D", memberId: "m", field: "type" },
    ],
    [
      "unknown load case type label",
      model({ loadCases: [{ id: "D", type: bad<"dead">("Dead") }] }),
      { loadCaseId: "D", field: "type" },
    ],
  ])("%s → FrameAnalysisError 314 naming where it is", (_, m, details) => {
    const error = thrown(m);
    expect(error.code).toBe(314);
    expect(error.details).toEqual(details);
    expect(error.message).toContain("[");
  });
});

describe("validateFrameModel", () => {
  it("returns no issues for a valid model", () => {
    expect(validateFrameModel(model())).toEqual([]);
  });

  it("collects every problem at once, each with its location", () => {
    const issues = validateFrameModel(
      model({
        nodes: [
          { id: 1, x: 0, y: 0, z: 0 },
          { id: 2, x: 3000, y: Number.NaN, z: 0 },
        ],
        members: [
          { id: "m", startNodeId: 1, endNodeId: 2, section: { ...sec, I33: 0 } },
          { id: "n", startNodeId: 1, endNodeId: 9, section: sec },
        ],
        nodalLoads: [{ loadCase: "X", nodeId: 2, fz: -1 }],
        combinations: [{ id: "C", terms: [{ case: "D", factor: Number.NaN }] }],
      }),
    );
    expect(issues.map((i) => [i.code, i.details])).toEqual([
      [314, { nodeId: 2, field: "y" }],
      [305, { memberId: "m", field: "I33" }],
      [302, { memberId: "n", field: "endNodeId" }],
      [309, { loadCaseId: "X", nodeId: 2, field: "loadCase" }],
      [311, { combinationId: "C", field: "factor" }],
    ]);
  });

  it("is what analyzeFrame throws: the first issue, with all of them in `issues`", () => {
    const m = model({
      nodalLoads: [
        { loadCase: "D", nodeId: 2, fz: Number.NaN },
        { loadCase: "D", nodeId: 2, fx: Number.NaN },
      ],
    });
    const error = thrown(m);
    expect(error.issues).toEqual(validateFrameModel(m));
    expect(error.issues).toHaveLength(2);
    expect(error.details).toEqual(error.issues[0].details);
  });

  it("locates members, load cases and combinations in the other codes", () => {
    const loop = validateFrameModel(
      model({
        combinations: [
          { id: "C1", terms: [{ combination: "C2", factor: 1 }] },
          { id: "C2", terms: [{ combination: "C1", factor: 1 }] },
        ],
      }),
    );
    expect(loop.map((i) => i.code)).toEqual([310]);
    expect(loop[0].details.combinationId).toBeDefined();

    const release = validateFrameModel(
      model({
        members: [
          {
            id: "m",
            startNodeId: 1,
            endNodeId: 2,
            section: sec,
            releases: { start: { u1: true }, end: { u1: true } },
          },
        ],
      }),
    );
    expect(release.map((i) => [i.code, i.details])).toEqual([[307, { memberId: "m" }]]);

    const outside = validateFrameModel(
      model({
        memberLoads: [
          { loadCase: "D", type: "point", memberId: "m", direction: "Z", P: 1, a: 5000 },
        ],
      }),
    );
    expect(outside.map((i) => [i.code, i.details])).toEqual([
      [308, { loadCaseId: "D", memberId: "m" }],
    ]);

    const weight = validateFrameModel(model({ loadCases: [{ id: "D", selfWeight: 1 }] }));
    expect(weight.map((i) => [i.code, i.details])).toEqual([
      [313, { loadCaseId: "D", memberId: "m", field: "unitWeight" }],
    ]);
  });
});

describe("unstable structure (304)", () => {
  it("names a node and DOF of the mechanism", () => {
    // free to slide along X and to twist: nothing resists ux or rx
    const error = thrown(
      model({ restraints: [{ nodeId: 1, uy: true, uz: true, ry: true, rz: true }] }),
    );
    expect(error.code).toBe(304);
    expect(error.details.nodeId).toBeDefined();
    expect(["ux", "rx"]).toContain(error.details.dof);
  });

  it("points at the unsupported part of the model", () => {
    const m = model();
    m.nodes.push({ id: "F1", x: 0, y: 5000, z: 0 }, { id: "F2", x: 3000, y: 5000, z: 0 });
    m.members.push({ id: "floating", startNodeId: "F1", endNodeId: "F2", section: sec });
    const error = thrown(m);
    expect(error.code).toBe(304);
    expect(["F1", "F2"]).toContain(error.details.nodeId);
  });
});

describe("createFrameAnalysis and diagram detail", () => {
  const frame = (): FrameModel => ({
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: 0, y: 0, z: 3500 },
      { id: "C", x: 6000, y: 0, z: 3500 },
      { id: "D", x: 6000, y: 0, z: 0 },
    ],
    members: [
      { id: "AB", startNodeId: "A", endNodeId: "B", section: sec },
      { id: "BC", startNodeId: "B", endNodeId: "C", section: sec },
      { id: "DC", startNodeId: "D", endNodeId: "C", section: sec },
    ],
    restraints: [
      { nodeId: "A", ...fixed },
      { nodeId: "D", ...fixed },
    ],
    loadCases: [{ id: "G" }, { id: "W" }],
    memberLoads: [
      { loadCase: "G", type: "udl", memberId: "BC", direction: "Z", w: -20 },
      { loadCase: "G", type: "point", memberId: "BC", direction: "Z", P: -30, a: 2000 },
    ],
    nodalLoads: [{ loadCase: "W", nodeId: "B", fx: 15 }],
    combinations: [
      {
        id: "G+W",
        terms: [
          { case: "G", factor: 1.2 },
          { case: "W", factor: 1 },
        ],
      },
    ],
  });

  it("'extremes' keeps every extreme and the envelope but drops the stations", () => {
    const full = analyzeFrame(frame());
    const lean = analyzeFrame(frame(), { diagrams: "extremes" });
    for (const id of ["G", "W"]) {
      lean.cases[id].memberDiagrams.forEach((d, i) => {
        expect(d.stations).toEqual([]);
        expect(d.extremes).toEqual(full.cases[id].memberDiagrams[i].extremes);
      });
    }
    expect(lean.envelope).toEqual(full.envelope);
    expect(JSON.stringify(lean).length).toBeLessThan(JSON.stringify(full).length / 2);
  });

  it("memberDiagram computes a full diagram on demand, equal to the full analysis", () => {
    const full = analyzeFrame(frame());
    const analysis = createFrameAnalysis(frame(), { diagrams: "extremes" });
    expect(analysis.memberDiagram("G+W", "BC")).toEqual(full.combinations["G+W"].memberDiagrams[1]);
    expect(analysis.memberDiagram("W", "AB")).toEqual(full.cases.W.memberDiagrams[0]);
    expect(analysis.memberDiagram("G", "BC", 41).stations.length).toBeGreaterThan(41);
    expect(() => analysis.memberDiagram("nope", "BC")).toThrow();
    expect(() => analysis.memberDiagram("G", "nope")).toThrow();
  });

  it("memberDemandEnvelope works on an extremes-only result, except at a critical distance", () => {
    const full = analyzeFrame(frame());
    const lean = analyzeFrame(frame(), { diagrams: "extremes" });
    expect(memberDemandEnvelope(lean, "BC")).toEqual(memberDemandEnvelope(full, "BC"));
    expect(() => memberDemandEnvelope(lean, "BC", { shearCriticalDistance: 500 })).toThrow(
      /stations/,
    );
  });

  it("reports the stiffness profile size in calculationDetails", () => {
    const r = analyzeFrame(frame());
    expect(r.calculationDetails.profileSize).toBeGreaterThan(0);
    expect(r.calculationDetails.profileSize).toBeLessThanOrEqual(
      (r.calculationDetails.freeDofCount * (r.calculationDetails.freeDofCount + 1)) / 2,
    );
  });
});
