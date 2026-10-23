import { FrameAnalysisError } from "@app-core/errors/frame-analysis.error";
import { distributeAreaLoads } from "@app-fea/frame/area/distribute-area-loads";
import { analyzeFrame } from "@app-fea/frame/solver/analyze-frame";
import type {
  AreaLoadDirection,
  FrameModel,
  MemberLoad,
  NullArea,
  TrapezoidalMemberLoad,
} from "@app-fea/frame/types/model.type";

type V3 = [number, number, number];
const sec = { E: 200000, G: 80000, A: 5000, I22: 8e7, I33: 8e7, J: 1e7 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const q = -5; // kN/m²

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3) => Math.hypot(...a);

/**
 * One area on the given corners with a beam "e<i>" along every edge i (corner i → i + 1),
 * fixed at the corners, and one load case "D" with `q` on the area.
 */
const slab = (
  corners: V3[],
  area: Partial<NullArea> = {},
  direction: AreaLoadDirection = "Z",
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
  areaLoads: [{ loadCase: "D", areaId: "S", direction, q }],
});

const loadsOn = (loads: MemberLoad[], memberId: string) =>
  loads.filter((l) => l.memberId === memberId) as TrapezoidalMemberLoad[];

/** Resultant force (kN) and moment about the origin (kN·m) of generated member loads. */
const resultant = (model: FrameModel, loads: MemberLoad[]) => {
  const node = (id: unknown): V3 => {
    const n = model.nodes.find((x) => x.id === id)!;
    return [n.x, n.y, n.z];
  };
  const F: V3 = [0, 0, 0];
  const M: V3 = [0, 0, 0]; // kN·mm until the end
  for (const load of loads) {
    const member = model.members.find((m) => m.id === load.memberId)!;
    const A = node(member.startNodeId);
    const d = sub(node(member.endNodeId), A);
    const axis = d.map((v) => v / norm(d)) as V3;
    if (load.type === "torque") {
      const L = norm(d);
      const T = load.t * ((load.end ?? L) - (load.start ?? 0)); // kN·m/m · mm = kN·mm
      axis.forEach((a, k) => (M[k] += T * a));
      continue;
    }
    if (load.type !== "trapezoidal") throw new Error("unexpected load type");
    const e: V3 = [0, 0, 0];
    e["XYZ".indexOf(load.direction)] = 1;
    const a = load.start!;
    const b = load.end!;
    const R = ((load.w1 + load.w2) / 2) * (b - a) * 1e-3; // kN
    const first = ((b - a) * (load.w1 * (2 * a + b) + load.w2 * (a + 2 * b))) / 6e3; // ∫x·w dx, kN·mm
    const f = e.map((v) => v * R) as V3;
    f.forEach((v, k) => (F[k] += v));
    const mA = cross(A, f);
    const mx = cross(axis, e).map((v) => v * first);
    for (let k = 0; k < 3; k++) M[k] += mA[k] + mx[k];
  }
  return { F, M: M.map((v) => v * 1e-3) as V3 };
};

/** Area (mm²) and centroid of a planar convex polygon. */
const polygon = (corners: V3[]) => {
  let area = 0;
  const c: V3 = [0, 0, 0];
  for (let i = 1; i < corners.length - 1; i++) {
    const [p, r, s] = [corners[0], corners[i], corners[i + 1]];
    const a = norm(cross(sub(r, p), sub(s, p))) / 2;
    area += a;
    for (let k = 0; k < 3; k++) c[k] += (a * (p[k] + r[k] + s[k])) / 3;
  }
  return { area, centroid: c.map((v) => v / area) as V3 };
};

/** Expects the loads to add up to q·A along global Z, acting at the area centroid. */
const expectStaticallyEquivalent = (corners: V3[], model: FrameModel, loads: MemberLoad[]) => {
  const { area, centroid } = polygon(corners);
  const { F, M } = resultant(model, loads);
  const Fz = q * area * 1e-6;
  expect(F[0]).toBeCloseTo(0, 9);
  expect(F[1]).toBeCloseTo(0, 9);
  expect(F[2]).toBeCloseTo(Fz, 6);
  const expected = cross(centroid, [0, 0, Fz]).map((v) => v * 1e-3);
  for (let k = 0; k < 3; k++) expect(M[k]).toBeCloseTo(expected[k], 5);
};

const rectangle: V3[] = [
  [0, 0, 3000],
  [6000, 0, 3000],
  [6000, 4000, 3000],
  [0, 4000, 3000],
];

