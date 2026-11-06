import { FeaError } from "@app-core/errors/fea.error";
import { analyze } from "@app-fea/analysis/solver/analyze";
import type {
  FeaModel,
  NodalLoad,
  WallPier,
  WallSpandrel,
} from "@app-fea/analysis/types/model.type";
import type { PierCut, SpandrelCut, WallResultants } from "@app-fea/analysis/types/results.type";
import { validateModel } from "@app-fea/analysis/validation/validate-model";
import type { Member } from "@app-fea/frame/types/model.type";
import type { ShellArea, ShellSection } from "@app-fea/shell/types/model.type";

type V3 = [number, number, number];

const concrete: ShellSection = { thickness: 200, E: 30000, nu: 0.2, unitWeight: 24 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const column: Member["section"] = {
  E: 30000,
  G: 12500,
  A: 160000,
  I22: 2.13e9,
  I33: 2.13e9,
  J: 3.6e9,
};

/**
 * A wall in the XZ plane (y = 0) made of one shell area per grid cell, fixed along its base.
 * Node ids are "x,z"; area ids "A<i>,<j>" for cell i along X and j up; `skip` leaves cells open.
 */
const wall = (
  xs: number[],
  zs: number[],
  options: {
    skip?: string[];
    divisions?: [number, number];
    nodalLoads?: Omit<NodalLoad, "loadCase">[];
    piers?: WallPier[];
    spandrels?: WallSpandrel[];
    members?: Member[];
  } = {},
): FeaModel => {
  const nodes = xs.flatMap((x) => zs.map((z) => ({ id: `${x},${z}`, x, y: 0, z })));
  const shells: ShellArea[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const id = `A${i},${j}`;
      if (options.skip?.includes(id)) continue;
      shells.push({
        id,
        nodeIds: [
          `${xs[i]},${zs[j]}`,
          `${xs[i + 1]},${zs[j]}`,
          `${xs[i + 1]},${zs[j + 1]}`,
          `${xs[i]},${zs[j + 1]}`,
        ],
        section: concrete,
        ...(options.divisions ? { mesh: { divisions: options.divisions } } : {}),
      });
    }
  }
  return {
    nodes,
    members: options.members,
    shells,
    restraints: [],
    lineRestraints: [{ nodeIds: [`${xs[0]},${zs[0]}`, `${xs[xs.length - 1]},${zs[0]}`], ...fixed }],
    loadCases: [{ id: "L" }],
    nodalLoads: (options.nodalLoads ?? []).map((load) => ({ ...load, loadCase: "L" })),
    piers: options.piers,
    spandrels: options.spandrels,
  };
};

/** The resultant of point loads about c, in the axes `axes` (kN, kN·m). */
const statics = (
  loads: { at: V3; f: V3; m?: V3 }[],
  c: readonly number[],
  axes: readonly (readonly number[])[],
): WallResultants => {
  const F: V3 = [0, 0, 0];
  const M: V3 = [0, 0, 0];
  for (const { at, f, m = [0, 0, 0] } of loads) {
    const r = [at[0] - c[0], at[1] - c[1], at[2] - c[2]];
    const rf = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    for (let k = 0; k < 3; k++) {
      F[k] += f[k];
      M[k] += m[k] + rf[k] * 1e-3; // kN·mm → kN·m
    }
  }
  const d = (p: V3, e: readonly number[]) => p[0] * e[0] + p[1] * e[1] + p[2] * e[2];
  return {
    P: d(F, axes[0]),
    V2: d(F, axes[1]),
    V3: d(F, axes[2]),
    T: d(M, axes[0]),
    M2: d(M, axes[1]),
    M3: d(M, axes[2]),
  };
};

const expectResultants = (actual: WallResultants, expected: WallResultants, digits = 3) => {
  for (const key of ["P", "V2", "V3", "T", "M2", "M3"] as const) {
    expect(actual[key], key).toBeCloseTo(expected[key], digits);
  }
};

