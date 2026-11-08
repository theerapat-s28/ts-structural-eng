import type { SectionProperties } from "@app-core/types/section-properties.type";
import { meshConnectivity } from "@app-fea/analysis/mesh/mesh-connectivity";
import { analyze } from "@app-fea/analysis/solver/analyze";
import type { FeaModel } from "@app-fea/analysis/types/model.type";
import type { Member } from "@app-fea/frame/types/model.type";
import type { FeaNode } from "@app-fea/shared/types/model.type";
import type { ShellArea, ShellSection } from "@app-fea/shell/types/model.type";

const concrete: ShellSection = { thickness: 200, E: 30000, nu: 0.2 };
const beam: SectionProperties = { E: 30000, G: 12500, A: 1.2e5, I22: 9e8, I33: 3.6e9, J: 1e9 };
const pin = { ux: true, uy: true, uz: true };

/**
 * A 6 × 4 m slab S (S1 → S4, corner 0 at the origin) meshed at 1000 mm into 6 × 4 elements,
 * pinned at its corners, with an edge beam B along its first edge.
 */
const slab = (
  over: { nodes?: FeaNode[]; members?: Member[]; shells?: ShellArea[] } = {},
  b: Partial<Member> = {},
): FeaModel => ({
  nodes: [
    { id: "S1", x: 0, y: 0, z: 0 },
    { id: "S2", x: 6000, y: 0, z: 0 },
    { id: "S3", x: 6000, y: 4000, z: 0 },
    { id: "S4", x: 0, y: 4000, z: 0 },
    ...(over.nodes ?? []),
  ],
  members: [
    { id: "B", startNodeId: "S1", endNodeId: "S2", section: beam, ...b },
    ...(over.members ?? []),
  ],
  shells: [
    {
      id: "S",
      nodeIds: ["S1", "S2", "S3", "S4"],
      section: concrete,
      mesh: { maxSize: 1000 },
    },
    ...(over.shells ?? []),
  ],
  restraints: ["S1", "S2", "S3", "S4"].map((nodeId) => ({ nodeId, ...pin })),
  loadCases: [{ id: "D" }],
  areaLoads: [{ loadCase: "D", areaId: "S", direction: "Z", q: -5 }],
});

describe("meshConnectivity — generated nodes and what connects at them", () => {
  it("lists only the generated nodes, with their elements, areas and members", () => {
    const c = meshConnectivity(slab());
    // 6 × 4 elements: (5 + 3) × 2 edge nodes and 5 × 3 interior nodes
    expect(c.nodes).toHaveLength(31);
    expect(c.shells).toHaveLength(24);
    const modelIds = new Set(slab().nodes.map((n) => n.id));
    expect(c.nodes.some((n) => modelIds.has(n.id))).toBe(false);

    // the edge beam passes through the 5 generated nodes along its edge
    const onBeam = c.nodes.filter((n) => n.members.length > 0);
    expect(onBeam.map((n) => n.id)).toEqual([1, 2, 3, 4, 5].map((k) => `S1~S2:${k}`));
    expect(onBeam.map((n) => n.members)).toEqual(
      [1000, 2000, 3000, 4000, 5000].map((x) => [{ memberId: "B", x }]),
    );
    expect(onBeam[0]).toMatchObject({ x: 1000, y: 0, z: 0, areaIds: ["S"] });
    expect(onBeam[0].shellIds).toEqual(["S:0,0", "S:1,0"]);

    // an interior node is a corner of four elements and of no member
    const interior = c.nodes.find((n) => n.id === "S:1,1")!;
    expect(interior.shellIds).toEqual(["S:0,0", "S:1,0", "S:0,1", "S:1,1"]);
    expect(interior.members).toEqual([]);
    expect(c.disconnectedNodes).toEqual([]);
    expect(c.failedAreaIds).toEqual([]);
    expect(c.warnings).toEqual([]);
  });

  it("matches the mesh and warnings of analyze", () => {
    const model = slab({
      nodes: [
        { id: "C1", x: 3000, y: 1500, z: 0 }, // inside the slab, off its mesh lines
        { id: "C0", x: 3000, y: 1500, z: -3000 },
      ],
      members: [{ id: "C", startNodeId: "C0", endNodeId: "C1", section: beam }],
    });
    model.restraints.push({ nodeId: "C0", ...pin, rx: true, ry: true, rz: true });
    const result = analyze(model);
    const c = meshConnectivity(model);
    expect(c.nodes.map(({ id, x, y, z }) => ({ id, x, y, z }))).toEqual(result.mesh!.nodes);
    expect(c.shells).toEqual(result.mesh!.shells);
    expect(c.disconnectedNodes).toEqual([{ nodeId: "C1", areaId: "S" }]);
    expect(c.warnings).toEqual(result.warnings);
  });

  it("splits a member along a meshed edge even when it opts out of intermediate nodes", () => {
    const c = meshConnectivity(slab({}, { connectIntermediateNodes: false }));
    expect(c.nodes.filter((n) => n.members.length > 0)).toHaveLength(5);
  });

  it("names both areas at a node on a shared edge, and a beam that only covers part of it", () => {
    const c = meshConnectivity(
      slab({
        nodes: [
          { id: "S5", x: 6000, y: 8000, z: 0 },
          { id: "S6", x: 0, y: 8000, z: 0 },
          { id: "M", x: 3000, y: 4000, z: 0 }, // a secondary beam ends mid-edge
        ],
        members: [{ id: "E", startNodeId: "M", endNodeId: "S3", section: beam }],
        shells: [{ id: "T", nodeIds: ["S4", "S3", "S5", "S6"], section: concrete }],
      }),
    );
    // the shared edge S3–S4 is cut at model node M: 2 generated nodes on each side of it
    const shared = c.nodes.filter((n) => n.areaIds.length === 2);
    expect(shared).toHaveLength(4);
    expect(shared.every((n) => n.shellIds.length === 4)).toBe(true);
    const onE = shared.filter((n) => n.members.some((m) => m.memberId === "E"));
    expect(onE.map((n) => n.members[0].x)).toEqual([1000, 2000]);
  });

  it("reports an area whose generated ids clash with a model node", () => {
    const c = meshConnectivity(slab({ nodes: [{ id: "S1~S2:1", x: 0, y: 0, z: 5000 }] }));
    expect(c.failedAreaIds).toEqual(["S"]);
  });

  it("checks a model that is still being edited, skipping what is invalid", () => {
    const model = slab({
      nodes: [
        { id: "X1", x: Number.NaN, y: 0, z: 0 },
        { id: "X2", x: 0, y: 0, z: 1000 },
      ],
      members: [
        { id: "U", startNodeId: "S1", endNodeId: "missing", section: beam },
        { id: "Z", startNodeId: "S1", endNodeId: "S1", section: beam },
      ],
      shells: [
        { id: "A", nodeIds: ["S1", "S2", "X1", "X2"], section: concrete }, // invalid corner
        { id: "U", nodeIds: ["S1", "missing", "S3", "S4"], section: concrete },
        {
          id: "M",
          nodeIds: ["S1", "S2", "X2", "S4"],
          section: concrete,
          mesh: { maxSize: -1 },
        },
      ],
    });
    const c = meshConnectivity(model);
    expect(c.nodes).toHaveLength(31);
    expect(c.shells.every((s) => s.areaId === "S")).toBe(true);
    expect(meshConnectivity({ nodes: [], restraints: [], loadCases: [] })).toEqual({
      nodes: [],
      shells: [],
      disconnectedNodes: [],
      failedAreaIds: [],
      warnings: [],
    });
  });
});
