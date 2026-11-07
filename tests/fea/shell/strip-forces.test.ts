import { FeaError } from "@app-core/errors/fea.error";
import { analyze } from "@app-fea/analysis/solver/analyze";
import type { FeaModel, NodalLoad } from "@app-fea/analysis/types/model.type";
import { validateModel } from "@app-fea/analysis/validation/validate-model";
import { clipToQuad, inverseBilinear } from "@app-fea/shell/post/strip-forces";
import type { ShellSection, ShellStrip } from "@app-fea/shell/types/model.type";

const concrete: ShellSection = { thickness: 200, E: 30000, nu: 0.2 };
const all = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

/**
 * One L × B slab (mm) at z = 0, meshed nx × ny. `clockwise` lists its corners clockwise seen
 * from above, so its local 3 points down.
 */
const slab = (
  L: number,
  B: number,
  nx: number,
  ny: number,
  options: {
    supports: "simple" | "cantilever";
    q?: number;
    nodalLoads?: Omit<NodalLoad, "loadCase">[];
    strips?: ShellStrip[];
    clockwise?: boolean;
  },
): FeaModel => {
  const corners = [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: L, y: 0, z: 0 },
    { id: 3, x: L, y: B, z: 0 },
    { id: 4, x: 0, y: B, z: 0 },
  ];
  return {
    nodes: corners,
    restraints: [],
    lineRestraints:
      options.supports === "simple"
        ? [
            { nodeIds: [1, 4], ux: true, uy: true, uz: true },
            { nodeIds: [2, 3], uy: true, uz: true },
          ]
        : [{ nodeIds: [1, 4], ...all }],
    shells: [
      {
        id: "S",
        nodeIds: options.clockwise ? [1, 4, 3, 2] : [1, 2, 3, 4],
        section: concrete,
        mesh: { divisions: options.clockwise ? [ny, nx] : [nx, ny] },
      },
    ],
    loadCases: [{ id: "L" }],
    areaLoads: options.q ? [{ loadCase: "L", areaId: "S", direction: "Z", q: -options.q }] : [],
    nodalLoads: (options.nodalLoads ?? []).map((load) => ({ ...load, loadCase: "L" })),
    strips: options.strips,
  };
};

/** A strip along X over the whole 2 m width of the slab, centred on y = 1000. */
const fullWidth = (L: number, extra: Partial<ShellStrip> = {}): ShellStrip => ({
  id: "X",
  points: [
    { x: 0, y: 1000, z: 0 },
    { x: L, y: 1000, z: 0 },
  ],
  widthLeft: 1000,
  widthRight: 1000,
  maxSpacing: 750,
  ...extra,
});

const station = (model: FeaModel, x: number, stripId: string | number = "X") => {
  const result = analyze(model);
  const strip = result.cases.L.stripForces.find((s) => s.stripId === stripId)!;
  return strip.stations.find((s) => Math.abs(s.x - x) < 1e-6)!;
};

describe("strip geometry helpers", () => {
  it("inverts the bilinear map of a distorted quad", () => {
    const corners: [number, number][] = [
      [0, 0],
      [1000, 100],
      [1200, 900],
      [-100, 800],
    ];
    const [xi, eta] = [0.3, -0.6];
    const N = [
      (1 - xi) * (1 - eta),
      (1 + xi) * (1 - eta),
      (1 + xi) * (1 + eta),
      (1 - xi) * (1 + eta),
    ].map((v) => v / 4);
    const x = N.reduce((s, n, i) => s + n * corners[i][0], 0);
    const y = N.reduce((s, n, i) => s + n * corners[i][1], 0);
    const [a, b] = inverseBilinear(corners, x, y);
    expect(a).toBeCloseTo(xi, 10);
    expect(b).toBeCloseTo(eta, 10);
  });

  it("clips a cut to a quad, and keeps a cut lying along an edge", () => {
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(clipToQuad(square, [0.5, -1], [0, 1], 0, 5, 1e-9)).toEqual([1, 2]);
    expect(clipToQuad(square, [0, -1], [0, 1], 0, 5, 1e-9)).toEqual([1, 2]);
    expect(clipToQuad(square, [2, -1], [0, 1], 0, 5, 1e-9)).toBeNull();
  });
});