const cut = <T extends PierCut | SpandrelCut>(cuts: T[], position: number, face: T["face"]) => {
  const found = cuts.find(
    (c) => ("z" in c ? c.z : (c as SpandrelCut).x) === position && c.face === face,
  );
  if (!found) throw new Error(`no ${face} cut at ${position}`);
  return found;
};

/** 3 m wide, two 3 m lifts; 50 kN along +X and 100 kN down at each top corner. */
const cantilever = (extra: { divisions?: [number, number]; pier?: Partial<WallPier> } = {}) =>
  wall([0, 3000], [0, 3000, 6000], {
    divisions: extra.divisions,
    nodalLoads: [
      { nodeId: "0,6000", fx: 50, fz: -100 },
      { nodeId: "3000,6000", fx: 50, fz: -100 },
    ],
    piers: [{ id: "P1", areaIds: ["A0,0", "A0,1"], ...extra.pier }],
  });
const topLoads: { at: V3; f: V3 }[] = [
  { at: [0, 0, 6000], f: [50, 0, -100] },
  { at: [3000, 0, 6000], f: [50, 0, -100] },
];

describe("pier forces: planar cantilever wall", () => {
  for (const divisions of [undefined, [6, 6]] as const) {
    it(`matches statics at every cut (${divisions ? "meshed" : "one element per area"})`, () => {
      const result = analyze(cantilever({ divisions: divisions && [...divisions] }));
      const pier = result.cases.L.pierForces[0];
      expect(pier.pierId).toBe("P1");
      expect(pier.axes).toEqual([
        [0, 0, 1],
        [1, 0, 0],
        [0, 1, 0],
      ]);
      expect(pier.cuts.map((c) => [c.z, c.face])).toEqual([
        [0, "bottom"],
        [3000, "top"],
        [3000, "bottom"],
        [6000, "top"],
      ]);
      for (const c of pier.cuts) {
        expectResultants(c, statics(topLoads, c.section.centroid, pier.axes));
      }
      const base = cut(pier.cuts, 0, "bottom");
      expect(base.P).toBeCloseTo(-200, 3);
      expect(base.V2).toBeCloseTo(100, 3);
      expect(base.M3).toBeCloseTo(600, 3);
      expect(cut(pier.cuts, 3000, "top").M3).toBeCloseTo(300, 3);
      expect(base.section).toEqual({
        legs: [
          { areaId: "A0,0", start: [0, 0, 0], end: [3000, 0, 0], length: 3000, thickness: 200 },
        ],
        members: [],
        length: 3000,
        area: 600000,
        centroid: [1500, 0, 0],
      });
    });
  }

  it("gives the top and bottom of a shared level apart by what the level carries", () => {
    const model = cantilever({ divisions: [6, 6] });
    model.nodalLoads!.push({ loadCase: "L", nodeId: "0,3000", fz: -50 });
    const cuts = analyze(model).cases.L.pierForces[0].cuts;
    const top = cut(cuts, 3000, "top");
    const bottom = cut(cuts, 3000, "bottom");
    expect(top.P).toBeCloseTo(-250, 3);
    expect(bottom.P).toBeCloseTo(-200, 3);
    expect(top.M3).toBeCloseTo(300 - 75, 3); // 50 kN at 1.5 m from the centroid
    expect(bottom.M3).toBeCloseTo(300, 3);
  });

  it("includes self-weight through the element loads", () => {
    const model = cantilever({ divisions: [6, 6] });
    model.nodalLoads = [];
    model.loadCases = [{ id: "L", selfWeight: 1 }];
    const cuts = analyze(model).cases.L.pierForces[0].cuts;
    const weight = 24 * 0.2 * 3 * 3; // kN per lift
    expect(cut(cuts, 0, "bottom").P).toBeCloseTo(-2 * weight, 3);
    expect(cut(cuts, 3000, "top").P).toBeCloseTo(-weight, 3); // the lift's own weight is below
    expect(cut(cuts, 3000, "bottom").P).toBeCloseTo(-weight, 3);
    expect(cut(cuts, 6000, "top").P).toBeCloseTo(0, 3);
  });

  it("adds extra cuts on mesh lines, and agrees with a strip over the wall", () => {
    const model = cantilever({ divisions: [6, 6], pier: { cuts: [1500, 3000] } });
    model.strips = [
      {
        id: "S",
        points: [
          { x: 1500, y: 0, z: 0 },
          { x: 1500, y: 0, z: 3000 },
        ],
        widthLeft: 1500,
        widthRight: 1500,
        normal: [0, 1, 0], // strip 3 = +Y, 2 = 3 × 1 = +X: the pier axes
        maxSpacing: 1500,
      },
    ];
    const result = analyze(model).cases.L;
    const cuts = result.pierForces[0].cuts;
    expect(cuts.map((c) => c.face)).toEqual(["bottom", "cut", "top", "bottom", "top"]);
    const extra = cut(cuts, 1500, "cut");
    expectResultants(extra, statics(topLoads, [1500, 0, 1500], result.pierForces[0].axes));
    const station = result.stripForces[0].stations.find((s) => s.x === 1500)!;
    // the strip integrates stresses, so it is close to the exact nodal-force sums, not equal
    // (P −199.82, Vp 100.71, Mp 449.80 against −200, 100, 450 on this 500 mm mesh)
    expect(Math.abs(station.P - extra.P) / Math.abs(extra.P)).toBeLessThan(0.01);
    expect(Math.abs(station.Vp - extra.V2) / Math.abs(extra.V2)).toBeLessThan(0.01);
    expect(Math.abs(station.Mp - extra.M3) / Math.abs(extra.M3)).toBeLessThan(0.01);
  });

  it("turns pier axis 2 by angle", () => {
    const pier = analyze(cantilever({ pier: { angle: Math.PI / 2 } })).cases.L.pierForces[0];
    expect(pier.axes).toEqual([
      [0, 0, 1],
      [0, 1, 0],
      [-1, 0, 0],
    ]);
    const base = cut(pier.cuts, 0, "bottom");
    expect(base.V2).toBeCloseTo(0, 3);
    expect(base.V3).toBeCloseTo(-100, 3);
    expect(base.M2).toBeCloseTo(600, 3);
    expect(base.M3).toBeCloseTo(0, 3);
  });
});

