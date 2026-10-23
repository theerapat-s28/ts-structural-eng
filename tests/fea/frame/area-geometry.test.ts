import {
  areaPlane,
  clipPolygon,
  isRectangle,
  resolveAreaSupports,
  type AreaPlane,
  type Vec3,
} from "@app-fea/frame/area/area-geometry";
import { edgeMemberChain, memberAdjacency } from "@app-fea/frame/area/edge-members";
import type { FrameId, Member } from "@app-fea/frame/types/model.type";

const plane = (points: Vec3[]): AreaPlane => {
  const result = areaPlane(points);
  if ("problem" in result) throw new Error(`unexpected problem: ${result.problem}`);
  return result;
};
const problem = (points: Vec3[]) => {
  const result = areaPlane(points);
  return "problem" in result ? result.problem : undefined;
};

const rectangle: Vec3[] = [
  [0, 0, 3000],
  [6000, 0, 3000],
  [6000, 4000, 3000],
  [0, 4000, 3000],
];

describe("areaPlane", () => {
  it("gives local 3 = +Z for corners counter-clockwise seen from above, and the true area", () => {
    const p = plane(rectangle);
    expect(p.normal[2]).toBeCloseTo(1, 12);
    expect(p.area).toBeCloseTo(24e6, 3);
    expect(p.size).toBe(6000);
    expect(p.u).toEqual([1, 0, 0]);
    expect(p.corners[2][0]).toBeCloseTo(6000, 9);
    expect(p.corners[2][1]).toBeCloseTo(4000, 9);
  });

  it("gives local 3 = −Z for corners clockwise seen from above", () => {
    expect(plane([...rectangle].reverse()).normal[2]).toBeCloseTo(-1, 12);
  });

  it("handles an inclined ramp: the normal is perpendicular to the slope", () => {
    // rises 1500 mm over 3000 mm in Y
    const p = plane([
      [0, 0, 0],
      [4000, 0, 0],
      [4000, 3000, 1500],
      [0, 3000, 1500],
    ]);
    const k = Math.hypot(3000, 1500);
    expect(p.normal[0]).toBeCloseTo(0, 12);
    expect(p.normal[1]).toBeCloseTo(-1500 / k, 12);
    expect(p.normal[2]).toBeCloseTo(3000 / k, 12);
    expect(p.area).toBeCloseTo(4000 * k, 3);
  });

  it.each<[string, Vec3[], string]>([
    [
      "two corners",
      [
        [0, 0, 0],
        [1000, 0, 0],
      ],
      "nodeCount",
    ],
    [
      "a repeated corner",
      [
        [0, 0, 0],
        [0, 0, 0],
        [1000, 1000, 0],
      ],
      "repeatedNode",
    ],
    [
      "a triangle in a line",
      [
        [0, 0, 0],
        [1000, 0, 0],
        [3000, 0, 0],
      ],
      "degenerate",
    ],
    [
      "a warped quad",
      [
        [0, 0, 0],
        [6000, 0, 0],
        [6000, 4000, 10],
        [0, 4000, 0],
      ],
      "nonPlanar",
    ],
    [
      "three corners in line",
      [
        [0, 0, 0],
        [2000, 0, 0],
        [4000, 0, 0],
        [2000, 3000, 0],
      ],
      "nonConvex",
    ],
    [
      "a reflex corner",
      [
        [0, 0, 0],
        [4000, 0, 0],
        [1000, 1000, 0],
        [0, 4000, 0],
      ],
      "nonConvex",
    ],
  ])("rejects %s", (_, points, expected) => {
    expect(problem(points)).toBe(expected);
  });

  it("rejects a crossed (bow-tie) quad", () => {
    expect(
      problem([
        [0, 0, 0],
        [4000, 0, 0],
        [0, 3000, 0],
        [4000, 3000, 0],
      ]),
    ).toBeDefined();
  });
});

describe("isRectangle", () => {
  it("accepts a rectangle and rejects a parallelogram and a triangle", () => {
    expect(isRectangle(plane(rectangle))).toBe(true);
    expect(
      isRectangle(
        plane([
          [0, 0, 0],
          [6000, 0, 0],
          [7000, 4000, 0],
          [1000, 4000, 0],
        ]),
      ),
    ).toBe(false);
    expect(isRectangle(plane(rectangle.slice(0, 3)))).toBe(false);
  });
});

