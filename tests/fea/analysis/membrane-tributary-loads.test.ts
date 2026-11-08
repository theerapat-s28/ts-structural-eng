import { FeaError } from "@app-core/errors/fea.error";
import { analyze } from "@app-fea/analysis/solver/analyze";
import type { FeaModel } from "@app-fea/analysis/types/model.type";
import type { Member } from "@app-fea/frame/types/model.type";
import type { FeaNode } from "@app-fea/shared/types/model.type";
import type { ShellArea } from "@app-fea/shell/types/model.type";

const section = { thickness: 200, E: 30000, nu: 0.2, unitWeight: 24 };
const beamSection = {
  A: 120000,
  E: 30000,
  G: 12500,
  J: 1e9,
  I22: 1.6e9,
  I33: 3.6e9,
  unitWeight: 0,
};
const REFERENCE = "Membrane area, out-of-plane load";
const ids = ["a", "b", "c", "d"];
const flat = (): FeaNode[] => [
  { id: "a", x: 0, y: 0, z: 0 },
  { id: "b", x: 6000, y: 0, z: 0 },
  { id: "c", x: 6000, y: 6000, z: 0 },
  { id: "d", x: 0, y: 6000, z: 0 },
];

/** Beams a→b→c→d→a, simply supported when `pinned` (torsion held at the start only). */
const edgeBeams = (order: string[], pinned: boolean): Member[] =>
  order.map((id, i) => ({
    id: `B${id}`,
    startNodeId: id,
    endNodeId: order[(i + 1) % 4],
    section: beamSection,
    ...(pinned
      ? { releases: { start: { r1: true, r2: true, r3: true }, end: { r2: true, r3: true } } }
      : {}),
  }));

const membrane = (over: Partial<ShellArea> = {}): ShellArea => ({
  id: "A",
  nodeIds: ids,
  section,
  type: "membrane",
  ...over,
});

const slab = (over: Partial<FeaModel> = {}, pinned = true): FeaModel => ({
  nodes: flat(),
  members: edgeBeams(ids, pinned),
  restraints: ids.map((nodeId) => ({ nodeId, ux: true, uy: true, uz: true })),
  shells: [membrane()],
  loadCases: [{ id: "L" }],
  areaLoads: [{ loadCase: "L", areaId: "A", direction: "Z", q: -5 }],
  ...over,
});

const sumFz = (r: ReturnType<typeof analyze>, id = "L") =>
  r.cases[id].reactions.reduce((s, x) => s + x.fz, 0);

/** Largest bending moment (kN·m) anywhere along a member, about either local axis. */
const peakMoment = (r: ReturnType<typeof analyze>, memberId: string, id = "L") => {
  const d = r.cases[id].memberDiagrams.find((m) => m.memberId === memberId)!;
  const { M2, M3 } = d.extremes;
  return Math.max(...[M2.max, M2.min, M3.max, M3.min].map((e) => Math.abs(e.value)));
};

const warningsOf = (r: ReturnType<typeof analyze>) =>
  r.warnings.filter((w) => w.reference === REFERENCE);