describe("pier forces: non-planar and grouped sections", () => {
  it("sums an L-shaped core under biaxial load and torsion", () => {
    // wall A along X (y = 0) and wall B along Y (x = 0), sharing the corner edge
    const nodes = [
      { id: "o0", x: 0, y: 0, z: 0 },
      { id: "a0", x: 2000, y: 0, z: 0 },
      { id: "b0", x: 0, y: 2000, z: 0 },
      { id: "o1", x: 0, y: 0, z: 3000 },
      { id: "a1", x: 2000, y: 0, z: 3000 },
      { id: "b1", x: 0, y: 2000, z: 3000 },
    ];
    const loads: { at: V3; f: V3 }[] = [
      { at: [2000, 0, 3000], f: [0, 10, -20] },
      { at: [0, 2000, 3000], f: [20, 0, 0] },
      { at: [0, 0, 3000], f: [5, -8, -30] },
    ];
    const ids = ["a1", "b1", "o1"];
    const model: FeaModel = {
      nodes,
      shells: [
        {
          id: "A",
          nodeIds: ["o0", "a0", "a1", "o1"],
          section: concrete,
          mesh: { divisions: [4, 6] },
        },
        {
          id: "B",
          nodeIds: ["b0", "o0", "o1", "b1"],
          section: concrete,
          mesh: { divisions: [4, 6] },
        },
      ],
      restraints: [],
      lineRestraints: [
        { nodeIds: ["o0", "a0"], ...fixed },
        { nodeIds: ["o0", "b0"], ...fixed },
      ],
      loadCases: [{ id: "L" }],
      nodalLoads: loads.map((l, i) => ({
        loadCase: "L",
        nodeId: ids[i],
        fx: l.f[0],
        fy: l.f[1],
        fz: l.f[2],
      })),
      piers: [{ id: "core", areaIds: ["A", "B"], cuts: [1500] }],
    };
    const pier = analyze(model).cases.L.pierForces[0];
    expect(pier.axes[1]).toEqual([1, 0, 0]); // both legs 2 m long: the first wins
    const base = cut(pier.cuts, 0, "bottom");
    expect(base.section.centroid).toEqual([500, 500, 0]);
    expect(base.section.legs.map((l) => l.areaId)).toEqual(["A", "B"]);
    for (const c of pier.cuts) {
      expectResultants(c, statics(loads, c.section.centroid, pier.axes));
    }
    expect(Math.abs(base.T)).toBeGreaterThan(1); // the torsion is really there
  });

  it("sums separate legs about the centroid of the whole cut, as ETABS", () => {
    const loads = [
      { nodeId: "0,3000", fx: 30 },
      { nodeId: "3000,3000", fx: 20, fz: -40 },
    ];
    const opening = { skip: ["A1,0"], divisions: [2, 6] as [number, number], nodalLoads: loads };
    const together = analyze(
      wall([0, 1000, 2000, 3000], [0, 3000], {
        ...opening,
        piers: [{ id: "P", areaIds: ["A0,0", "A2,0"] }],
      }),
    ).cases.L.pierForces[0];
    const apart = analyze(
      wall([0, 1000, 2000, 3000], [0, 3000], {
        ...opening,
        piers: [
          { id: "left", areaIds: ["A0,0"] },
          { id: "right", areaIds: ["A2,0"] },
        ],
      }),
    ).cases.L.pierForces;
    const base = cut(together.cuts, 0, "bottom");
    expect(base.section.centroid).toEqual([1500, 0, 0]);
    expect(base.section.length).toBe(2000);
    // transfer each leg's resultant to the common centroid: M3 (about +Y) gains (x − c) × F
    let P = 0;
    let V2 = 0;
    let M3 = 0;
    for (const leg of apart) {
      const b = cut(leg.cuts, 0, "bottom");
      const dx = (b.section.centroid[0] - 1500) * 1e-3;
      P += b.P;
      V2 += b.V2;
      M3 += b.M3 - dx * b.P; // r × F about Y: rz·Fx − rx·Fz, rz = 0
    }
    expect(base.P).toBeCloseTo(P, 3);
    expect(base.V2).toBeCloseTo(V2, 3);
    expect(base.M3).toBeCloseTo(M3, 3);
    expectResultants(
      base,
      statics(
        [
          { at: [0, 0, 3000], f: [30, 0, 0] },
          { at: [3000, 0, 3000], f: [20, 0, -40] },
        ],
        [1500, 0, 0],
        together.axes,
      ),
    );
  });

  it("includes a boundary column in the forces and in the centroid", () => {
    const loads = [{ nodeId: "3000,3000", fx: 60, fz: -90 }];
    const members: Member[] = [
      { id: "C", startNodeId: "0,0", endNodeId: "0,3000", section: column },
    ];
    const model = wall([0, 3000], [0, 3000], {
      divisions: [6, 6],
      nodalLoads: loads,
      members,
      piers: [{ id: "P", areaIds: ["A0,0"], memberIds: ["C"] }],
    });
    model.restraints = [{ nodeId: "0,0", ...fixed }];
    const result = analyze(model).cases.L;
    const pier = result.pierForces[0];
    const base = cut(pier.cuts, 0, "bottom");
    expect(base.section.members).toEqual([{ memberId: "C", point: [0, 0, 0], A: 160000 }]);
    const area = 3000 * 200 + 160000;
    expect(base.section.area).toBe(area);
    expect(base.section.centroid[0]).toBeCloseTo((3000 * 200 * 1500) / area, 3);
    expectResultants(
      base,
      statics([{ at: [3000, 0, 3000], f: [60, 0, -90] }], base.section.centroid, pier.axes),
    );
    // the column really carries part of it
    expect(Math.abs(result.memberEndForces[0].start.f1)).toBeGreaterThan(1);
  });

  it("gives a column-only pier the column's own internal forces, between nodes too", () => {
    const model: FeaModel = {
      nodes: [
        { id: 1, x: 0, y: 0, z: 0 },
        { id: 2, x: 0, y: 0, z: 3000 },
      ],
      members: [{ id: "C", startNodeId: 1, endNodeId: 2, section: column }],
      restraints: [{ nodeId: 1, ...fixed }],
      loadCases: [{ id: "L" }],
      nodalLoads: [{ loadCase: "L", nodeId: 2, fx: 10, fy: -4, fz: -50, mz: 3 }],
      memberLoads: [{ loadCase: "L", type: "udl", memberId: "C", direction: "X", w: 2 }],
      piers: [{ id: "P", memberIds: ["C"], cuts: [1500] }],
    };
    const result = analyze(model).cases.L;
    const pier = result.pierForces[0];
    expect(pier.cuts.map((c) => [c.z, c.face])).toEqual([
      [0, "bottom"],
      [1500, "cut"],
      [3000, "top"],
    ]);
    const stations = result.memberDiagrams[0].stations;
    for (const [z, face] of [
      [0, "bottom"],
      [1500, "cut"],
      [3000, "top"],
    ] as const) {
      const s = stations.find((st) => st.x === z)!;
      const c = cut(pier.cuts, z, face);
      expectResultants(c, { P: s.N, V2: s.V2, V3: s.V3, T: s.T, M2: s.M2, M3: s.M3 });
    }
    expect(cut(pier.cuts, 1500, "cut").section.members[0].point).toEqual([0, 0, 1500]);
  });
});

