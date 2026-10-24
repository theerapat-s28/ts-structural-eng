import { FrameAnalysisError } from "@app-core/errors/frame-analysis.error";
import { distributeAreaLoads } from "@app-fea/frame/area/distribute-area-loads";
import { analyzeFrame } from "@app-fea/frame/solver/analyze-frame";
import type {
  AreaLoad,
  FrameModel,
  NullArea,
  TrapezoidalMemberLoad,
} from "@app-fea/frame/types/model.type";
import type { FrameCaseResult } from "@app-fea/frame/types/results.type";
import { validateFrameModel } from "@app-fea/frame/validation/validate-model";

import { analyzeSingleCase, type UntaggedMemberLoad } from "./single-case";

type V3 = [number, number, number];
const sec = { E: 200000, G: 80000, A: 5000, I22: 8e7, I33: 8e7, J: 1e7 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

/** Casts a deliberately malformed value past the types, as untyped UI input would arrive. */
const bad = <T>(value: unknown) => value as T;

/** One member from the origin to `end`, fixed at both ends. */
const strut = (end: V3, memberLoads: UntaggedMemberLoad[]) =>
  analyzeSingleCase({
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: end[0], y: end[1], z: end[2] },
    ],
    members: [{ id: "AB", startNodeId: "A", endNodeId: "B", section: sec }],
    restraints: [
      { nodeId: "A", ...fixed },
      { nodeId: "B", ...fixed },
    ],
    memberLoads,
  });

const total = (r: FrameCaseResult, key: "fx" | "fy" | "fz") =>
  r.reactions.reduce((s, x) => s + x[key], 0);

/** Every reaction component of `a` matches `b`. */
const expectSameReactions = (a: FrameCaseResult, b: FrameCaseResult) => {
  a.reactions.forEach((ra, i) => {
    const rb = b.reactions[i];
    for (const key of ["fx", "fy", "fz", "mx", "my", "mz"] as const) {
      expect(ra[key]).toBeCloseTo(rb[key], 2);
    }
  });
};

describe("projected member loads", () => {
  // portal-frame rafter at 30°, 6 m plan span
  const theta = Math.PI / 6;
  const rafter: V3 = [6000, 0, 6000 * Math.tan(theta)];
  const w = -1.2; // kN/m of plan length (snow)

  it("puts w · plan length on a sloped rafter, the same as w · cos θ per member length", () => {
    const projected = strut(rafter, [
      { type: "udl", memberId: "AB", direction: "Z", w, projected: true },
    ]);
    const manual = strut(rafter, [
      { type: "udl", memberId: "AB", direction: "Z", w: w * Math.cos(theta) },
    ]);
    expect(total(projected, "fz")).toBeCloseTo(-w * 6, 3); // reactions balance 7.2 kN
    expectSameReactions(projected, manual);
    const plain = strut(rafter, [{ type: "udl", memberId: "AB", direction: "Z", w }]);
    expect(total(plain, "fz")).toBeCloseTo((-w * 6) / Math.cos(theta), 3);
  });

  it("scales partial trapezoidal loads by the same factor, positions along the member", () => {
    const load = { type: "trapezoidal", memberId: "AB", direction: "Z", start: 1000, end: 5000 };
    const projected = strut(rafter, [
      { ...load, w1: -2, w2: -4, projected: true } as UntaggedMemberLoad,
    ]);
    const c = Math.cos(theta);
    const manual = strut(rafter, [{ ...load, w1: -2 * c, w2: -4 * c } as UntaggedMemberLoad]);
    expectSameReactions(projected, manual);
    expect(total(projected, "fz")).toBeCloseTo(3 * 4 * c, 3); // mean 3 kN/m over 4 m of member
  });

  it("gives a vertical column nothing under projected Z, and the full load under projected X", () => {
    const column: V3 = [0, 0, 3500];
    const z = strut(column, [
      { type: "udl", memberId: "AB", direction: "Z", w: -5, projected: true },
    ]);
    z.reactions.forEach((r) => expect(Math.abs(r.fz) + Math.abs(r.fx)).toBe(0));
    const x = strut(column, [
      { type: "udl", memberId: "AB", direction: "X", w: 2, projected: true },
    ]);
    expect(total(x, "fx")).toBeCloseTo(-2 * 3.5, 3);
  });

  it("leaves a load perpendicular to the member unchanged", () => {
    const beam: V3 = [6000, 0, 0];
    for (const direction of ["Y", "Z"] as const) {
      const projected = strut(beam, [
        { type: "udl", memberId: "AB", direction, w: -3, projected: true },
      ]);
      const plain = strut(beam, [{ type: "udl", memberId: "AB", direction, w: -3 }]);
      expectSameReactions(projected, plain);
    }
  });

  it("uses Lproj / L = √(1 − c²) on a skewed 3D member", () => {
    const skew: V3 = [3000, 4000, 12000]; // L = 13 m, direction cosines 3/13, 4/13, 12/13
    const z = strut(skew, [
      { type: "udl", memberId: "AB", direction: "Z", w: -2, projected: true },
    ]);
    expect(total(z, "fz")).toBeCloseTo(2 * 5, 3); // Lproj onto XY = 5 m
    const x = strut(skew, [{ type: "udl", memberId: "AB", direction: "X", w: 1, projected: true }]);
    expect(total(x, "fx")).toBeCloseTo(-Math.hypot(4, 12), 3); // Lproj onto YZ = √160 m
  });

  it("superposes in combinations", () => {
    const model: FrameModel = {
      nodes: [
        { id: "A", x: 0, y: 0, z: 0 },
        { id: "B", x: rafter[0], y: rafter[1], z: rafter[2] },
      ],
      members: [{ id: "AB", startNodeId: "A", endNodeId: "B", section: sec }],
      restraints: [
        { nodeId: "A", ...fixed },
        { nodeId: "B", ...fixed },
      ],
      loadCases: [{ id: "S" }],
      memberLoads: [
        { loadCase: "S", type: "udl", memberId: "AB", direction: "Z", w, projected: true },
      ],
      combinations: [{ id: "U", terms: [{ case: "S", factor: 1.6 }] }],
    };
    const result = analyzeFrame(model);
    expect(total(result.combinations.U, "fz")).toBeCloseTo(1.6 * -w * 6, 3);
  });
});