describe("out-of-plane loads on a membrane area", () => {
  it("gives each simply supported edge beam the triangular load: M = wL²/12 = 45 kN·m", () => {
    // peak w = q·L/2 = 15 kN/m, so M = 15 · 6² / 12 and each beam carries 45 kN
    const r = analyze(slab());
    for (const id of ids) expect(peakMoment(r, `B${id}`)).toBeCloseTo(45, 3);
    expect(sumFz(r)).toBeCloseTo(180, 3);
  });

  it("warns that the load was passed to the beams", () => {
    const warnings = warningsOf(analyze(slab()));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('"A"');
    expect(warnings[0].message).toContain("tributary area");
  });

  it("matches the same slab as a two-way null area on continuous beams", () => {
    const shell = analyze(slab({}, false));
    const nullArea = analyze(
      slab({ shells: [], areas: [{ id: "A", nodeIds: ids, distribution: "twoWay" }] }, false),
    );
    for (const id of ids) {
      expect(peakMoment(shell, `B${id}`)).toBeCloseTo(peakMoment(nullArea, `B${id}`), 6);
    }
    expect(sumFz(shell)).toBeCloseTo(sumFz(nullArea), 6);
  });

  it("transfers self-weight, with modifiers.weight: 4.8 kN/m² gives 43.2 kN·m", () => {
    const r = analyze(slab({ loadCases: [{ id: "L", selfWeight: 1 }], areaLoads: [] }));
    expect(peakMoment(r, "Ba")).toBeCloseTo((4.8 * 3 * 36) / 12, 3);
    expect(sumFz(r)).toBeCloseTo(4.8 * 36, 3);

    const half = analyze(
      slab({
        shells: [membrane({ modifiers: { weight: 0.5 } })],
        loadCases: [{ id: "L", selfWeight: 1 }],
        areaLoads: [],
      }),
    );
    expect(sumFz(half)).toBeCloseTo(2.4 * 36, 3);
  });

  it("does not depend on the order of the corners", () => {
    const reversed = [...ids].reverse();
    const r = analyze(slab({ shells: [membrane({ nodeIds: reversed })] }));
    expect(peakMoment(r, "Ba")).toBeCloseTo(45, 3);
    expect(sumFz(r)).toBeCloseTo(180, 3);
  });

  it("superposes in combinations", () => {
    const r = analyze(slab({ combinations: [{ id: "U", terms: [{ case: "L", factor: 1.4 }] }] }));
    expect(sumFz({ ...r, cases: r.combinations }, "U")).toBeCloseTo(252, 3);
  });

  it("keeps the in-plane part on an inclined membrane: 3-4-5 slope, normal part 0.8 q", () => {
    // 6 × 6 m true size, rising 3.6 m over a 4.8 m run: cos θ = 0.8, so the peak normal line
    // load on the level beam is 5 · 0.8 · 3 = 12 kN/m and M = 12 · 6² / 12 = 36 kN·m
    const nodes: FeaNode[] = [
      { id: "a", x: 0, y: 0, z: 0 },
      { id: "b", x: 6000, y: 0, z: 0 },
      { id: "c", x: 6000, y: 4800, z: 3600 },
      { id: "d", x: 0, y: 4800, z: 3600 },
    ];
    const r = analyze(slab({ nodes }));
    const d = r.cases.L.memberDiagrams.find((m) => m.memberId === "Ba")!;
    const mid = d.stations[Math.floor(d.stations.length / 2)];
    expect(Math.hypot(mid.M2, mid.M3)).toBeCloseTo(36, 3);
    expect(sumFz(r)).toBeCloseTo(180, 3);
  });

  it("leaves in-plane gravity on a vertical membrane wall, with no warning", () => {
    const nodes: FeaNode[] = [
      { id: "a", x: 0, y: 0, z: 0 },
      { id: "b", x: 6000, y: 0, z: 0 },
      { id: "c", x: 6000, y: 0, z: 3000 },
      { id: "d", x: 0, y: 0, z: 3000 },
    ];
    const r = analyze(
      slab({ nodes, loadCases: [{ id: "L", selfWeight: 1 }], areaLoads: [] }, false),
    );
    expect(warningsOf(r)).toEqual([]);
    expect(r.cases.L.memberDiagrams.every((m) => m.extremes.M3.max.value === 0)).toBe(true);
  });

  it("warns and keeps the load at the nodes when an edge has no beam", () => {
    const r = analyze(slab({ members: edgeBeams(ids, true).slice(0, 3) }));
    const warnings = warningsOf(r);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("at its nodes");
    expect(peakMoment(r, "Ba")).toBe(0);
    expect(sumFz(r)).toBeCloseTo(180, 3);
  });

  it("applies when a node on an edge splits the area although no mesh was asked for", () => {
    const nodes = [...flat(), { id: "m", x: 3000, y: 0, z: 0 }];
    const members: Member[] = [
      { id: "Bam", startNodeId: "a", endNodeId: "m", section: beamSection },
      { id: "Bmb", startNodeId: "m", endNodeId: "b", section: beamSection },
      ...edgeBeams(ids, false).slice(1),
    ];
    const r = analyze(slab({ nodes, members }));
    expect(r.mesh!.shells.length).toBeGreaterThan(1);
    expect(warningsOf(r)[0].message).toContain("tributary area");
    expect(sumFz(r)).toBeCloseTo(180, 3);
  });

  it.each([
    [2, 1],
    [1, 3],
    [2, 2],
    [4, 4],
  ])("gives a %i × %i meshed membrane the same 45 kN·m on every beam", (n1, n2) => {
    const r = analyze(slab({ shells: [membrane({ mesh: { divisions: [n1, n2] } })] }, false));
    for (const id of ids) expect(peakMoment(r, `B${id}`)).toBeCloseTo(45, 3);
    expect(sumFz(r)).toBeCloseTo(180, 3);
    expect(warningsOf(r)[0].message).toContain("tributary area");
  });

  it("carries gravity on a meshed inclined membrane, the in-plane part staying on it", () => {
    const nodes: FeaNode[] = [
      { id: "a", x: 0, y: 0, z: 0 },
      { id: "b", x: 6000, y: 0, z: 0 },
      { id: "c", x: 6000, y: 4800, z: 3600 },
      { id: "d", x: 0, y: 4800, z: 3600 },
    ];
    const shells = [membrane({ mesh: { divisions: [4, 4] } })];
    expect(sumFz(analyze(slab({ nodes, shells }, false)))).toBeCloseTo(180, 3);
  });

  it("still throws 332 for a meshed membrane with no member along an edge", () => {
    const model = slab(
      {
        members: edgeBeams(ids, false).slice(0, 3),
        shells: [membrane({ mesh: { divisions: [4, 4] } })],
      },
      false,
    );
    expect(() => analyze(model)).toThrow(FeaError);
    try {
      analyze(model);
    } catch (e) {
      expect((e as FeaError).code).toBe(332);
    }
  });

  it("does not change shell or plate areas", () => {
    const r = analyze(
      slab({
        shells: [{ id: "A", nodeIds: ids, section, mesh: { divisions: [2, 2] } }],
      }),
    );
    expect(warningsOf(r)).toEqual([]);
  });
});