describe("strip forces of a simply supported one-way slab", () => {
  // L = 6 m span, B = 2 m, q = 10 kN/m²: M = q·B·L²/8 = 90 kN·m, R = q·B·L/2 = 60 kN
  const model = slab(6000, 2000, 12, 4, { supports: "simple", q: 10, strips: [fullWidth(6000)] });

  it("gives the statical moment at midspan, sagging positive, and per-width values", () => {
    const mid = station(model, 3000);
    expect(mid.width).toBeCloseTo(2000, 6);
    expect(mid.M).toBeCloseTo(90, 0);
    expect(mid.perWidth.M).toBeCloseTo(45, 0);
    expect(Math.abs(mid.V)).toBeLessThan(0.5);
    expect(Math.abs(mid.T)).toBeLessThan(0.5);
    expect(Math.abs(mid.P)).toBeLessThan(1e-6);
  });

  it("gives V = −dM/dx: −30 kN at quarter span", () => {
    const quarter = station(model, 1500);
    expect(quarter.V).toBeCloseTo(-30, 3);
    expect(quarter.M).toBeCloseTo(60 * 1.5 - (10 * 2 * 1.5 ** 2) / 2, 0); // 67.5 kN·m
  });

  it("keeps M when the strip runs the other way, and flips V", () => {
    const reversed = fullWidth(6000, {
      points: [
        { x: 6000, y: 1000, z: 0 },
        { x: 0, y: 1000, z: 0 },
      ],
    });
    const back = station(
      slab(6000, 2000, 12, 4, { supports: "simple", q: 10, strips: [reversed] }),
      4500,
    );
    const ahead = station(model, 1500);
    expect(back.M).toBeCloseTo(ahead.M, 6);
    expect(back.V).toBeCloseTo(-ahead.V, 6);
  });

  it("keeps the signs when the shells' local 3 points down", () => {
    const flipped = slab(6000, 2000, 12, 4, {
      supports: "simple",
      q: 10,
      strips: [fullWidth(6000)],
      clockwise: true,
    });
    const mid = station(flipped, 3000);
    const quarter = station(flipped, 1500);
    expect(mid.M).toBeCloseTo(90, 0);
    expect(quarter.V).toBeCloseTo(-30, 3);
  });

  it("does not depend on the shells' local axes (angle)", () => {
    const rotated = slab(6000, 2000, 12, 4, {
      supports: "simple",
      q: 10,
      strips: [fullWidth(6000)],
    });
    rotated.shells![0].angle = Math.PI / 6;
    const a = station(rotated, 1500);
    const b = station(model, 1500);
    expect(a.M).toBeCloseTo(b.M, 3);
    expect(a.V).toBeCloseTo(b.V, 3);
    expect(a.T).toBeCloseTo(b.T, 3);
  });

  it("splits into two half strips whose P, V and M add up", () => {
    const left = fullWidth(6000, { id: "left", widthRight: 0 });
    const right = fullWidth(6000, { id: "right", widthLeft: 0 });
    const halves = slab(6000, 2000, 12, 4, { supports: "simple", q: 10, strips: [left, right] });
    const result = analyze(halves);
    const [l, r] = result.cases.L.stripForces.map((s) => s.stations.find((st) => st.x === 1500)!);
    const whole = station(model, 1500);
    expect(l.M + r.M).toBeCloseTo(whole.M, 3);
    expect(l.V + r.V).toBeCloseTo(whole.V, 3);
    expect(l.width).toBeCloseTo(1000, 6);
  });

  it("returns nothing new to the rest of the result", () => {
    const without = analyze({ ...model, strips: undefined });
    const withStrips = analyze(model);
    expect(withStrips.cases.L.shellForces).toEqual(without.cases.L.shellForces);
    expect(without.cases.L.stripForces).toEqual([]);
  });
});