describe("two-way distribution", () => {
  it("rectangle: trapezoids on the long edges, triangles on the short, peak q·Lshort/2", () => {
    const model = slab(rectangle);
    const { memberLoads, warnings } = distributeAreaLoads(model);
    expect(warnings).toEqual([]);
    const long = loadsOn(memberLoads, "e0").map((l) => [l.direction, l.start, l.end, l.w1, l.w2]);
    expect(long).toEqual([
      ["Z", 0, 2000, -0, -10],
      ["Z", 2000, 4000, -10, -10],
      ["Z", 4000, 6000, -10, -0],
    ]);
    const short = loadsOn(memberLoads, "e1").map((l) => [l.start, l.end, l.w1, l.w2]);
    expect(short).toEqual([
      [0, 2000, -0, -10],
      [2000, 4000, -10, -0],
    ]);
    expect(resultant(model, memberLoads).F[2]).toBeCloseTo(q * 24, 9); // −120 kN
  });

  it("triangle: each edge peaks under the incenter at q·r", () => {
    // 3-4-5 right triangle: inradius r = (3 + 4 − 5)/2 = 1 m, incenter (1000, 1000)
    const corners: V3[] = [
      [0, 0, 0],
      [4000, 0, 0],
      [0, 3000, 0],
    ];
    const { memberLoads } = distributeAreaLoads(slab(corners));
    const e0 = loadsOn(memberLoads, "e0");
    expect(e0.map((l) => [l.start, l.end])).toEqual([
      [0, 1000],
      [1000, 4000],
    ]);
    expect(e0[0].w2).toBeCloseTo(q * 1, 9); // −5 kN/m
    expect(e0[1].w2).toBeCloseTo(0, 9);
    // the hypotenuse peaks where the incenter projects onto it, 3000 mm from corner 1
    const e1 = loadsOn(memberLoads, "e1");
    expect(e1[0].end).toBeCloseTo(3000, 6);
    expect(e1[0].w2).toBeCloseTo(q * 1, 9);
    expect(resultant(slab(corners), memberLoads).F[2]).toBeCloseTo(q * 6, 9);
  });

  it("skewed trapezoidal quad: matches a fine-grid nearest-edge oracle edge by edge", () => {
    const corners: V3[] = [
      [0, 0, 0],
      [7000, 0, 0],
      [5000, 4000, 0],
      [500, 3500, 0],
    ];
    const model = slab(corners);
    const { memberLoads } = distributeAreaLoads(model);

    // Oracle: cells of a fine grid go to the nearest edge line, landing at their projection
    const n = corners.length;
    const totals = new Array(n).fill(0);
    const moments = new Array(n).fill(0); // ∫ s dA, s along the edge from its start
    const h = 10; // mm
    for (let x = h / 2; x < 7000; x += h) {
      for (let y = h / 2; y < 4000; y += h) {
        const d = corners.map((a, i) => {
          const b = corners[(i + 1) % n];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
          return {
            dist: -t[1] * (x - a[0]) + t[0] * (y - a[1]),
            s: t[0] * (x - a[0]) + t[1] * (y - a[1]),
          };
        });
        if (d.some((e) => e.dist < 0)) continue; // outside
        const i = d.reduce((best, e, k) => (e.dist < d[best].dist ? k : best), 0);
        totals[i] += h * h;
        moments[i] += h * h * d[i].s;
      }
    }
    for (let i = 0; i < n; i++) {
      const loads = loadsOn(memberLoads, `e${i}`);
      const total = loads.reduce((sum, l) => sum + ((l.w1 + l.w2) / 2) * (l.end! - l.start!), 0);
      const first = loads.reduce(
        (sum, l) =>
          sum +
          ((l.end! - l.start!) *
            (l.w1 * (2 * l.start! + l.end!) + l.w2 * (l.start! + 2 * l.end!))) /
            6,
        0,
      );
      const expected = q * totals[i] * 1e-3;
      expect(total / expected).toBeCloseTo(1, 2);
      expect(first / total / (moments[i] / totals[i])).toBeCloseTo(1, 2);
    }
    expect(resultant(model, memberLoads).F[2]).toBeCloseTo(q * polygon(corners).area * 1e-6, 6);
  });
});