describe("projected area loads", () => {
  // ramp rising 3 m over 4 m in Y: true depth 5 m, cos θ = 0.8, normal ∝ (0, −3, 4)
  const ramp: V3[] = [
    [0, 0, 0],
    [6000, 0, 0],
    [6000, 4000, 3000],
    [0, 4000, 3000],
  ];
  const q = -5; // kN/m²

  /** One area on the corners, a beam along every edge, fixed corners, area loads in case "D". */
  const slab = (
    corners: V3[],
    loads: Omit<AreaLoad, "loadCase" | "areaId">[],
    area: Partial<NullArea> = {},
  ): FrameModel => ({
    nodes: corners.map(([x, y, z], i) => ({ id: i, x, y, z })),
    members: corners.map((_, i) => ({
      id: `e${i}`,
      startNodeId: i,
      endNodeId: (i + 1) % corners.length,
      section: sec,
    })),
    restraints: corners.map((_, i) => ({ nodeId: i, ...fixed })),
    loadCases: [{ id: "D" }],
    areas: [{ id: "S", nodeIds: corners.map((_, i) => i), distribution: "twoWay", ...area }],
    areaLoads: loads.map((l) => ({ ...l, loadCase: "D", areaId: "S" })),
  });

  it.each<[string, Partial<NullArea>]>([
    ["two-way", {}],
    ["one-way", { distribution: "oneWay", supportEdges: [0, 2] }],
    ["cantilever", { distribution: "cantilever", supportEdges: [0] }],
  ])(
    "puts q · plan area on an inclined %s ramp, the same as q · cos θ on the true area",
    (_, area) => {
      const projected = slab(ramp, [{ direction: "Z", q, projected: true }], area);
      const manual = slab(ramp, [{ direction: "Z", q: q * 0.8 }], area);
      const loads = (m: FrameModel) => distributeAreaLoads(m).memberLoads;
      const [p, m] = [loads(projected), loads(manual)];
      expect(p).toHaveLength(m.length);
      p.forEach((load, i) => {
        const other = m[i];
        if (load.type === "torque" && other.type === "torque")
          expect(load.t).toBeCloseTo(other.t, 9);
        else {
          const [a, b] = [load as TrapezoidalMemberLoad, other as TrapezoidalMemberLoad];
          expect(a).toMatchObject({
            memberId: b.memberId,
            direction: b.direction,
            start: b.start,
            end: b.end,
          });
          expect(a.w1).toBeCloseTo(b.w1, 9);
          expect(a.w2).toBeCloseTo(b.w2, 9);
          expect(a).not.toHaveProperty("projected");
        }
      });
      expect(total(analyzeFrame(projected).cases.D, "fz")).toBeCloseTo(-q * 6 * 4, 2); // 120 kN
    },
  );

  it("projects onto the plane normal to a horizontal direction too", () => {
    // |n · Y| = 0.6: the ramp's projection onto XZ is 6 m × 3 m
    const result = analyzeFrame(slab(ramp, [{ direction: "Y", q: 2, projected: true }])).cases.D;
    expect(total(result, "fy")).toBeCloseTo(-2 * 6 * 3, 2);
  });

  it("sends nothing from a vertical area under projected Z", () => {
    const wall: V3[] = [
      [0, 0, 0],
      [6000, 0, 0],
      [6000, 0, 3000],
      [0, 0, 3000],
    ];
    expect(
      distributeAreaLoads(slab(wall, [{ direction: "Z", q, projected: true }])).memberLoads,
    ).toEqual([]);
    expect(
      distributeAreaLoads(slab(wall, [{ direction: "Z", q }])).memberLoads.length,
    ).toBeGreaterThan(0);
  });
});