describe("strip forces of a cantilever slab", () => {
  // 3 m long, 2 m wide, fixed along x = 0; cut at x = 1.5 m over the whole width
  it("balances an out-of-plane corner load: V, M and T", () => {
    const model = slab(3000, 2000, 12, 8, {
      supports: "cantilever",
      nodalLoads: [{ nodeId: 3, fz: -10 }], // at (3000, 2000)
      strips: [fullWidth(3000)],
    });
    const cut = station(model, 1500);
    expect(cut.V).toBeCloseTo(-10, 2);
    expect(cut.M / -15).toBeCloseTo(1, 2); // hogging 10 kN × 1.5 m
    expect(cut.T / -10).toBeCloseTo(1, 2); // −10 kN × 1 m lever about the centreline
  });

  it("gives T = 2·∫m for a strip in pure twist", () => {
    // equal and opposite corner loads at the free end: a torque of 10 kN × 2 m = 20 kN·m
    const model = slab(3000, 2000, 12, 8, {
      supports: "cantilever",
      nodalLoads: [
        { nodeId: 2, fz: 10 },
        { nodeId: 3, fz: -10 },
      ],
      strips: [fullWidth(3000)],
    });
    const cut = station(model, 1500);
    expect(Math.abs(cut.V)).toBeLessThan(1e-3);
    expect(cut.T / -20).toBeCloseTo(1, 2);
  });

  it("balances an in-plane corner load: P, Vp and Mp", () => {
    const model = slab(3000, 2000, 12, 8, {
      supports: "cantilever",
      nodalLoads: [{ nodeId: 3, fx: 10, fy: 5 }],
      strips: [fullWidth(3000)],
    });
    const cut = station(model, 1500);
    // the membrane field is not exactly in equilibrium on a cut: within 1 %
    expect(cut.P / 10).toBeCloseTo(1, 2);
    expect(cut.Vp / 5).toBeCloseTo(1, 2);
    expect(cut.Mp / (1.5 * 5 - 1 * 10)).toBeCloseTo(1, 2); // −2.5 kN·m
    expect(Math.abs(cut.M)).toBeLessThan(1e-6);
  });
});

describe("strip stations, coverage and envelope", () => {
  it("places stations by maxSpacing and doubles them at a bend", () => {
    const bent: ShellStrip = {
      id: "B",
      points: [
        { x: 0, y: 1000, z: 0 },
        { x: 2000, y: 1000, z: 0 },
        { x: 2000, y: 0, z: 0 },
      ],
      widthLeft: 200,
      widthRight: 200,
      maxSpacing: 600,
    };
    const result = analyze(
      slab(3000, 2000, 6, 4, { supports: "cantilever", q: 5, strips: [bent] }),
    );
    const stations = result.cases.L.stripForces[0].stations;
    // 2000/600 → 4 divisions, 1000/600 → 2 divisions
    expect(stations.map((s) => s.x)).toEqual([0, 500, 1000, 1500, 2000, 2000, 2500, 3000]);
    expect(stations.map((s) => s.segment)).toEqual([0, 0, 0, 0, 0, 1, 1, 1]);
    expect(stations[6].point).toEqual([2000, 500, 0]);
  });

  it("uses 21 stations per segment by default", () => {
    const result = analyze(
      slab(3000, 2000, 6, 4, {
        supports: "cantilever",
        q: 5,
        strips: [{ ...fullWidth(3000), maxSpacing: undefined }],
      }),
    );
    expect(result.cases.L.stripForces[0].stations).toHaveLength(21);
  });

  it("integrates only the covered part of a strip wider than the slab, with a warning", () => {
    const wide = fullWidth(6000, { widthLeft: 1500, widthRight: 1500 });
    const narrow = slab(6000, 2000, 12, 4, { supports: "simple", q: 10, strips: [wide] });
    const result = analyze(narrow);
    const mid = result.cases.L.stripForces[0].stations.find((s) => s.x === 3000)!;
    expect(mid.width).toBeCloseTo(2000, 6);
    expect(mid.M).toBeCloseTo(90, 0);
    expect(mid.perWidth.M).toBeCloseTo(45, 0);
    expect(result.warnings.some((w) => w.message.includes('Strip "X"'))).toBe(true);
  });

  it("ignores shells off the strip's plane", () => {
    const off = fullWidth(6000, {
      points: [
        { x: 0, y: 1000, z: 500 },
        { x: 6000, y: 1000, z: 500 },
      ],
    });
    const result = analyze(slab(6000, 2000, 12, 4, { supports: "simple", q: 10, strips: [off] }));
    expect(result.cases.L.stripForces[0].stations.every((s) => s.width === 0 && s.M === 0)).toBe(
      true,
    );
    expect(result.warnings.some((w) => w.message.includes("crosses no shell"))).toBe(true);
  });

  it("superposes combinations and envelopes them per station", () => {
    const model: FeaModel = {
      ...slab(6000, 2000, 12, 4, { supports: "simple", q: 10, strips: [fullWidth(6000)] }),
      combinations: [
        { id: "U", terms: [{ case: "L", factor: 1.4 }] },
        { id: "R", terms: [{ case: "L", factor: -0.5 }] },
      ],
    };
    const result = analyze(model);
    const caseMid = result.cases.L.stripForces[0].stations.find((s) => s.x === 3000)!;
    const comboMid = result.combinations.U.stripForces[0].stations.find((s) => s.x === 3000)!;
    expect(comboMid.M).toBeCloseTo(1.4 * caseMid.M, 3);
    const envelope = result.envelope!.strips[0];
    const at = envelope.stations.find((s) => s.x === 3000)!;
    expect(at.M.max.combinationId).toBe("U");
    expect(at.M.min.combinationId).toBe("R");
    expect(at.perWidth.M.max.value).toBeCloseTo(1.4 * caseMid.perWidth.M, 3);
    expect(envelope.extremes.M.max.x).toBe(3000);
  });
});

