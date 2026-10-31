import { FrameAnalysisError } from "@app-core/errors/frame-analysis.error";
import { distributeAreaLoads } from "@app-fea/frame/area/distribute-area-loads";
import { analyzeFrame } from "@app-fea/frame/solver/analyze-frame";
import type {
  FrameModel,
  FrameNode,
  Restraint,
  ShellArea,
  ShellSection,
  ShellType,
} from "@app-fea/frame/types/model.type";
import { validateFrameModel } from "@app-fea/frame/validation/validate-model";

const concrete: ShellSection = { thickness: 200, E: 30000, nu: 0.2, unitWeight: 24 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

/** An n₁ × n₂ grid of shell elements; `at(i, j)` gives node (i, j) in mm. */
const grid = (
  n1: number,
  n2: number,
  at: (i: number, j: number) => [number, number, number],
  section: ShellSection = concrete,
  type?: ShellType,
) => {
  const id = (i: number, j: number) => `n${i}_${j}`;
  const nodes: FrameNode[] = [];
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
        ...(type ? { type } : {}),
      });
    }
  }
  return { id, nodes, shells };
};

/** A single 4 × 3 m shell, inclined: rises 2 m over its 3 m width. */
const inclined = (): FrameModel => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 4000, y: 0, z: 0 },
    { id: 3, x: 4000, y: 3000, z: 2000 },
    { id: 4, x: 0, y: 3000, z: 2000 },
  ],
  members: [],
  restraints: [1, 2, 3, 4].map((nodeId) => ({ nodeId, ux: true, uy: true, uz: true })),
  shells: [{ id: "roof", nodeIds: [1, 2, 3, 4], section: concrete }],
  loadCases: [{ id: "L" }],
});

const issuesOf = (model: FrameModel) =>
  validateFrameModel(model).map((i) => ({ code: i.code, ...i.details }));

const thrown = (model: FrameModel): FrameAnalysisError => {
  try {
    analyzeFrame(model);
  } catch (e) {
    expect(e).toBeInstanceOf(FrameAnalysisError);
    return e as FrameAnalysisError;
  }
  throw new Error("expected a FrameAnalysisError");
};

const sumReactions = (r: ReturnType<typeof analyzeFrame>, id: string, key: "fx" | "fy" | "fz") =>
  r.cases[id].reactions.reduce((s, x) => s + x[key], 0);