describe("spandrel forces", () => {
  /** Two 1 m piers coupled by a 1 m × 0.6 m spandrel over a 2.4 m opening, loaded laterally. */
  const coupled = (spandrel: Partial<WallSpandrel> = {}) =>
    wall([0, 1000, 2000, 3000], [0, 2400, 3000], {
      skip: ["A1,0"],
      divisions: [4, 2],
      nodalLoads: [
        { nodeId: "0,3000", fx: 40 },
        { nodeId: "3000,3000", fx: 40 },
      ],
      spandrels: [{ id: "S", areaIds: ["A1,1"], ...spandrel }],
      piers: [
        { id: "left", areaIds: ["A0,0", "A0,1"] },
        { id: "right", areaIds: ["A2,0", "A2,1"] },
      ],
    });

  it("has beam-like ends: constant shear and V2 = (M3left − M3right) / L", () => {
    const result = analyze(coupled({ cuts: [500] })).cases.L;
    const spandrel = result.spandrelForces[0];
    expect(spandrel.axes).toEqual([
      [1, 0, 0],
      [0, 0, 1],
      [0, -1, 0],
    ]);
    expect(spandrel.length).toBe(1000);
    expect(spandrel.cuts.map((c) => [c.x, c.face])).toEqual([
      [0, "left"],
      [500, "cut"],
      [1000, "right"],
    ]);
    const [left, middle, right] = spandrel.cuts;
    expect(Math.abs(left.V2)).toBeGreaterThan(1);
    expect(right.V2).toBeCloseTo(left.V2, 3);
    expect(middle.V2).toBeCloseTo(left.V2, 3);
    expect(left.V2).toBeCloseTo((left.M3 - right.M3) / 1, 2);
    expect(middle.M3).toBeCloseTo(left.M3 - 0.5 * left.V2, 2);
    // the coupled walls are symmetric: antisymmetric end moments, no moment at mid-span
    expect(right.M3).toBeCloseTo(-left.M3, 1);
    expect(middle.M3).toBeCloseTo(0, 1);
    expect(left.section.legs[0]).toEqual({
      areaId: "A1,1",
      start: [1000, 0, 2400],
      end: [1000, 0, 3000],
      length: 600,
      thickness: 200,
    });
    expect(left.section.centroid).toEqual([1000, 0, 2700]);
  });

  it("swaps the ends with reverse", () => {
    const forward = analyze(coupled()).cases.L.spandrelForces[0];
    const reversed = analyze(coupled({ reverse: true })).cases.L.spandrelForces[0];
    expect(reversed.axes[0]).toEqual([-1, 0, 0]);
    expect(reversed.axes[2]).toEqual([0, 1, 0]);
    // the reversed left end is the forward right end, seen from the other side
    const [fLeft, fRight] = forward.cuts;
    const [rLeft, rRight] = reversed.cuts;
    expect(rLeft.section.centroid).toEqual(fRight.section.centroid);
    expect(rLeft.P).toBeCloseTo(fRight.P, 3);
    expect(rLeft.V2).toBeCloseTo(-fRight.V2, 3);
    expect(rLeft.M3).toBeCloseTo(fRight.M3, 3);
    expect(rRight.M3).toBeCloseTo(fLeft.M3, 3);
  });
});