describe("strip validation", () => {
  const base = slab(6000, 2000, 2, 1, { supports: "simple", q: 10 });
  const issues = (strips: unknown[]) =>
    validateModel({ ...base, strips: strips as ShellStrip[] }).map((i) => ({
      code: i.code,
      ...i.details,
    }));

  it("reports bad strips with their id and field", () => {
    expect(
      issues([
        { id: "a", points: [{ x: 0, y: 0, z: 0 }], widthLeft: 100, widthRight: 100 },
        { ...fullWidth(6000), id: "b", widthLeft: -1 },
        { ...fullWidth(6000), id: "c", widthLeft: 0, widthRight: 0 },
        { ...fullWidth(6000), id: "d", normal: [0, 0, 0] },
        { ...fullWidth(6000), id: "e", maxSpacing: 0 },
        {
          ...fullWidth(6000),
          id: "f",
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: NaN },
          ],
        },
        {
          ...fullWidth(6000),
          id: "g",
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 1000, y: 0, z: 100 },
          ],
        },
        {
          ...fullWidth(6000),
          id: "h",
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 1000, y: 0, z: 0 },
            { x: 500, y: 0, z: 0 },
          ],
        },
        fullWidth(6000),
        fullWidth(6000),
      ]),
    ).toEqual([
      { code: 303, stripId: "X", field: "id" },
      { code: 330, stripId: "a", field: "points" },
      { code: 330, stripId: "b", field: "widthLeft" },
      { code: 330, stripId: "c", field: "widthLeft" },
      { code: 330, stripId: "d", field: "normal" },
      { code: 314, stripId: "e", field: "maxSpacing" },
      { code: 314, stripId: "f", field: "points[1].z" },
      { code: 330, stripId: "g", field: "points" },
      { code: 330, stripId: "h", field: "points" },
    ]);
  });

  it("throws FeaError 330 from analyze", () => {
    expect(() =>
      analyze({ ...base, strips: [{ ...fullWidth(6000), widthLeft: -5 }] }),
    ).toThrowError(FeaError);
  });
});

