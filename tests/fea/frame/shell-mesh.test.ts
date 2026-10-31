import { FrameAnalysisError } from "@app-core/errors/frame-analysis.error";
import { analyzeFrame, createFrameAnalysis } from "@app-fea/frame/solver/analyze-frame";
import type {
  FrameModel,
  FrameNode,
  Member,
  MemberLoad,
  ShellArea,
} from "@app-fea/frame/types/model.type";
import type { FrameResult } from "@app-fea/frame/types/results.type";
import { validateFrameModel } from "@app-fea/frame/validation/validate-model";

const concrete = { thickness: 200, E: 30000, nu: 0.2, unitWeight: 24 };
const beam = { E: 30000, G: 12500, A: 1.2e5, I22: 1.6e9, I33: 3.6e9, J: 2e9, unitWeight: 24 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true } as const;

const issuesOf = (model: FrameModel) =>
  validateFrameModel(model).map((i) => ({ code: i.code, ...i.details }));
const node = (r: FrameResult, id: unknown) => {
  const all = [...r.mesh!.nodes];
  return all.find((n) => n.id === id);
};

/** A 2 × 6 m wall in the XZ plane as one shell area, base fixed along a line restraint. */
const wallArea = (mesh?: ShellArea["mesh"]): FrameModel => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 2000, y: 0, z: 0 },
    { id: 3, x: 2000, y: 0, z: 6000 },
    { id: 4, x: 0, y: 0, z: 6000 },
  ],
  members: [],
  restraints: [],
  lineRestraints: [{ nodeIds: [1, 2], ...fixed }],
  shells: [{ id: "W", nodeIds: [1, 2, 3, 4], section: concrete, ...(mesh ? { mesh } : {}) }],
  loadCases: [{ id: "D", selfWeight: 1 }, { id: "H" }],
  areaLoads: [{ loadCase: "H", areaId: "W", direction: "X", q: 10 }], // in-plane body load
});

