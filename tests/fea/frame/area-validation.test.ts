import type { FrameModel, NullArea } from "@app-fea/frame/types/model.type";
import { validateFrameModel } from "@app-fea/frame/validation/validate-model";

const sec = { E: 200000, G: 80000, A: 5000, I22: 8e7, I33: 8e7, J: 1e7 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

/** Casts a deliberately malformed value past the types, as untyped UI input would arrive. */
const bad = <T>(value: unknown) => value as T;

/** A 6 m × 4 m bay at z = 3000 with beams on all four sides; node 5 is off the plane. */
const model = (over: Partial<FrameModel> = {}): FrameModel => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 3000 },
    { id: 2, x: 6000, y: 0, z: 3000 },
    { id: 3, x: 6000, y: 4000, z: 3000 },
    { id: 4, x: 0, y: 4000, z: 3000 },
    { id: 5, x: 3000, y: 2000, z: 3500 },
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
  areaLoads: [{ loadCase: "D", areaId: "S1", direction: "Z", q: -5 }],
  ...over,
});
const withArea = (area: Partial<NullArea>, over: Partial<FrameModel> = {}) =>
  model({ areas: [{ id: "S1", nodeIds: [1, 2, 3, 4], distribution: "twoWay", ...area }], ...over });
const issues = (m: FrameModel) => validateFrameModel(m).map((i) => [i.code, i.details]);

describe("null area validation", () => {
  it("accepts two-way, one-way and cantilever areas with their supports", () => {
    expect(issues(model())).toEqual([]);
    expect(issues(withArea({ distribution: "oneWay", supportEdges: [0, 2] }))).toEqual([]);
    expect(issues(withArea({ distribution: "cantilever", supportEdges: [3] }))).toEqual([]);
    expect(
      issues(withArea({ nodeIds: [1, 2, 3] }, { members: model().members.slice(0, 2) })),
    ).toEqual([
      [316, { areaId: "S1", edge: 2 }], // 3 → 1 has no member
    ]);
  });

  it("only needs members on the edges that carry load", () => {
    const onlyLongBeams = model().members.filter((m) => m.id === "12" || m.id === "34");
    expect(
      issues(
        withArea({ distribution: "oneWay", supportEdges: [0, 2] }, { members: onlyLongBeams }),
      ),
    ).toEqual([]);
    expect(
      issues(
        withArea({ distribution: "cantilever", supportEdges: [0] }, { members: onlyLongBeams }),
      ),
    ).toEqual([]);
  });

  it("follows an edge split by an intermediate node", () => {
    const m = model();
    m.nodes.push({ id: 6, x: 2500, y: 0, z: 3000 });
    m.members = [
      { id: "16", startNodeId: 1, endNodeId: 6, section: sec },
      { id: "26", startNodeId: 2, endNodeId: 6, section: sec },
      ...m.members.slice(1),
    ];
    expect(issues(m)).toEqual([]);
    m.members = m.members.filter((x) => x.id !== "26");
    expect(issues(m)).toEqual([[316, { areaId: "S1", edge: 0 }]]);
  });

  it.each<[string, Partial<NullArea>]>([
    ["five nodes", { nodeIds: [1, 2, 3, 4, 5] }],
    ["a repeated node", { nodeIds: [1, 2, 2, 4] }],
    ["a node off the plane", { nodeIds: [1, 2, 5, 4] }],
    ["corners out of order (crossed)", { nodeIds: [1, 3, 2, 4] }],
    ["a missing nodeIds list", { nodeIds: bad(undefined) }],
  ])("315 for %s", (_, area) => {
    expect(issues(withArea(area))).toEqual([[315, { areaId: "S1", field: "nodeIds" }]]);
  });

  it("315 for a cantilever that is not a rectangle", () => {
    const m = withArea({ distribution: "cantilever", supportEdges: [0] });
    m.nodes[2] = { id: 3, x: 7000, y: 4000, z: 3000 };
    m.nodes[3] = { id: 4, x: 1000, y: 4000, z: 3000 };
    expect(issues(m)).toEqual([[315, { areaId: "S1", field: "nodeIds" }]]);
  });

  it.each<[string, Partial<NullArea>]>([
    ["two-way with supportEdges", { supportEdges: [0, 2] }],
    ["one-way without supportEdges", { distribution: "oneWay" }],
    ["one-way with adjacent free edges", { distribution: "oneWay", supportEdges: [0, 1] }],
    ["one-way with every edge supported", { distribution: "oneWay", supportEdges: [0, 1, 2, 3] }],
    ["one-way with an edge index out of range", { distribution: "oneWay", supportEdges: [0, 4] }],
    ["cantilever with two edges", { distribution: "cantilever", supportEdges: [0, 2] }],
  ])("317 for %s", (_, area) => {
    expect(issues(withArea(area))).toEqual([[317, { areaId: "S1", field: "supportEdges" }]]);
  });

  it("317 for a cantilever load along its support edge; across it or normal to it is fine", () => {
    const cantilever = { distribution: "cantilever" as const, supportEdges: [0] }; // edge 0 along X
    const load = (direction: "X" | "Y" | "Z" | "3") => ({
      areaLoads: [{ loadCase: "D", areaId: "S1", direction, q: 1 }],
    });
    expect(issues(withArea(cantilever, load("X")))).toEqual([
      [317, { loadCaseId: "D", areaId: "S1", field: "direction" }],
    ]);
    for (const direction of ["Y", "Z", "3"] as const) {
      expect(issues(withArea(cantilever, load(direction)))).toEqual([]);
    }
  });

  it("302 for an unknown node or area, 303 for a duplicate area id", () => {
    expect(issues(withArea({ nodeIds: [1, 2, 3, 99] }))).toEqual([
      [302, { areaId: "S1", field: "nodeIds" }],
    ]);
    expect(
      issues(model({ areaLoads: [{ loadCase: "D", areaId: "nope", direction: "Z", q: -5 }] })),
    ).toEqual([[302, { loadCaseId: "D", areaId: "nope", field: "areaId" }]]);
    const twice = model();
    twice.areas = [...twice.areas!, ...twice.areas!];
    expect(issues(twice)).toEqual([[303, { areaId: "S1", field: "id" }]]);
  });

  it("309 for an unknown load case, 314 for bad values", () => {
    expect(
      issues(
        model({
          areas: [{ id: "S1", nodeIds: [1, 2, 3, 4], distribution: bad("two-way") }],
          areaLoads: [
            { loadCase: "X", areaId: "S1", direction: "Z", q: -5 },
            { loadCase: "D", areaId: "S1", direction: bad("1"), q: -5 },
            { loadCase: "D", areaId: "S1", direction: "Z", q: Number.NaN },
          ],
        }),
      ),
    ).toEqual([
      [314, { areaId: "S1", field: "distribution" }],
      [309, { loadCaseId: "X", areaId: "S1", field: "loadCase" }],
      [314, { loadCaseId: "D", areaId: "S1", field: "direction" }],
      [314, { loadCaseId: "D", areaId: "S1", field: "q" }],
    ]);
  });

  it("names the area and edge in the message", () => {
    const [issue] = validateFrameModel(model({ members: model().members.slice(1) }));
    expect(issue.message).toContain('[area "S1", edge 0]');
  });
});