describe("one-way distribution", () => {
  it("rectangle spanning between its long edges: q·L/2 on each, nothing on the short edges", () => {
    const model = slab(rectangle, { distribution: "oneWay", supportEdges: [0, 2] });
    const { memberLoads, warnings } = distributeAreaLoads(model);
    expect(warnings).toEqual([]);
    expect(loadsOn(memberLoads, "e0").map((l) => [l.start, l.end, l.w1, l.w2])).toEqual([
      [0, 6000, -10, -10],
    ]);
    expect(loadsOn(memberLoads, "e2")).toHaveLength(1);
    expect(loadsOn(memberLoads, "e1")).toEqual([]);
    expect(loadsOn(memberLoads, "e3")).toEqual([]);
    expectStaticallyEquivalent(rectangle, model, memberLoads);
  });

  it.each<[string, V3[], number[]]>([
    [
      "a parallelogram between its long edges",
      [
        [0, 0, 0],
        [6000, 0, 0],
        [7500, 3000, 0],
        [1500, 3000, 0],
      ],
      [0, 2],
    ],
    [
      "a trapezoid between its legs",
      [
        [0, 0, 0],
        [6000, 0, 0],
        [4500, 3000, 0],
        [1500, 3000, 0],
      ],
      [1, 3],
    ],
    [
      "a triangle on two edges",
      [
        [0, 0, 0],
        [5000, 0, 0],
        [2000, 3000, 0],
      ],
      [1, 2],
    ],
  ])("%s: the loads add up to q·A acting at the centroid", (_, corners, supportEdges) => {
    const model = slab(corners, { distribution: "oneWay", supportEdges });
    const { memberLoads } = distributeAreaLoads(model);
    expectStaticallyEquivalent(corners, model, memberLoads);
  });

  it("parallelogram: uniform q·h/2 on each support, with h the perpendicular depth", () => {
    const corners: V3[] = [
      [0, 0, 0],
      [6000, 0, 0],
      [7500, 3000, 0],
      [1500, 3000, 0],
    ];
    const { memberLoads } = distributeAreaLoads(
      slab(corners, { distribution: "oneWay", supportEdges: [0, 2] }),
    );
    for (const l of loadsOn(memberLoads, "e0")) {
      expect(l.w1).toBeCloseTo(q * 1.5, 9);
      expect(l.w2).toBeCloseTo(q * 1.5, 9);
    }
  });

  it("warns when a support edge runs parallel to the span and gets nothing", () => {
    const model = slab(rectangle, { distribution: "oneWay", supportEdges: [0, 1, 2] });
    const { memberLoads, warnings } = distributeAreaLoads(model);
    expect(loadsOn(memberLoads, "e1")).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Area "S": support edge 1');
    expectStaticallyEquivalent(rectangle, model, memberLoads);
  });
});

describe("cantilever distribution", () => {
  // 6 m long, 1.5 m deep balcony on edge 0
  const balcony: V3[] = [
    [0, 0, 3000],
    [6000, 0, 3000],
    [6000, 1500, 3000],
    [0, 1500, 3000],
  ];
  const model = slab(balcony, { distribution: "cantilever", supportEdges: [0] });

  it("puts q·c and the torque q·c²/2 on the support edge only", () => {
    const { memberLoads } = distributeAreaLoads(model);
    expect(memberLoads.every((l) => l.memberId === "e0")).toBe(true);
    const [line, torque] = memberLoads;
    expect(line).toMatchObject({ type: "trapezoidal", direction: "Z", start: 0, end: 6000 });
    expect((line as TrapezoidalMemberLoad).w1).toBeCloseTo(q * 1.5, 9); // −7.5 kN/m
    expect(torque).toMatchObject({ type: "torque", memberId: "e0" });
    expect(torque.type === "torque" && torque.t).toBeCloseTo((q * 1.5 ** 2) / 2, 9); // −5.625 kN·m/m
    expectStaticallyEquivalent(balcony, model, memberLoads);
  });

  it("flips the torque for a member running against the edge, keeping the statics", () => {
    const reversed = slab(balcony, { distribution: "cantilever", supportEdges: [0] });
    reversed.members[0] = { id: "e0", startNodeId: 1, endNodeId: 0, section: sec };
    const { memberLoads } = distributeAreaLoads(reversed);
    const torque = memberLoads.find((l) => l.type === "torque");
    expect(torque?.type === "torque" && torque.t).toBeCloseTo((-q * 1.5 ** 2) / 2, 9);
    expectStaticallyEquivalent(balcony, reversed, memberLoads);
  });

  it("is carried by the beam: Σ reactions balance q·A and its moment about the edge", () => {
    const r = analyzeFrame({
      ...model,
      members: [model.members[0]],
      restraints: model.restraints,
    }).cases.D;
    const sum = (key: "fz" | "mx") => r.reactions.reduce((s, x) => s + x[key], 0);
    expect(sum("fz")).toBeCloseTo(-q * 9, 6); // 45 kN up
    expect(sum("mx")).toBeCloseTo(-(0.75 * q * 9), 6); // balances −33.75 kN·m about X
  });
});