describe("shell validation", () => {
  it("accepts a valid shell and an area load on it", () => {
    const model = inclined();
    model.areaLoads = [{ loadCase: "L", areaId: "roof", direction: "Z", q: -2 }];
    expect(validateFrameModel(model)).toEqual([]);
  });

  it("326 for a shell that is not 4 distinct nodes in a convex, nearly flat quadrilateral", () => {
    const cases: [string, Partial<ShellArea>, Partial<Record<number, [number, number, number]>>][] =
      [
        ["3 nodes", { nodeIds: [1, 2, 3] }, {}],
        ["a repeated node", { nodeIds: [1, 2, 2, 4] }, {}],
        ["a crossed (bow-tie) order", { nodeIds: [1, 2, 4, 3] }, {}],
        ["a reflex corner", {}, { 3: [1500, 1000, 700] }],
        ["three corners in line", {}, { 3: [2000, 1500, 1000] }],
        ["corners far off the mean plane (warping 0.13)", {}, { 3: [4000, 3000, 6000] }],
      ];
    for (const [, shell, moved] of cases) {
      const model = inclined();
      model.shells = [{ ...model.shells![0], ...shell }];
      model.nodes = model.nodes.map((n) => {
        const p = moved[n.id as number];
        return p ? { id: n.id, x: p[0], y: p[1], z: p[2] } : n;
      });
      expect(issuesOf(model)).toEqual([{ code: 326, shellId: "roof", field: "nodeIds" }]);
    }
  });

  it("327 for thickness, E, nu or unitWeight out of range, each located", () => {
    const model = inclined();
    model.shells = [
      {
        id: "roof",
        nodeIds: [1, 2, 3, 4],
        section: { thickness: 0, E: -1, nu: 0.5, unitWeight: -24 },
      },
    ];
    expect(issuesOf(model)).toEqual([
      { code: 327, shellId: "roof", field: "section.thickness" },
      { code: 327, shellId: "roof", field: "section.E" },
      { code: 327, shellId: "roof", field: "section.nu" },
      { code: 327, shellId: "roof", field: "section.unitWeight" },
    ]);
  });

  it("314 for an unknown type, a non-finite angle or a non-positive modifier", () => {
    const model = inclined();
    model.shells = [
      {
        ...model.shells![0],
        type: "slab" as ShellType,
        angle: NaN,
        modifiers: { f11: 0, m22: -1, weight: -1 },
      },
    ];
    expect(issuesOf(model)).toEqual([
      { code: 314, shellId: "roof", field: "type" },
      { code: 314, shellId: "roof", field: "angle" },
      { code: 314, shellId: "roof", field: "modifiers.f11" },
      { code: 314, shellId: "roof", field: "modifiers.m22" },
      { code: 314, shellId: "roof", field: "modifiers.weight" },
    ]);
  });

  it("303 for a shell id used twice or also used by a null area", () => {
    const model = inclined();
    model.shells = [model.shells![0], { ...model.shells![0] }];
    model.areas = [{ id: "roof", nodeIds: [1, 2, 3, 4], distribution: "twoWay" }];
    expect(issuesOf(model).filter((i) => i.code === 303)).toEqual([
      { code: 303, shellId: "roof", field: "id" },
    ]);
  });

  it("302 for an unknown node, 313 for self-weight without unitWeight", () => {
    const model = inclined();
    model.shells = [
      { id: "roof", nodeIds: [1, 2, 3, 99], section: { ...concrete, unitWeight: undefined } },
    ];
    model.loadCases = [{ id: "L", selfWeight: 1 }];
    expect(issuesOf(model)).toEqual([
      { code: 313, loadCaseId: "L", shellId: "roof", field: "section.unitWeight" },
      { code: 302, shellId: "roof", field: "nodeIds" },
    ]);
  });

  it("names the shell in the message", () => {
    const model = inclined();
    model.shells = [{ ...model.shells![0], section: { ...concrete, thickness: -1 } }];
    expect(validateFrameModel(model)[0].message).toContain('shell "roof"');
  });
});