describe("projected load validation", () => {
  const model = (over: Partial<FrameModel>): FrameModel => ({
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 },
      { id: 2, x: 6000, y: 0, z: 0 },
      { id: 3, x: 6000, y: 4000, z: 0 },
      { id: 4, x: 0, y: 4000, z: 0 },
    ],
    members: [
      { id: "12", startNodeId: 1, endNodeId: 2, section: sec },
      { id: "23", startNodeId: 2, endNodeId: 3, section: sec },
      { id: "34", startNodeId: 3, endNodeId: 4, section: sec },
      { id: "41", startNodeId: 4, endNodeId: 1, section: sec },
    ],
    restraints: [1, 2, 3, 4].map((nodeId) => ({ nodeId, ...fixed })),
    loadCases: [{ id: "D" }],
    areas: [{ id: "S1", nodeIds: [1, 2, 3, 4], distribution: "twoWay" }],
    ...over,
  });
  const issues = (m: FrameModel) => validateFrameModel(m).map((i) => [i.code, i.details]);
  const member = { loadCaseId: "D", memberId: "12", field: "projected" };
  const area = { loadCaseId: "D", areaId: "S1", field: "projected" };

  it("accepts projected distributed loads in global directions, and projected: false anywhere", () => {
    expect(
      issues(
        model({
          memberLoads: [
            { loadCase: "D", type: "udl", memberId: "12", direction: "Z", w: -1, projected: true },
            {
              loadCase: "D",
              type: "trapezoidal",
              memberId: "12",
              direction: "Y",
              w1: 1,
              w2: 2,
              projected: true,
            },
            { loadCase: "D", type: "udl", memberId: "12", direction: "2", w: -1, projected: false },
            bad({
              loadCase: "D",
              type: "point",
              memberId: "12",
              direction: "Z",
              P: -1,
              a: 0,
              projected: false,
            }),
          ],
          areaLoads: [
            { loadCase: "D", areaId: "S1", direction: "Z", q: -1, projected: true },
            { loadCase: "D", areaId: "S1", direction: "3", q: -1, projected: false },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("314 for projected on a local direction, a point or torque load, or the area normal", () => {
    expect(
      issues(
        model({
          memberLoads: [
            { loadCase: "D", type: "udl", memberId: "12", direction: "2", w: -1, projected: true },
            {
              loadCase: "D",
              type: "trapezoidal",
              memberId: "12",
              direction: "1",
              w1: 1,
              w2: 2,
              projected: true,
            },
            bad({
              loadCase: "D",
              type: "point",
              memberId: "12",
              direction: "Z",
              P: -1,
              a: 0,
              projected: true,
            }),
            bad({ loadCase: "D", type: "torque", memberId: "12", t: 1, projected: true }),
          ],
          areaLoads: [{ loadCase: "D", areaId: "S1", direction: "3", q: -1, projected: true }],
        }),
      ),
    ).toEqual([
      [314, member],
      [314, member],
      [314, member],
      [314, member],
      [314, area],
    ]);
  });

  it("314 for a projected flag that is not a boolean", () => {
    const m = model({
      memberLoads: [
        bad({
          loadCase: "D",
          type: "udl",
          memberId: "12",
          direction: "Z",
          w: -1,
          projected: "yes",
        }),
      ],
      areaLoads: [bad({ loadCase: "D", areaId: "S1", direction: "Z", q: -1, projected: 1 })],
    });
    expect(issues(m)).toEqual([
      [314, member],
      [314, area],
    ]);
    expect(() => analyzeFrame(m)).toThrow(FrameAnalysisError);
  });
});