describe("inclined areas and edge chains", () => {
  it("a normal load on a ramp acts along its normal, per unit true area", () => {
    const ramp: V3[] = [
      [0, 0, 0],
      [4000, 0, 0],
      [4000, 3000, 1500],
      [0, 3000, 1500],
    ];
    const model = slab(ramp, {}, "3");
    const { memberLoads } = distributeAreaLoads(model);
    expect(new Set(memberLoads.map((l) => l.type === "trapezoidal" && l.direction))).toEqual(
      new Set(["Y", "Z"]),
    );
    const { F } = resultant(model, memberLoads);
    const k = Math.hypot(3000, 1500);
    const total = q * 4000 * k * 1e-6;
    expect(F[0]).toBeCloseTo(0, 9);
    expect(F[1]).toBeCloseTo((total * -1500) / k, 6);
    expect(F[2]).toBeCloseTo((total * 3000) / k, 6);
  });

  it("an edge split by a node is cut at the node, and the analysis is unchanged", () => {
    const whole = slab(rectangle);
    const split = slab(rectangle);
    split.nodes.push({ id: 9, x: 2500, y: 0, z: 3000 });
    split.members.splice(
      0,
      1,
      { id: "a", startNodeId: 0, endNodeId: 9, section: sec },
      { id: "b", startNodeId: 1, endNodeId: 9, section: sec }, // against the edge
    );
    const { memberLoads } = distributeAreaLoads(split);
    expect(loadsOn(memberLoads, "a").map((l) => [l.start, l.end, l.w1, l.w2])).toEqual([
      [0, 2000, -0, -10],
      [2000, 2500, -10, -10],
    ]);
    expect(
      loadsOn(memberLoads, "b")
        .map((l) => [l.start, l.end, l.w1, l.w2])
        .sort((x, y) => x[0] - y[0]),
    ).toEqual([
      [0, 2000, -0, -10],
      [2000, 3500, -10, -10],
    ]);
    const reactions = (m: FrameModel) => analyzeFrame(m).cases.D.reactions;
    const [r1, r2] = [reactions(whole), reactions(split)];
    for (const r of r1) {
      const other = r2.find((x) => x.nodeId === r.nodeId)!;
      for (const key of ["fx", "fy", "fz", "mx", "my", "mz"] as const)
        expect(other[key]).toBeCloseTo(r[key], 4);
    }
  });
});

describe("analyzeFrame with null areas", () => {
  it("adds the area loads to the case, so the reactions balance q·A, and factors them in combinations", () => {
    const model: FrameModel = {
      ...slab(rectangle),
      combinations: [{ id: "U", terms: [{ case: "D", factor: 1.4 }] }],
    };
    const result = analyzeFrame(model);
    const fz = (r: (typeof result.cases)[string]) => r.reactions.reduce((s, x) => s + x.fz, 0);
    expect(fz(result.cases.D)).toBeCloseTo(-q * 24, 6); // 120 kN up
    expect(fz(result.combinations.U)).toBeCloseTo(-q * 24 * 1.4, 6);
    expect(result.cases.D.equilibriumResidual.force).toBeCloseTo(0, 6);
  });

  it("reports the distribution warnings in the result", () => {
    const result = analyzeFrame(
      slab(rectangle, { distribution: "oneWay", supportEdges: [0, 1, 2] }),
    );
    expect(result.warnings.some((w) => w.message.includes("support edge 1"))).toBe(true);
  });

  it("sends nothing from an area without loads or with q = 0", () => {
    const model = slab(rectangle);
    expect(distributeAreaLoads({ ...model, areaLoads: [] }).memberLoads).toEqual([]);
    expect(
      distributeAreaLoads({
        ...model,
        areaLoads: [{ loadCase: "D", areaId: "S", direction: "Z", q: 0 }],
      }).memberLoads,
    ).toEqual([]);
  });

  it("distributeAreaLoads validates the model first", () => {
    const model = slab(rectangle);
    model.members = model.members.slice(1);
    expect(() => distributeAreaLoads(model)).toThrow(FrameAnalysisError);
    try {
      distributeAreaLoads(model);
    } catch (e) {
      expect((e as FrameAnalysisError).code).toBe(316);
    }
  });
});