describe("strip shear recovered from the element centres", () => {
  const q = 5; // kN/m²
  const spans = [0, 6000, 12000, 18000];
  const rows = [0, 5000, 10000];
  const id = (x: number, y: number) => `${x},${y}`;

  /** A 18 × 10 m slab of six panels on point supports at their corners, meshed `maxSize`. */
  const flatPlate = (maxSize: number, strips: ShellStrip[], extra: Partial<FeaModel> = {}) => {
    const nodes = spans.flatMap((x) => rows.map((y) => ({ id: id(x, y), x, y, z: 0 })));
    const shells = [0, 1, 2].flatMap((i) =>
      [0, 1].map((j) => ({
        id: `S${i}${j}`,
        section: concrete,
        mesh: { maxSize },
        nodeIds: [
          id(spans[i], rows[j]),
          id(spans[i + 1], rows[j]),
          id(spans[i + 1], rows[j + 1]),
          id(spans[i], rows[j + 1]),
        ],
      })),
    );
    const model: FeaModel = {
      nodes,
      restraints: nodes.map((n, k) => ({
        nodeId: n.id,
        ux: true,
        uy: true,
        uz: true,
        ...(k === 0 ? { rz: true } : {}),
      })),
      shells,
      loadCases: [{ id: "L" }, { id: "L2" }],
      areaLoads: shells.flatMap((s) => [
        { loadCase: "L", areaId: s.id, direction: "Z" as const, q: -q },
        { loadCase: "L2", areaId: s.id, direction: "Z" as const, q: -2 * q },
      ]),
      strips,
      ...extra,
    };
    return model;
  };

  /** The whole width, with a point at each column so stations fall on them. */
  const wholeWidth: ShellStrip = {
    id: "T",
    points: spans.map((x) => ({ x, y: 5000, z: 0 })),
    widthLeft: 5000,
    widthRight: 5000,
    maxSpacing: 250,
  };

  const forces = (model: FeaModel, loadCase = "L") => analyze(model).cases[loadCase];

  /** Reactions of the column line at `x`, kN up. */
  const columnLine = (model: FeaModel, x: number): number =>
    forces(model)
      .reactions.filter((r) => String(r.nodeId).startsWith(`${x},`))
      .reduce((sum, r) => sum + r.fz, 0);

  it("reaches the statical shear at a support, not the value half an element in", () => {
    const model = slab(6000, 2000, 12, 4, { supports: "simple", q: 10, strips: [fullWidth(6000)] });
    const { stations } = forces(model).stripForces[0];

    expect(stations[0].V).toBeCloseTo(-60, 3); // −q·B·L/2
    expect(stations[stations.length - 1].V).toBeCloseTo(60, 3);
  });

  it("gives each side of a column the shear statics says, however coarse the mesh", () => {
    for (const maxSize of [1000, 500]) {
      const model = flatPlate(maxSize, [wholeWidth]);
      const { stations } = forces(model).stripForces[0];
      const [left, right] = stations.filter((s) => s.x === 6000);
      const edge = columnLine(model, 0);
      const column = columnLine(model, 6000);
      const load = q * 10 * 6; // kN on the slab left of the column line

      expect(left.segment).toBe(0);
      expect(right.segment).toBe(1);
      expect(left.V).toBeCloseTo(load - edge, 1);
      expect(right.V).toBeCloseTo(load - edge - column, 1);
    }
  });

  it("jumps at the column by what the column line takes", () => {
    const model = flatPlate(1000, [wholeWidth]);
    const [left, right] = forces(model).stripForces[0].stations.filter((s) => s.x === 6000);

    expect(left.V - right.V).toBeCloseTo(columnLine(model, 6000), 1);
  });

  it("is a straight line along a span under a uniform load, with no steps", () => {
    const model = flatPlate(1000, [wholeWidth]);
    const span = forces(model).stripForces[0].stations.filter((s) => s.segment === 1);
    const slopes = span.slice(1).map((s, i) => (s.V - span[i].V) / (s.x - span[i].x));

    // V = −dM/dx rises at q·B along the span: 5 kN/m² × 10 m per metre
    for (const slope of slopes) expect(slope).toBeCloseTo((q * 10) / 1000, 4);
  });

  it("takes the mean of the two sides at a station on a column inside a segment", () => {
    const straight: ShellStrip = {
      ...wholeWidth,
      points: [spans[0], spans[3]].map((x) => ({ x, y: 5000, z: 0 })),
    };
    const model = flatPlate(1000, [straight]);
    const station = forces(model).stripForces[0].stations.find((s) => s.x === 6000);
    const [left, right] = forces(flatPlate(1000, [wholeWidth])).stripForces[0].stations.filter(
      (s) => s.x === 6000,
    );

    expect(station?.V).toBeCloseTo((left.V + right.V) / 2, 3);
  });

  it("does not change M, which needs no recovery", () => {
    const model = flatPlate(1000, [wholeWidth]);
    const [left, right] = forces(model).stripForces[0].stations.filter((s) => s.x === 6000);

    expect(left.M).toBeCloseTo(right.M, 6);
  });

  it("stays linear in the loads, so a load twice as large gives twice the shear", () => {
    const model = flatPlate(1000, [wholeWidth], {
      combinations: [
        {
          id: "U",
          terms: [
            { case: "L", factor: 1.2 },
            { case: "L2", factor: 1.6 },
          ],
        },
      ],
    });
    const result = analyze(model);
    const one = result.cases["L"].stripForces[0].stations;
    const two = result.cases["L2"].stripForces[0].stations;
    const combined = result.combinations?.["U"].stripForces[0].stations ?? [];

    one.forEach((station, i) => {
      expect(two[i].V).toBeCloseTo(2 * station.V, 2);
      expect(combined[i].V).toBeCloseTo(1.2 * station.V + 1.6 * two[i].V, 2);
    });
  });

  it("flips with the way the strip runs", () => {
    const reversed: ShellStrip = { ...wholeWidth, points: [...wholeWidth.points].reverse() };
    const forward = forces(flatPlate(1000, [wholeWidth])).stripForces[0].stations;
    const backward = forces(flatPlate(1000, [reversed])).stripForces[0].stations;
    const at = (list: typeof forward, x: number) => list.find((s) => s.x === x)?.V ?? NaN;

    expect(at(backward, 9000)).toBeCloseTo(-at(forward, 9000), 3);
  });

  it("does not take a beam along the strip for a jump at every node", () => {
    const beam = {
      id: "B",
      startNodeId: id(0, 5000),
      endNodeId: id(18000, 5000),
      section: { E: 30000, G: 12500, A: 120000, I22: 4e8, I33: 3.6e9, J: 1e9 },
    };
    const model = flatPlate(1000, [wholeWidth], { members: [beam] });
    const span = forces(model).stripForces[0].stations.filter((s) => s.segment === 1);
    const steps = span.slice(1).map((s, i) => s.V - span[i].V);

    // Steps would show as runs of no change at all, then a jump.
    expect(steps.filter((step) => Math.abs(step) < 1e-3).length).toBeLessThan(steps.length / 4);
  });

  it("does not interpolate across a change in what the cut covers", () => {
    // Two panels side by side in x, the second half as wide: a strip over both changes width.
    const nodes = [
      { id: 1, x: 0, y: 0, z: 0 },
      { id: 2, x: 3000, y: 0, z: 0 },
      { id: 3, x: 6000, y: 0, z: 0 },
      { id: 4, x: 0, y: 2000, z: 0 },
      { id: 5, x: 3000, y: 2000, z: 0 },
      { id: 6, x: 3000, y: 1000, z: 0 },
      { id: 7, x: 6000, y: 1000, z: 0 },
    ];
    const model: FeaModel = {
      nodes,
      restraints: [],
      lineRestraints: [{ nodeIds: [1, 4], ...all }],
      shells: [
        { id: "A", nodeIds: [1, 2, 5, 4], section: concrete, mesh: { maxSize: 500 } },
        { id: "B", nodeIds: [2, 3, 7, 6], section: concrete, mesh: { maxSize: 500 } },
      ],
      loadCases: [{ id: "L" }],
      areaLoads: ["A", "B"].map((areaId) => ({
        loadCase: "L",
        areaId,
        direction: "Z" as const,
        q: -10,
      })),
      strips: [
        {
          id: "T",
          points: [
            { x: 0, y: 1000, z: 0 },
            { x: 6000, y: 1000, z: 0 },
          ],
          widthLeft: 1000,
          widthRight: 1000,
          maxSpacing: 250,
        },
      ],
    };
    const { stations } = analyze(model).cases["L"].stripForces[0];
    const narrow = stations.find((s) => s.x === 4500);

    // The narrow panel is a free cantilever: 10 kN/m² × 1 m × 1.5 m beyond the cut.
    expect(Math.abs(narrow?.V ?? 0)).toBeCloseTo(15, 0);
  });
});