describe("328: translations that nothing resists at nodes connected only to shells", () => {
  const wall = (type: ShellType, restraints: Restraint[] = []) => {
    const { id, nodes, shells } = grid(2, 2, (i, j) => [1000 * i, 0, 1000 * j], concrete, type);
    const model: FrameModel = {
      nodes,
      members: [],
      restraints: [0, 1, 2].map((i) => ({ nodeId: id(i, 0), ...fixed })).concat(restraints),
      shells,
      loadCases: [{ id: "L" }],
      nodalLoads: [{ loadCase: "L", nodeId: id(2, 2), fx: 10 }],
    };
    return { id, model };
  };

  it("a membrane wall: every free node's out-of-plane translation, with node, shell and DOF", () => {
    const { model } = wall("membrane");
    const error = thrown(model);
    expect(error.code).toBe(328);
    expect(error.issues.map((i) => i.details.nodeId)).toEqual([
      "n0_1",
      "n1_1",
      "n2_1",
      "n0_2",
      "n1_2",
      "n2_2",
    ]);
    expect(new Set(error.issues.map((i) => i.details.dof))).toEqual(new Set(["uy"]));
    expect(error.details.shellId).toBe("s0_0");
    expect(error.message).toContain("membrane carries no load out of its plane");
  });

  it("a membrane wall restrained out of its plane analyses, and matches a shell wall in-plane", () => {
    const { id, model } = wall("membrane");
    model.restraints.push(
      ...model.nodes.filter((n) => n.z > 0).map((n) => ({ nodeId: n.id, uy: true })),
    );
    const membrane = analyzeFrame(model).cases.L.nodalDisplacements;
    const shell = analyzeFrame(wall("shell").model).cases.L.nodalDisplacements;
    const top = (d: typeof membrane) => d.find((x) => x.nodeId === id(2, 2))!.ux;
    expect(top(membrane)).toBeGreaterThan(0);
    expect(top(membrane)).toBe(top(shell));
  });

  it("a plate slab without in-plane restraints: ux and uy", () => {
    const { id, nodes, shells } = grid(2, 2, (i, j) => [1000 * i, 1000 * j, 0], concrete, "plate");
    const edge = (i: number, j: number) => i === 0 || i === 2 || j === 0 || j === 2;
    const model: FrameModel = {
      nodes,
      members: [],
      restraints: nodes
        .filter((_, k) => edge(k % 3, Math.floor(k / 3)))
        .map((n) => ({ nodeId: n.id, uz: true })),
      shells,
      loadCases: [{ id: "L" }],
      nodalLoads: [{ loadCase: "L", nodeId: id(1, 1), fz: -10 }],
    };
    const error = thrown(model);
    expect(error.code).toBe(328);
    expect(new Set(error.issues.map((i) => i.details.dof))).toEqual(new Set(["ux", "uy"]));
  });

  it("not where two membranes meet at an angle: they resist each other's normal direction", () => {
    // two 1-element membrane walls meeting along the Z axis, bases fixed
    const model: FrameModel = {
      nodes: [
        { id: "o0", x: 0, y: 0, z: 0 },
        { id: "o1", x: 0, y: 0, z: 3000 },
        { id: "a0", x: 3000, y: 0, z: 0 },
        { id: "a1", x: 3000, y: 0, z: 3000 },
        { id: "b0", x: 0, y: 3000, z: 0 },
        { id: "b1", x: 0, y: 3000, z: 3000 },
      ],
      members: [],
      restraints: ["o0", "a0", "b0"].map((nodeId) => ({ nodeId, ...fixed })),
      shells: [
        { id: "A", nodeIds: ["o0", "a0", "a1", "o1"], section: concrete, type: "membrane" },
        { id: "B", nodeIds: ["b0", "o0", "o1", "b1"], section: concrete, type: "membrane" },
      ],
      loadCases: [{ id: "L" }],
    };
    const error = thrown(model);
    expect(error.issues.map((i) => [i.details.nodeId, i.details.dof])).toEqual([
      ["a1", "uy"],
      ["b1", "ux"],
    ]);
  });
});

describe("loads on shells", () => {
  // true area 4 m × 3.6056 m, plan area 12 m², normal (0, −0.5547, 0.83205)
  const trueArea = 4 * Math.hypot(3, 2);

  it("self-weight, a projected load and a normal load reach the supports in full", () => {
    const model = inclined();
    model.loadCases = [{ id: "D", selfWeight: 1 }, { id: "L" }];
    model.areaLoads = [
      { loadCase: "L", areaId: "roof", direction: "Z", q: -2, projected: true }, // per plan area
      { loadCase: "L", areaId: "roof", direction: "3", q: -1 }, // along −normal
    ];
    const r = analyzeFrame(model);
    expect(sumReactions(r, "D", "fz")).toBeCloseTo(24 * 0.2 * trueArea, 3);
    expect(sumReactions(r, "L", "fz")).toBeCloseTo(2 * 12 + 12, 3);
    expect(sumReactions(r, "L", "fy")).toBeCloseTo(-8, 3);
    expect(sumReactions(r, "L", "fx")).toBeCloseTo(0, 3);
  });

  it("modifiers.weight scales the self-weight only", () => {
    const model = inclined();
    model.loadCases = [{ id: "D", selfWeight: 1 }];
    model.shells = [{ ...model.shells![0], modifiers: { weight: 0.5 } }];
    expect(sumReactions(analyzeFrame(model), "D", "fz")).toBeCloseTo(0.5 * 24 * 0.2 * trueArea, 3);
  });

  it("combines shell loads by superposition", () => {
    const model = inclined();
    model.loadCases = [{ id: "D", selfWeight: 1 }, { id: "L" }];
    model.areaLoads = [{ loadCase: "L", areaId: "roof", direction: "Z", q: -3 }];
    model.combinations = [
      {
        id: "U",
        terms: [
          { case: "D", factor: 1.2 },
          { case: "L", factor: 1.6 },
        ],
      },
    ];
    const r = analyzeFrame(model);
    const expected = 1.2 * sumReactions(r, "D", "fz") + 1.6 * sumReactions(r, "L", "fz");
    expect(r.combinations.U.reactions.reduce((s, x) => s + x.fz, 0)).toBeCloseTo(expected, 3);
  });

  it("are not sent to members by distributeAreaLoads", () => {
    const model = inclined();
    model.areaLoads = [{ loadCase: "L", areaId: "roof", direction: "Z", q: -2 }];
    expect(distributeAreaLoads(model).memberLoads).toEqual([]);
  });
});

