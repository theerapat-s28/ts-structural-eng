import { analyze } from "@app-fea/analysis/solver/analyze";
import type { FeaModel } from "@app-fea/analysis/types/model.type";
import type { FeaNode, Restraint } from "@app-fea/shared/types/model.type";
import type { ShellArea, ShellSection } from "@app-fea/shell/types/model.type";
import type { FeaResult } from "@app-fea/analysis/types/results.type";
import type { ShellCornerForces } from "@app-fea/shell/types/results.type";

const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

/** An n₁ × n₂ grid of shell elements; `at(i, j)` gives node (i, j) in mm. */
const grid = (
  n1: number,
  n2: number,
  at: (i: number, j: number) => [number, number, number],
  section: ShellSection,
  extra: Partial<ShellArea> = {},
) => {
  const id = (i: number, j: number) => `n${i}_${j}`;
  const nodes: FeaNode[] = [];
  for (let j = 0; j <= n2; j++) {
    for (let i = 0; i <= n1; i++) {
      const [x, y, z] = at(i, j);
      nodes.push({ id: id(i, j), x, y, z });
    }
  }
  const shells: ShellArea[] = [];
  for (let j = 0; j < n2; j++) {
    for (let i = 0; i < n1; i++) {
      shells.push({
        id: `s${i}_${j}`,
        nodeIds: [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
        section,
        ...extra,
      });
    }
  }
  return { id, nodes, shells };
};

/**
 * A 6 m × 1 m strip along +X in the XY plane (local 1 = +X, 3 = +Z), clamped at x = 0, six
 * 1 m elements, ν = 0 so it bends like a beam. Loads at the tip: "P" −10 kN along Z, "M" +10
 * kN·m about +Y, "T" +100 kN along X.
 */
const strip = (extra: Partial<ShellArea> = {}): FeaModel => {
  const { id, nodes, shells } = grid(
    6,
    1,
    (i, j) => [1000 * i, 1000 * j, 0],
    { thickness: 200, E: 30000, nu: 0 },
    extra,
  );
  const tip = [id(6, 0), id(6, 1)];
  return {
    nodes,
    members: [],
    restraints: [0, 1].map((j) => ({ nodeId: id(0, j), ...fixed })),
    shells,
    loadCases: [{ id: "P" }, { id: "M" }, { id: "T" }],
    nodalLoads: tip.flatMap((nodeId) => [
      { loadCase: "P", nodeId, fz: -5 },
      { loadCase: "M", nodeId, my: 5 },
      { loadCase: "T", nodeId, fx: 50 },
    ]),
  };
};

const cornersOf = (r: FeaResult, id: string): ShellCornerForces[] =>
  r.cases[id].shellForces.flatMap((s) => s.corners);
const xOf = (nodeId: unknown) => Number(String(nodeId).slice(1).split("_")[0]) * 1000;

describe("shell forces: cantilever strip (statically determinate)", () => {
  const r = analyze(strip());

  it("tip load: M11 = −P(L − x)/b (hogging), V13 = −P/b, top face in tension", () => {
    for (const c of cornersOf(r, "P")) {
      expect(c.M11).toBeCloseTo((-10 * (6000 - xOf(c.nodeId))) / 1000, 6); // kN·m/m
      expect(c.V13).toBeCloseTo(-10, 6); // kN/m
      expect(c.F11).toBeCloseTo(0, 6);
      expect(c.M22).toBeCloseTo(0, 6);
      // σ = ∓6M/t²: 60 kN·m/m at the root gives 9 MPa
      expect(c.S11Top).toBeCloseTo((-6 * c.M11 * 1e3) / 200 ** 2, 3);
      expect(c.S11Bot).toBeCloseTo(-c.S11Top, 6);
    }
    expect(cornersOf(r, "P")[0].S11Top).toBeCloseTo(9, 6);
  });

  it("tip moment about +Y: uniform M11 = −10 kN·m/m and no shear", () => {
    for (const c of cornersOf(r, "M")) {
      expect(c.M11).toBeCloseTo(-10, 6);
      expect(c.V13).toBeCloseTo(0, 6);
    }
  });

  it("axial pull: uniform F11 = 100 kN/m, 0.5 MPa on both faces", () => {
    for (const c of cornersOf(r, "T")) {
      expect(c.F11).toBeCloseTo(100, 6);
      expect(c.S11Top).toBeCloseTo(0.5, 6);
      expect(c.S11Bot).toBeCloseTo(0.5, 6);
      expect(c.M11).toBeCloseTo(0, 6);
    }
  });

  it("reports forces in local axes: angle 90° turns M11 into M22", () => {
    const turned = analyze(strip({ angle: Math.PI / 2 }));
    cornersOf(turned, "P").forEach((c, k) => {
      expect(c.M22).toBeCloseTo(cornersOf(r, "P")[k].M11, 6);
      expect(c.M11).toBeCloseTo(0, 6);
    });
  });

  it("keeps the forces of a determinate structure under cracked modifiers", () => {
    const cracked = analyze(strip({ modifiers: { m11: 0.25, m22: 0.25, m12: 0.25 } }));
    cornersOf(cracked, "P").forEach((c, k) => {
      expect(c.M11).toBeCloseTo(cornersOf(r, "P")[k].M11, 6);
    });
  });

  it("reports no bending in membranes and no membrane force in plates", () => {
    const membrane = strip({ type: "membrane" });
    // a moment about a membrane's held rotation has no load path (304): keep the axial case
    membrane.loadCases = [{ id: "T" }];
    membrane.nodalLoads = membrane.nodalLoads!.filter((l) => l.loadCase === "T");
    // hold the free nodes out of plane (the root is already clamped)
    const free = (m: FeaModel) => m.nodes.filter((n) => n.x > 0);
    membrane.restraints.push(...free(membrane).map((n): Restraint => ({ nodeId: n.id, uz: true })));
    for (const c of cornersOf(analyze(membrane), "T")) {
      expect(c.F11).toBeCloseTo(100, 6);
      expect([c.M11, c.M22, c.M12, c.V13, c.V23]).toEqual([0, 0, 0, 0, 0]);
    }
    const plate = strip({ type: "plate" });
    plate.restraints.push(
      ...free(plate).map((n): Restraint => ({ nodeId: n.id, ux: true, uy: true })),
    );
    for (const c of cornersOf(analyze(plate), "P")) {
      expect([c.F11, c.F22, c.F12]).toEqual([0, 0, 0]);
    }
  });
});

describe("shell forces: square plate 6 × 6 m, ν = 0.3, 16 × 16 (Timoshenko & Woinowsky-Krieger)", () => {
  const plate = (clamped: boolean) => {
    const n = 16;
    const { id, nodes, shells } = grid(
      n,
      n,
      (i, j) => [375 * i, 375 * j, 0],
      { thickness: 200, E: 30000, nu: 0.3 },
      { type: "plate" },
    );
    const restraints = nodes.map((node, k): Restraint => {
      const [i, j] = [k % (n + 1), Math.floor(k / (n + 1))];
      const xEdge = i === 0 || i === n;
      const yEdge = j === 0 || j === n;
      return {
        nodeId: node.id,
        ux: true,
        uy: true,
        ...(xEdge || yEdge ? { uz: true } : {}),
        ...(xEdge || (clamped && yEdge) ? { rx: true } : {}),
        ...(yEdge || (clamped && xEdge) ? { ry: true } : {}),
      };
    });
    const r = analyze({
      nodes,
      members: [],
      restraints,
      shells,
      loadCases: [{ id: "L" }],
      areaLoads: shells.map((s) => ({ loadCase: "L", areaId: s.id, direction: "Z", q: -10 })),
    });
    const qa2 = 10 * 36; // q·a² in kN·m/m
    const mean = (nodeId: string, key: keyof ShellCornerForces) => {
      const at = cornersOf(r, "L").filter((c) => c.nodeId === nodeId);
      return at.reduce((s, c) => s + (c[key] as number), 0) / at.length / qa2;
    };
    return { centre: id(n / 2, n / 2), edge: id(n / 2, 0), mean };
  };

  it("simply supported: M11 = M22 → 0.0479 qa² (sagging) at the centre, 0 at the edges", () => {
    const { centre, edge, mean } = plate(false);
    expect(Math.abs(mean(centre, "M11") / 0.0479 - 1)).toBeLessThan(0.005);
    expect(mean(centre, "M22")).toBeCloseTo(mean(centre, "M11"), 10);
    expect(mean(edge, "M22")).toBeCloseTo(0, 4); // extrapolation error ~10⁻⁵ qa²
  });

  it("clamped: 0.0231 qa² at the centre and −0.0513 qa² (hogging) at the edge middle", () => {
    const { centre, edge, mean } = plate(true);
    expect(Math.abs(mean(centre, "M11") / 0.0231 - 1)).toBeLessThan(0.015);
    expect(Math.abs(mean(edge, "M22") / -0.0513 - 1)).toBeLessThan(0.01);
  });
});

describe("shell forces in combinations and the envelope", () => {
  const model = strip();
  model.combinations = [
    {
      id: "C1",
      terms: [
        { case: "P", factor: 1.2 },
        { case: "T", factor: 1.6 },
      ],
    },
    {
      id: "C2",
      terms: [
        { case: "P", factor: -0.9 },
        { case: "M", factor: 1 },
      ],
    },
  ];
  const r = analyze(model);

  it("superposes the cases", () => {
    const c1 = r.combinations.C1.shellForces.flatMap((s) => s.corners);
    const P = cornersOf(r, "P");
    const T = cornersOf(r, "T");
    c1.forEach((c, k) => {
      expect(c.M11).toBeCloseTo(1.2 * P[k].M11 + 1.6 * T[k].M11, 3);
      expect(c.F11).toBeCloseTo(1.2 * P[k].F11 + 1.6 * T[k].F11, 3);
      expect(c.S11Top).toBeCloseTo(1.2 * P[k].S11Top + 1.6 * T[k].S11Top, 3);
    });
  });

  it("envelopes every corner with the governing combination", () => {
    const root = r.envelope!.shells[0].corners[0];
    expect(root.nodeId).toBe("n0_0");
    expect(root.M11.min).toEqual({ value: -72, combinationId: "C1" }); // 1.2 × −60
    expect(root.M11.max).toEqual({ value: 44, combinationId: "C2" }); // −0.9 × −60 − 10
    expect(root.F11.max).toEqual({ value: 160, combinationId: "C1" });
  });

  it("counts the shells and states the per-length units", () => {
    expect(r.calculationDetails.shellCount).toBe(6);
    expect(r.units.forcePerLength).toBe("kN/m");
    expect(r.units.momentPerLength).toBe("kN·m/m");
    expect(r.units.stress).toBe("MPa");
  });
});