describe("engine meshing of a shell area", () => {
  const r = analyzeFrame(wallArea({ maxSize: 250 }));

  it("divides every edge into pieces of at most maxSize: 8 × 24 elements", () => {
    expect(r.calculationDetails.shellCount).toBe(192);
    expect(r.mesh!.shells.every((s) => s.areaId === "W")).toBe(true);
    expect(r.mesh!.nodes).toHaveLength(9 * 25 - 4);
    expect(r.calculationDetails.nodeCount).toBe(9 * 25);
  });

  it("names elements <areaId>:<i>,<j>, edge nodes <a>~<b>:<k> and interior nodes <areaId>:<i>,<j>", () => {
    expect(r.mesh!.shells[0]).toEqual({
      id: "W:0,0",
      areaId: "W",
      nodeIds: [1, "1~2:1", "W:1,1", "1~4:1"],
    });
    expect(node(r, "1~2:1")).toEqual({ id: "1~2:1", x: 250, y: 0, z: 0 });
    const inner = node(r, "W:1,1")!;
    expect([inner.x, inner.y, inner.z].map((v) => +v.toFixed(9))).toEqual([250, 0, 250]);
    expect(r.cases.D.shellForces[0]).toMatchObject({ shellId: "W:0,0", areaId: "W" });
  });

  it("reports generated nodes in displacements and reactions, and loads every element", () => {
    const D = r.cases.D;
    expect(D.nodalDisplacements.some((d) => d.nodeId === "W:4,12")).toBe(true);
    expect(D.reactions.reduce((s, x) => s + x.fz, 0)).toBeCloseTo(24 * 0.2 * 12, 2);
    expect(r.cases.H.reactions.reduce((s, x) => s + x.fx, 0)).toBeCloseTo(-10 * 12, 2);
    // the line restraint holds the generated base nodes too
    expect(D.reactions.find((x) => x.nodeId === "1~2:4")!.fz).toBeGreaterThan(0);
  });

  it("matches the same mesh entered element by element", () => {
    const n1 = 8;
    const n2 = 24;
    const id = (i: number, j: number) => `g${i}_${j}`;
    const nodes: FrameNode[] = [];
    for (let j = 0; j <= n2; j++) {
      for (let i = 0; i <= n1; i++) nodes.push({ id: id(i, j), x: 250 * i, y: 0, z: 250 * j });
    }
    const shells: ShellArea[] = [];
    for (let j = 0; j < n2; j++) {
      for (let i = 0; i < n1; i++) {
        shells.push({
          id: `e${i}_${j}`,
          nodeIds: [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
          section: concrete,
        });
      }
    }
    const manual = analyzeFrame({
      nodes,
      members: [],
      restraints: Array.from({ length: n1 + 1 }, (_, i) => ({ nodeId: id(i, 0), ...fixed })),
      shells,
      loadCases: [{ id: "H" }],
      areaLoads: shells.map((s) => ({ loadCase: "H", areaId: s.id, direction: "X", q: 10 })),
    });
    const top = (res: FrameResult, nodeId: unknown) =>
      res.cases.H.nodalDisplacements.find((d) => d.nodeId === nodeId)!.ux;
    expect(top(r, 3)).toBeCloseTo(top(manual, id(n1, n2)), 8);
    expect(top(r, 3)).toBeGreaterThan(0);
  });

  it("treats divisions as a minimum, and keeps an area with no mesh as one element", () => {
    const divided = analyzeFrame(wallArea({ divisions: [3, 5] }));
    expect(divided.calculationDetails.shellCount).toBe(15);
    const single = analyzeFrame(wallArea());
    expect(single.mesh).toEqual({
      nodes: [],
      shells: [{ id: "W", areaId: "W", nodeIds: [1, 2, 3, 4] }],
    });
    expect(single.cases.D.shellForces[0]).toMatchObject({ shellId: "W", areaId: "W" });
  });
});

describe("conforming meshes", () => {
  // a 6 × 4 m slab at z = 3 m on two 3 m wall panels along its edge y = 0 (a T-junction)
  const slabOnWalls = (): FrameModel => ({
    nodes: [
      { id: "a", x: 0, y: 0, z: 0 },
      { id: "b", x: 3000, y: 0, z: 0 },
      { id: "c", x: 6000, y: 0, z: 0 },
      { id: "A", x: 0, y: 0, z: 3000 },
      { id: "B", x: 3000, y: 0, z: 3000 },
      { id: "C", x: 6000, y: 0, z: 3000 },
      { id: "D", x: 6000, y: 4000, z: 3000 },
      { id: "E", x: 0, y: 4000, z: 3000 },
    ],
    members: [],
    restraints: [],
    lineRestraints: [
      { nodeIds: ["a", "c"], ...fixed },
      { nodeIds: ["E", "D"], uz: true },
    ],
    shells: [
      { id: "W1", nodeIds: ["a", "b", "B", "A"], section: concrete, mesh: { maxSize: 1000 } },
      { id: "W2", nodeIds: ["b", "c", "C", "B"], section: concrete, mesh: { maxSize: 600 } },
      { id: "S", nodeIds: ["A", "C", "D", "E"], section: concrete, mesh: { maxSize: 1500 } },
    ],
    loadCases: [{ id: "L" }],
    areaLoads: [{ loadCase: "L", areaId: "S", direction: "Z", q: -5 }],
  });

  it("shares nodes where a slab edge sits on two wall panels with different mesh sizes", () => {
    const r = analyzeFrame(slabOnWalls());
    const nodesOf = (areaId: string) =>
      new Set(r.mesh!.shells.filter((s) => s.areaId === areaId).flatMap((s) => s.nodeIds));
    const position = new Map(
      [...slabOnWalls().nodes, ...r.mesh!.nodes].map((n) => [n.id, n] as const),
    );
    const onTopEdge = (ids: Set<unknown>) =>
      [...ids].filter((id) => {
        const n = position.get(id as string)!;
        return n.y === 0 && Math.abs(n.z - 3000) < 1e-9;
      });
    const slabEdge = new Set(onTopEdge(nodesOf("S")));
    const wallTops = new Set([...onTopEdge(nodesOf("W1")), ...onTopEdge(nodesOf("W2"))]);
    expect(slabEdge).toEqual(wallTops);
    expect(slabEdge.has("B")).toBe(true); // the wall corner is a hard point of the slab edge
    expect(r.cases.L.reactions.reduce((s, x) => s + x.fz, 0)).toBeCloseTo(5 * 24, 2);
    expect(r.warnings).toEqual([]);
  });
});

describe("members along meshed edges", () => {
  // 5 × 4 m slab on four edge beams and four columns, meshed at 1 m; B34 is pinned at its ends
  const frame = (): FrameModel => ({
    nodes: [
      { id: 1, x: 0, y: 0, z: 3000 },
      { id: 2, x: 5000, y: 0, z: 3000 },
      { id: 3, x: 5000, y: 4000, z: 3000 },
      { id: 4, x: 0, y: 4000, z: 3000 },
      { id: 11, x: 0, y: 0, z: 0 },
      { id: 12, x: 5000, y: 0, z: 0 },
      { id: 13, x: 5000, y: 4000, z: 0 },
      { id: 14, x: 0, y: 4000, z: 0 },
    ],
    members: [
      { id: "B12", startNodeId: 1, endNodeId: 2, section: beam },
      { id: "B23", startNodeId: 2, endNodeId: 3, section: beam },
      {
        id: "B34",
        startNodeId: 3,
        endNodeId: 4,
        section: beam,
        releases: { start: { r3: true }, end: { r3: true } },
      },
      { id: "B41", startNodeId: 4, endNodeId: 1, section: beam },
      ...[1, 2, 3, 4].map(
        (n): Member => ({ id: `C${n}`, startNodeId: 10 + n, endNodeId: n, section: beam }),
      ),
    ],
    restraints: [11, 12, 13, 14].map((nodeId) => ({ nodeId, ...fixed })),
    shells: [{ id: "S", nodeIds: [1, 2, 3, 4], section: concrete, mesh: { maxSize: 1000 } }],
    loadCases: [{ id: "D", selfWeight: 1 }, { id: "L" }],
    areaLoads: [{ loadCase: "L", areaId: "S", direction: "Z", q: -3 }],
    memberLoads: [
      { loadCase: "L", type: "udl", memberId: "B12", direction: "Z", w: -5 },
      { loadCase: "L", type: "point", memberId: "B12", direction: "Z", P: -20, a: 2300 },
      {
        loadCase: "L",
        type: "trapezoidal",
        memberId: "B23",
        direction: "Z",
        w1: -2,
        w2: -8,
        start: 500,
        end: 3500,
      },
    ],
  });

  /** The same model with the engine's mesh entered as shells and each beam split by hand. */
  const byHand = (engine: FrameResult) => {
    const model = frame();
    const nodes = [...model.nodes, ...engine.mesh!.nodes];
    const at = new Map(nodes.map((n) => [n.id, n] as const));
    const members: Member[] = [];
    const pieces = new Map<string, { id: string; from: number; L: number }[]>();
    for (const m of model.members) {
      const [P, Q] = [at.get(m.startNodeId)!, at.get(m.endNodeId)!];
      const L = Math.hypot(Q.x - P.x, Q.y - P.y, Q.z - P.z);
      const inside = engine
        .mesh!.nodes.map((n) => {
          const t =
            ((n.x - P.x) * (Q.x - P.x) + (n.y - P.y) * (Q.y - P.y) + (n.z - P.z) * (Q.z - P.z)) /
            L ** 2;
          const off = Math.hypot(
            n.x - P.x - t * (Q.x - P.x),
            n.y - P.y - t * (Q.y - P.y),
            n.z - P.z - t * (Q.z - P.z),
          );
          return { id: n.id, t, off };
        })
        .filter((x) => x.off < 1e-6 && x.t > 1e-9 && x.t < 1 - 1e-9)
        .sort((a, b) => a.t - b.t);
      const chain = [m.startNodeId, ...inside.map((x) => x.id), m.endNodeId];
      const ts = [0, ...inside.map((x) => x.t), 1];
      const list = [];
      for (let k = 0; k + 1 < chain.length; k++) {
        const id = chain.length === 2 ? String(m.id) : `${m.id}#${k}`;
        const releases = m.releases && {
          start: k === 0 ? m.releases.start : undefined,
          end: k === chain.length - 2 ? m.releases.end : undefined,
        };
        members.push({ ...m, id, startNodeId: chain[k], endNodeId: chain[k + 1], releases });
        list.push({ id, from: ts[k] * L, L: (ts[k + 1] - ts[k]) * L });
      }
      pieces.set(String(m.id), list);
    }
    const memberLoads: MemberLoad[] = [];
    for (const load of model.memberLoads!) {
      for (const p of pieces.get(String(load.memberId))!) {
        if (load.type === "udl") memberLoads.push({ ...load, memberId: p.id });
        if (load.type === "point" && load.a >= p.from && load.a < p.from + p.L) {
          memberLoads.push({ ...load, memberId: p.id, a: load.a - p.from });
        }
        if (load.type === "trapezoidal") {
          const s = Math.max(load.start!, p.from);
          const e = Math.min(load.end!, p.from + p.L);
          const w = (x: number) =>
            load.w1 + ((load.w2 - load.w1) * (x - load.start!)) / (load.end! - load.start!);
          if (e - s > 1e-9) {
            memberLoads.push({
              ...load,
              memberId: p.id,
              w1: w(s),
              w2: w(e),
              start: s - p.from,
              end: e - p.from,
            });
          }
        }
      }
    }
    const shells: ShellArea[] = engine.mesh!.shells.map((s) => ({
      id: s.id,
      nodeIds: s.nodeIds,
      section: concrete,
    }));
    const result = analyzeFrame({
      ...model,
      nodes,
      members,
      memberLoads,
      shells,
      areaLoads: shells.map((s) => ({ loadCase: "L", areaId: s.id, direction: "Z", q: -3 })),
    });
    return { result, pieces };
  };

  const engine = analyzeFrame(frame());
  const { result: manual, pieces } = byHand(engine);

  it("splits the edge beams at the mesh nodes but reports each under its own id", () => {
    expect(pieces.get("B12")).toHaveLength(5);
    expect(engine.calculationDetails.memberCount).toBe(8);
    expect(engine.cases.L.memberEndForces.map((f) => f.memberId)).toEqual(
      frame().members.map((m) => m.id),
    );
  });

  it("gives the same displacements, end forces and diagram extremes as splitting by hand", () => {
    for (const c of ["D", "L"]) {
      for (const d of engine.cases[c].nodalDisplacements) {
        const e = manual.cases[c].nodalDisplacements.find((x) => x.nodeId === d.nodeId)!;
        expect(d.uz).toBeCloseTo(e.uz, 8);
      }
      for (const id of ["B12", "B23", "B34"]) {
        const list = pieces.get(id)!;
        const ends = engine.cases[c].memberEndForces.find((f) => f.memberId === id)!;
        const first = manual.cases[c].memberEndForces.find((f) => f.memberId === list[0].id)!;
        const last = manual.cases[c].memberEndForces.find(
          (f) => f.memberId === list[list.length - 1].id,
        )!;
        expect(ends.start).toEqual(first.start);
        expect(ends.end).toEqual(last.end);
        const diagram = engine.cases[c].memberDiagrams.find((d) => d.memberId === id)!;
        const pieceDiagrams = list.map(
          (p) => manual.cases[c].memberDiagrams.find((d) => d.memberId === p.id)!,
        );
        expect(diagram.length).toBeCloseTo(id === "B23" ? 4000 : 5000, 9);
        expect(diagram.extremes.M3.max.value).toBe(
          Math.max(...pieceDiagrams.map((d) => d.extremes.M3.max.value)),
        );
        expect(diagram.extremes.M3.min.value).toBe(
          Math.min(...pieceDiagrams.map((d) => d.extremes.M3.min.value)),
        );
      }
    }
    // the point load at 2.3 m governs B12's sagging moment
    expect(engine.cases.L.memberDiagrams[0].extremes.M3.max.x).toBe(2300);
  });

  it("stitches the diagram along the whole member, stations in order", () => {
    const diagram = engine.cases.L.memberDiagrams.find((d) => d.memberId === "B12")!;
    const xs = diagram.stations.map((s) => s.x);
    expect(xs[0]).toBe(0);
    expect(xs[xs.length - 1]).toBe(5000);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const onDemand = createFrameAnalysis(frame()).memberDiagram("L", "B12");
    expect(onDemand.extremes).toEqual(diagram.extremes);
  });

  it("keeps end releases at the member's own ends", () => {
    const B34 = engine.cases.L.memberEndForces.find((f) => f.memberId === "B34")!;
    expect(B34.start.m3).toBeCloseTo(0, 6);
    expect(B34.end.m3).toBeCloseTo(0, 6);
    expect(engine.cases.L.releaseDeformations.map((r) => r.memberId)).toEqual(["B34"]);
  });
});

describe("mesh and line-restraint validation", () => {
  it("314 for an invalid maxSize or divisions", () => {
    const model = wallArea();
    model.shells = [
      { ...model.shells![0], mesh: { maxSize: 0, divisions: [2, 0] as [number, number] } },
    ];
    expect(issuesOf(model)).toEqual([
      { code: 314, shellId: "W", field: "mesh.maxSize" },
      { code: 314, shellId: "W", field: "mesh.divisions" },
    ]);
  });

  it("checks line restraints: two distinct nodes, known, and true/false values", () => {
    const model = wallArea();
    model.lineRestraints = [
      { nodeIds: [1, 1], ux: true },
      { nodeIds: [1, 99], ux: true },
      { nodeIds: [1, 2], uz: 5 as unknown as boolean },
    ];
    expect(issuesOf(model)).toEqual([
      { code: 314, nodeId: 1, field: "lineRestraints.nodeIds" },
      { code: 302, nodeId: 1, field: "lineRestraints.nodeIds" },
      { code: 314, nodeId: 1, field: "lineRestraints.uz" },
    ]);
  });

  it("329 when a generated id is already used", () => {
    const model = wallArea({ maxSize: 1000 });
    model.nodes.push({ id: "1~2:1", x: 9000, y: 9000, z: 9000 });
    expect(issuesOf(model)).toEqual([{ code: 329, shellId: "W", field: "mesh" }]);
    expect(() => analyzeFrame(model)).toThrow(FrameAnalysisError);
  });

  it("warns about a member node inside a shell area that is not on its mesh", () => {
    const model: FrameModel = {
      nodes: [
        { id: 1, x: 0, y: 0, z: 0 },
        { id: 2, x: 4000, y: 0, z: 0 },
        { id: 3, x: 4000, y: 4000, z: 0 },
        { id: 4, x: 0, y: 4000, z: 0 },
        { id: 9, x: 1500, y: 1700, z: 0 },
        { id: 10, x: 1500, y: 1700, z: -3000 },
      ],
      members: [{ id: "col", startNodeId: 10, endNodeId: 9, section: beam }],
      restraints: [{ nodeId: 10, ...fixed }],
      lineRestraints: [
        { nodeIds: [1, 2], ux: true, uy: true, uz: true },
        { nodeIds: [3, 4], uz: true },
      ],
      shells: [{ id: "S", nodeIds: [1, 2, 3, 4], section: concrete, mesh: { maxSize: 1000 } }],
      loadCases: [{ id: "L" }],
    };
    expect(analyzeFrame(model).warnings).toEqual([
      {
        reference: "Shell area meshing",
        message:
          'Node "9" lies inside shell area "S" but not on its mesh, so its members are not connected to the shell; divide the area through the node.',
      },
    ]);
  });
});