describe("shell benchmarks through analyzeFrame", () => {
  it("Scordelis–Lo roof: midspan free-edge deflection converges from above to 0.3024", () => {
    // R = 25, L = 50, t = 0.25, E = 4.32·10⁸, ν = 0, gravity 90 per unit area (ft and lb taken
    // as mm and N, so q = 90 N/mm² = 90 000 kN/m²); rigid diaphragms at both ends
    const deflection = (n: number) => {
      const phi = (j: number) => ((-40 + (80 * j) / n) * Math.PI) / 180;
      const { id, nodes, shells } = grid(
        n,
        n,
        (i, j) => [(50 * i) / n, 25 * Math.sin(phi(j)), 25 * Math.cos(phi(j))],
        { thickness: 0.25, E: 4.32e8, nu: 0 },
      );
      const restraints: Restraint[] = [];
      for (let j = 0; j <= n; j++) {
        for (const i of [0, n]) {
          const axial = i === 0 && j === n / 2 ? { ux: true } : {};
          restraints.push({ nodeId: id(i, j), uy: true, uz: true, rx: true, ...axial });
        }
      }
      const r = analyzeFrame({
        nodes,
        members: [],
        restraints,
        shells,
        loadCases: [{ id: "G" }],
        areaLoads: shells.map((s) => ({ loadCase: "G", areaId: s.id, direction: "Z", q: -90000 })),
      });
      return -r.cases.G.nodalDisplacements.find((d) => d.nodeId === id(n / 2, 0))!.uz;
    };
    const w = [4, 8, 16].map(deflection);
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[1]).toBeGreaterThan(w[2]);
    expect(Math.abs(w[2] / 0.3024 - 1)).toBeLessThan(0.01);
  });

  it("pinched cylinder with diaphragms: within 2 % of 1.8248·10⁻⁵ on a 16 × 16 octant", () => {
    // R = 300, L = 600, t = 3, E = 3·10⁶, ν = 0.3; octant x ∈ [0, 300] from midspan, θ from the
    // load (top) to the side; P = 10⁶ N in total, so the result reads 10⁶ × the reference
    const n = 16;
    const { id, nodes, shells } = grid(
      n,
      n,
      (i, j) => {
        const theta = (Math.PI / 2) * (j / n);
        return [(300 * i) / n, 300 * Math.sin(theta), 300 * Math.cos(theta)];
      },
      { thickness: 3, E: 3e6, nu: 0.3 },
    );
    const restraints: Restraint[] = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const r: Restraint = { nodeId: id(i, j) };
        if (i === 0) Object.assign(r, { ux: true, ry: true, rz: true }); // symmetry, x = 0
        if (j === 0) Object.assign(r, { uy: true, rx: true, rz: true }); // symmetry, y = 0
        if (j === n) Object.assign(r, { uz: true, rx: true, ry: true }); // symmetry, z = 0
        if (i === n) Object.assign(r, { uy: true, uz: true, rx: true }); // rigid diaphragm
        if (Object.keys(r).length > 1) restraints.push(r);
      }
    }
    const r = analyzeFrame({
      nodes,
      members: [],
      restraints,
      shells,
      loadCases: [{ id: "P" }],
      nodalLoads: [{ loadCase: "P", nodeId: id(0, 0), fz: -250 }], // a quarter of 10⁶ N, in kN
    });
    const w = -r.cases.P.nodalDisplacements.find((d) => d.nodeId === id(0, 0))!.uz / 1e6;
    expect(Math.abs(w / 1.8248e-5 - 1)).toBeLessThan(0.02);
  });

  it("cantilever wall 2 × 6 m: within 1 % of beam theory with shear deformation", () => {
    // δ = PH³/(3EI) + PH/(κGA) = 1.800 + 0.144 = 1.944 mm for P = 100 kN
    const { id, nodes, shells } = grid(8, 24, (i, j) => [250 * i, 0, 250 * j]);
    const r = analyzeFrame({
      nodes,
      members: [],
      restraints: Array.from({ length: 9 }, (_, i) => ({ nodeId: id(i, 0), ...fixed })),
      shells,
      loadCases: [{ id: "W" }],
      nodalLoads: Array.from({ length: 9 }, (_, i) => ({
        loadCase: "W",
        nodeId: id(i, 24),
        fx: i === 0 || i === 8 ? 6.25 : 12.5,
      })),
    });
    const top = r.cases.W.nodalDisplacements.filter((d) => (d.nodeId as string).endsWith("_24"));
    const mean = top.reduce((s, d) => s + d.ux, 0) / top.length;
    expect(Math.abs(mean / 1.944 - 1)).toBeLessThan(0.01);
  });

  it("a beam framing into a wall in its plane is held by the drilling rotation", () => {
    // 3 × 3 m wall in the XZ plane, base fixed; a 2 m cantilever from the middle of its edge
    const run = (E: number) => {
      const { id, nodes, shells } = grid(6, 6, (i, j) => [500 * i, 0, 500 * j], {
        ...concrete,
        E,
      });
      nodes.push({ id: "tip", x: 5000, y: 0, z: 1500 });
      const section = { E: 30000, G: 12500, A: 1.8e5, I22: 1.35e9, I33: 5.4e9, J: 3.7e9 };
      return analyzeFrame({
        nodes,
        members: [{ id: "b", startNodeId: id(6, 3), endNodeId: "tip", section }],
        restraints: Array.from({ length: 7 }, (_, i) => ({ nodeId: id(i, 0), ...fixed })),
        shells,
        loadCases: [{ id: "P" }],
        nodalLoads: [{ loadCase: "P", nodeId: "tip", fz: -10 }],
      });
    };
    const fixedEnd = (10e3 * 2000 ** 3) / (3 * 30000 * 5.4e9); // PL³/3EI = 0.1646 mm
    const stiffWall = run(3e8);
    const tip = (r: typeof stiffWall) =>
      r.cases.P.nodalDisplacements.find((d) => d.nodeId === "tip")!.uz;
    expect(-tip(stiffWall) / fixedEnd).toBeCloseTo(1, 3);
    expect(Math.abs(stiffWall.cases.P.memberEndForces[0].start.m3)).toBeCloseTo(20, 3);
    // a real wall adds its own rotation and drift
    expect(-tip(run(30000))).toBeGreaterThan(fixedEnd);
  });

  it("simply supported plate slab 6 × 6 m: within 0.2 % of 0.00406 qa⁴/D, and cracked 4× softer", () => {
    const deflection = (modifiers?: ShellArea["modifiers"]) => {
      const { id, nodes, shells } = grid(8, 8, (i, j) => [750 * i, 750 * j, 0], concrete, "plate");
      const restraints = nodes.map((n, k): Restraint => {
        const [i, j] = [k % 9, Math.floor(k / 9)];
        return {
          nodeId: n.id,
          ux: true,
          uy: true,
          ...(i === 0 || i === 8 ? { uz: true, rx: true } : {}),
          ...(j === 0 || j === 8 ? { uz: true, ry: true } : {}),
        };
      });
      const r = analyzeFrame({
        nodes,
        members: [],
        restraints,
        shells: shells.map((s) => ({ ...s, modifiers })),
        loadCases: [{ id: "L" }],
        areaLoads: shells.map((s) => ({ loadCase: "L", areaId: s.id, direction: "Z", q: -10 })),
      });
      return -r.cases.L.nodalDisplacements.find((d) => d.nodeId === id(4, 4))!.uz;
    };
    const D = (30000 * 200 ** 3) / (12 * (1 - 0.2 ** 2));
    const w = deflection();
    expect(Math.abs(w / ((0.00406 * 0.01 * 6000 ** 4) / D) - 1)).toBeLessThan(0.002);
    expect(deflection({ m11: 0.25, m22: 0.25, m12: 0.25 }) / w).toBeCloseTo(4, 3);
  });
});