describe("pier and spandrel forces in combinations", () => {
  it("superposes the cases and envelopes the combinations", () => {
    const model = cantilever({ divisions: [3, 3] });
    model.loadCases = [{ id: "H" }, { id: "G" }];
    model.nodalLoads = [
      { loadCase: "H", nodeId: "0,6000", fx: 50 },
      { loadCase: "H", nodeId: "3000,6000", fx: 50 },
      { loadCase: "G", nodeId: "0,6000", fz: -100 },
      { loadCase: "G", nodeId: "3000,6000", fz: -100 },
    ];
    model.combinations = [
      {
        id: "C1",
        terms: [
          { case: "G", factor: 1.2 },
          { case: "H", factor: 1.6 },
        ],
      },
      {
        id: "C2",
        terms: [
          { case: "G", factor: 0.9 },
          { case: "H", factor: -1.6 },
        ],
      },
    ];
    const result = analyze(model);
    const at = (id: string) =>
      cut((result.cases[id] ?? result.combinations[id]).pierForces[0].cuts, 0, "bottom");
    expect(at("C1").M3).toBeCloseTo(1.6 * at("H").M3, 3);
    expect(at("C1").P).toBeCloseTo(1.2 * at("G").P, 3);
    const envelope = result.envelope!.piers[0].cuts[0];
    expect(envelope.z).toBe(0);
    expect(envelope.face).toBe("bottom");
    expect(envelope.M3.max).toEqual({ value: at("C1").M3, combinationId: "C1" });
    expect(envelope.M3.min).toEqual({ value: at("C2").M3, combinationId: "C2" });
    expect(result.envelope!.spandrels).toEqual([]);
  });
});