describe("resolveAreaSupports", () => {
  const rect = plane(rectangle);
  // parallel edges 0 (bottom, 6 m) and 2 (top, 3 m); legs 1 and 3 not parallel
  const trapezoid = plane([
    [0, 0, 0],
    [6000, 0, 0],
    [4500, 3000, 0],
    [1500, 3000, 0],
  ]);
  const triangle = plane(rectangle.slice(0, 3));

  it("two-way loads every edge and takes no supportEdges", () => {
    expect(resolveAreaSupports(rect, "twoWay", undefined)).toEqual({ loadedEdges: [0, 1, 2, 3] });
    expect(resolveAreaSupports(rect, "twoWay", [0, 2])).toBeNull();
  });

  it("one-way spans parallel to the unsupported edges", () => {
    const longEdges = resolveAreaSupports(rect, "oneWay", [2, 0])!;
    expect(longEdges.loadedEdges).toEqual([0, 2]);
    expect(longEdges.span![0]).toBeCloseTo(0, 12);
    expect(longEdges.span![1]).toBeCloseTo(1, 12);
    // a trapezoid between its legs spans parallel to its parallel edges
    expect(resolveAreaSupports(trapezoid, "oneWay", [1, 3])!.span![0]).toBeCloseTo(1, 12);
    // a triangle supported on two edges spans parallel to the third
    expect(resolveAreaSupports(triangle, "oneWay", [1, 2])!.span![0]).toBeCloseTo(1, 12);
  });

  it("one-way rejects strips that would hit an unsupported edge, or no unsupported edge", () => {
    expect(resolveAreaSupports(trapezoid, "oneWay", [0, 2])).toBeNull(); // legs not parallel
    expect(resolveAreaSupports(rect, "oneWay", [0, 1])).toBeNull(); // adjacent free edges
    expect(resolveAreaSupports(triangle, "oneWay", [0])).toBeNull();
    expect(resolveAreaSupports(rect, "oneWay", [0, 1, 2, 3])).toBeNull();
  });

  it("rejects malformed supportEdges", () => {
    for (const bad of [undefined, [], [4], [-1], [1.5], [0, 0], "0"]) {
      expect(resolveAreaSupports(rect, "oneWay", bad)).toBeNull();
    }
  });

  it("cantilever takes exactly one edge", () => {
    expect(resolveAreaSupports(rect, "cantilever", [1])).toEqual({ loadedEdges: [1] });
    expect(resolveAreaSupports(rect, "cantilever", [0, 2])).toBeNull();
  });
});

describe("clipPolygon", () => {
  const square: [number, number][] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ];
  it("keeps the side a·p ≤ c, cutting the crossed edges", () => {
    expect(clipPolygon(square, [1, 0], 1)).toEqual([
      [0, 0],
      [1, 0],
      [1, 2],
      [0, 2],
    ]);
  });
  it("returns everything or nothing when the line misses", () => {
    expect(clipPolygon(square, [1, 0], 5)).toEqual(square);
    expect(clipPolygon(square, [1, 0], -1)).toEqual([]);
  });
});

describe("edgeMemberChain", () => {
  const sec = { E: 200000, G: 80000, A: 5000, I22: 8e7, I33: 8e7, J: 1e7 };
  const coordinates: Record<string, Vec3> = {
    A: [0, 0, 0],
    M: [2500, 0, 0], // a secondary beam frames in here
    B: [6000, 0, 0],
    S: [2500, 3000, 0], // far end of the secondary beam
  };
  const position = (id: FrameId) => coordinates[id as string];
  const member = (id: string, startNodeId: string, endNodeId: string): Member => ({
    id,
    startNodeId,
    endNodeId,
    section: sec,
  });

  it("splits the edge at intermediate nodes and flags reversed members", () => {
    const adjacency = memberAdjacency([
      member("AM", "A", "M"),
      member("BM", "B", "M"), // runs against the edge
      member("MS", "M", "S"), // not on the edge
    ]);
    const chain = edgeMemberChain("A", "B", position, adjacency)!;
    expect(chain.map((s) => [s.member.id, s.from, s.to, s.reversed])).toEqual([
      ["AM", 0, 2500, false],
      ["BM", 2500, 6000, true],
    ]);
  });

  it("returns null when part of the edge has no member", () => {
    const adjacency = memberAdjacency([member("AM", "A", "M"), member("MS", "M", "S")]);
    expect(edgeMemberChain("A", "B", position, adjacency)).toBeNull();
  });

  it("takes the nearest node ahead when a full-length member overlaps the split ones", () => {
    const adjacency = memberAdjacency([
      member("AB", "A", "B"),
      member("AM", "A", "M"),
      member("MB", "M", "B"),
    ]);
    expect(edgeMemberChain("A", "B", position, adjacency)!.map((s) => s.member.id)).toEqual([
      "AM",
      "MB",
    ]);
  });
});