describe("pier and spandrel validation (331)", () => {
  const codes = (model: FeaModel) => validateModel(model).map((i) => [i.code, i.details]);

  it("accepts a valid model, and returns empty results without piers", () => {
    expect(validateModel(cantilever({ divisions: [6, 6] }))).toEqual([]);
    const result = analyze(
      wall([0, 1000], [0, 1000], { nodalLoads: [{ nodeId: "0,1000", fx: 1 }] }),
    );
    expect(result.cases.L.pierForces).toEqual([]);
    expect(result.cases.L.spandrelForces).toEqual([]);
  });

  it("rejects bad references and assignments", () => {
    const model = cantilever();
    model.piers = [
      { id: "P1", areaIds: ["A0,0", "nope"] },
      { id: "P2", areaIds: ["A0,0"] },
      { id: "P3" },
      { id: "P3", areaIds: ["A0,1", "A0,1"] },
    ];
    model.spandrels = [{ id: "S", areaIds: [] }];
    expect(codes(model)).toEqual([
      [303, { pierId: "P3", field: "id" }],
      [331, { pierId: "P1", areaId: "nope", field: "areaIds" }],
      [331, { pierId: "P2", areaId: "A0,0", field: "areaIds" }],
      [331, { pierId: "P3", field: "areaIds" }],
      [331, { pierId: "P3", areaId: "A0,1", field: "areaIds" }],
      [331, { spandrelId: "S", field: "areaIds" }],
    ]);
    // an area may be in one pier and one spandrel
    const both = cantilever();
    both.spandrels = [{ id: "S", areaIds: ["A0,1"] }];
    expect(validateModel(both)).toEqual([]);
  });

  it("rejects invalid values (314)", () => {
    const model = cantilever({ pier: { cuts: [NaN], angle: Infinity } });
    model.spandrels = [{ id: "S", areaIds: ["A0,1"], reverse: "yes" as unknown as boolean }];
    expect(codes(model)).toEqual([
      [314, { pierId: "P1", field: "cuts[0]" }],
      [314, { pierId: "P1", field: "angle" }],
      [314, { spandrelId: "S", field: "reverse" }],
    ]);
    const notArray = cantilever();
    notArray.piers = {} as unknown as WallPier[];
    expect(codes(notArray)).toEqual([[314, { field: "piers" }]]);
  });

  it("rejects a horizontal pier area or member, and a spandrel out of one plane", () => {
    const model = cantilever();
    model.nodes.push({ id: "f1", x: 0, y: 3000, z: 3000 }, { id: "f2", x: 3000, y: 3000, z: 3000 });
    model.shells!.push({
      id: "floor",
      nodeIds: ["0,3000", "3000,3000", "f2", "f1"],
      section: concrete,
    });
    model.members = [
      { id: "beam", startNodeId: "0,3000", endNodeId: "3000,3000", section: column },
      { id: "post", startNodeId: "0,0", endNodeId: "0,3000", section: column },
    ];
    model.piers = [{ id: "P1", areaIds: ["A0,0", "floor"], memberIds: ["beam"] }];
    model.spandrels = [
      { id: "S1", areaIds: ["A0,0", "floor"] },
      { id: "S2", areaIds: ["A0,1"], memberIds: ["post"] },
    ];
    expect(codes(model)).toEqual([
      [331, { pierId: "P1", areaId: "floor", field: "areaIds" }],
      [331, { pierId: "P1", memberId: "beam", field: "memberIds" }],
      [331, { spandrelId: "S1", areaId: "floor", field: "areaIds" }],
      [331, { spandrelId: "S2", memberId: "post", field: "memberIds" }],
    ]);
  });

  it("rejects cuts off the group or off the mesh lines, and staggered lifts", () => {
    const model = cantilever({ divisions: [6, 6], pier: { cuts: [7000, 1250] } });
    model.spandrels = [{ id: "S", areaIds: ["A0,1"], cuts: [-10] }];
    expect(codes(model)).toEqual([
      [331, { pierId: "P1", field: "cuts[0]", position: 7000 }],
      [331, { spandrelId: "S", field: "cuts[0]", position: -10 }],
    ]);
    model.piers![0].cuts = [1250];
    model.spandrels = [];
    expect(codes(model)).toEqual([
      [331, { pierId: "P1", areaId: "A0,0", field: "cuts[0]", position: 1250 }],
    ]);
    // leg A breaks at 3000, leg B at 3200: B's lower area has no mesh line at 3000
    const staggered: FeaModel = {
      ...wall([0, 1000], [0, 3000, 6000]),
      piers: [{ id: "P", areaIds: ["A0,0", "A0,1", "B0", "B1"] }],
    };
    staggered.nodes.push(
      { id: "b00", x: 2000, y: 0, z: 0 },
      { id: "b10", x: 3000, y: 0, z: 0 },
      { id: "b01", x: 2000, y: 0, z: 3200 },
      { id: "b11", x: 3000, y: 0, z: 3200 },
      { id: "b02", x: 2000, y: 0, z: 6000 },
      { id: "b12", x: 3000, y: 0, z: 6000 },
    );
    staggered.shells!.push(
      { id: "B0", nodeIds: ["b00", "b10", "b11", "b01"], section: concrete },
      { id: "B1", nodeIds: ["b01", "b11", "b12", "b02"], section: concrete },
    );
    expect(codes(staggered)).toEqual([
      [331, { pierId: "P", areaId: "B0", field: "areaIds", position: 3000 }],
      [331, { pierId: "P", areaId: "A0,1", field: "areaIds", position: 3200 }],
    ]);
    expect(() => analyze(staggered)).toThrow(FeaError);
  });
});
