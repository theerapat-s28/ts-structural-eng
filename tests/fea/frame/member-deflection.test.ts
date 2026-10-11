import type { SectionProperties } from "@app-core/types/section-properties.type";
import type { MemberStation } from "@app-fea/frame/types/results.type";
import { analyzeSingleCase, type SingleCaseModel } from "./single-case";

const E = 200000; // MPa
const I33 = 8e7; // mm⁴
const I22 = 2e7; // mm⁴
const A = 5000; // mm²
const section: SectionProperties = { E, G: 80000, A, I22, I33, J: 1e7 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const pinA = { ux: true, uy: true, uz: true, rx: true };
const roller = { uy: true, uz: true };

const at = (stations: MemberStation[], x: number) => {
  const s = stations.find((st) => st.x === x);
  if (!s) throw new Error(`no station at x = ${x}`);
  return s;
};

/** Single member along +X from (0,0,0) to (L,0,0). */
const beam = (
  L: number,
  restraints: SingleCaseModel["restraints"],
  rest: Partial<SingleCaseModel> = {},
): SingleCaseModel => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: L, y: 0, z: 0 },
  ],
  members: [{ id: "m", startNodeId: 1, endNodeId: 2, section }],
  restraints,
  ...rest,
});

describe("member deflection — closed-form solutions", () => {
  it("simply supported UDL: midspan 5wL⁴/384EI from a single member, no mid node", () => {
    const L = 6000;
    const w = 10; // kN/m = N/mm
    const r = analyzeSingleCase(
      beam(
        L,
        [
          { nodeId: 1, ...pinA },
          { nodeId: 2, ...roller },
        ],
        {
          memberLoads: [{ type: "udl", memberId: "m", direction: "Z", w: -w }],
        },
      ),
    );
    const d = r.memberDiagrams[0];
    const expected = (-5 * w * L ** 4) / (384 * E * I33); // −10.546875 mm
    expect(at(d.stations, 3000).u2).toBeCloseTo(expected, 4);
    expect(at(d.stations, 3000).uz).toBeCloseTo(expected, 4); // local 2 = +Z
    expect(at(d.stations, 0).u2).toBeCloseTo(0, 6);
    expect(at(d.stations, 6000).u2).toBeCloseTo(0, 6);
    expect(d.extremes.u2.min.value).toBeCloseTo(expected, 4);
    expect(d.extremes.u2.min.x).toBeCloseTo(3000, 6);
    // quarter point: w·x(L³ − 2Lx² + x³)/24EI
    const x = 1500;
    expect(at(d.stations, x).u2).toBeCloseTo(
      (-w * x * (L ** 3 - 2 * L * x ** 2 + x ** 3)) / (24 * E * I33),
      4,
    );
  });

  it("cantilever tip load: P·x²(3L − x)/6EI at every station, matching the tip node", () => {
    const L = 3000;
    const P = 10e3; // N
    const r = analyzeSingleCase(
      beam(L, [{ nodeId: 1, ...fixed }], { nodalLoads: [{ nodeId: 2, fz: -P / 1e3 }] }),
    );
    for (const s of r.memberDiagrams[0].stations) {
      expect(s.u2).toBeCloseTo((-P * s.x ** 2 * (3 * L - s.x)) / (6 * E * I33), 4);
    }
    const tip = at(r.memberDiagrams[0].stations, L);
    expect(tip.uz).toBeCloseTo(r.nodalDisplacements[1].uz, 5);
  });

  it("bending in the 1–3 plane uses I22 and the R2 = −u3' sign (load along global −Y)", () => {
    const L = 6000;
    const w = 4;
    const r = analyzeSingleCase(
      beam(
        L,
        [
          { nodeId: 1, ...pinA },
          { nodeId: 2, ...roller },
        ],
        {
          memberLoads: [{ type: "udl", memberId: "m", direction: "Y", w: -w }],
        },
      ),
    );
    const mid = at(r.memberDiagrams[0].stations, 3000);
    const delta = (5 * w * L ** 4) / (384 * E * I22);
    expect(mid.u3).toBeCloseTo(delta, 4); // local 3 = −Y, so the load acts along +3
    expect(mid.uy).toBeCloseTo(-delta, 4);
    expect(mid.uz).toBeCloseTo(0, 6);
  });

  it("axial load along the member: u1 = q(Lx − x²/2)/EA", () => {
    const L = 4000;
    const q = 5; // N/mm
    const r = analyzeSingleCase(
      beam(L, [{ nodeId: 1, ...fixed }], {
        memberLoads: [{ type: "udl", memberId: "m", direction: "1", w: q }],
      }),
    );
    for (const s of r.memberDiagrams[0].stations) {
      expect(s.u1).toBeCloseTo((q * (L * s.x - s.x ** 2 / 2)) / (E * A), 6);
    }
  });
});

describe("member deflection — end releases", () => {
  it("a member hinged at both ends between fixed nodes deflects as simply supported", () => {
    const L = 6000;
    const w = 10;
    const model = beam(
      L,
      [
        { nodeId: 1, ...fixed },
        { nodeId: 2, ...fixed },
      ],
      {
        memberLoads: [{ type: "udl", memberId: "m", direction: "Z", w: -w }],
      },
    );
    model.members[0].releases = { start: { r3: true }, end: { r3: true } };
    const r = analyzeSingleCase(model);
    const d = r.memberDiagrams[0];
    // the nodes cannot rotate, but the member ends do: the curve must not be clamped
    expect(r.nodalDisplacements.every((n) => n.ry === 0)).toBe(true);
    expect(at(d.stations, 3000).u2).toBeCloseTo((-5 * w * L ** 4) / (384 * E * I33), 4);
    expect(r.memberEndForces[0].start.m3).toBeCloseTo(0, 6);
  });

  it("a cantilever with a hinged extension: the hinge kinks the curve", () => {
    // A —(m1, fixed at A)— B —(m2, hinged at B)— C on a roller; tip-side load only on m2
    const L = 3000;
    const P = 20; // kN at mid-span of m2
    const r = analyzeSingleCase({
      nodes: [
        { id: "A", x: 0, y: 0, z: 0 },
        { id: "B", x: L, y: 0, z: 0 },
        { id: "C", x: 2 * L, y: 0, z: 0 },
      ],
      members: [
        { id: 1, startNodeId: "A", endNodeId: "B", section },
        { id: 2, startNodeId: "B", endNodeId: "C", section, releases: { start: { r3: true } } },
      ],
      restraints: [
        { nodeId: "A", ...fixed },
        { nodeId: "C", uy: true, uz: true },
      ],
      memberLoads: [{ type: "point", memberId: 2, direction: "Z", P: -P, a: L / 2 }],
    });
    const m2 = r.memberDiagrams[1];
    const vB = r.nodalDisplacements[1].uz;
    // m2 ends follow the nodes; between them it is a simply supported span on a sinking support
    expect(at(m2.stations, 0).u2).toBeCloseTo(vB, 5);
    expect(at(m2.stations, L).u2).toBeCloseTo(0, 6);
    const Pn = P * 1e3;
    const midspan = vB / 2 - (Pn * L ** 3) / (48 * E * I33);
    expect(at(m2.stations, L / 2).u2).toBeCloseTo(midspan, 4);
    // cantilever m1 carries the hinge reaction P/2 at its tip
    expect(vB).toBeCloseTo((-(Pn / 2) * L ** 3) / (3 * E * I33), 4);
  });
});

describe("member deflection — independent check against a subdivided model", () => {
  // Simply supported 6 m beam: partial UDL 15 kN/m on 1.0–4.0 m and a 40 kN point load at 2.2 m.
  // Single member: read stations at 1.5, 3.0, 4.5 m. Oracle: same beam with nodes at those points.
  const single = analyzeSingleCase(
    beam(
      6000,
      [
        { nodeId: 1, ...pinA },
        { nodeId: 2, ...roller },
      ],
      {
        memberLoads: [
          { type: "udl", memberId: "m", direction: "Z", w: -15, start: 1000, end: 4000 },
          { type: "point", memberId: "m", direction: "Z", P: -40, a: 2200 },
        ],
      },
    ),
  );
  const split = analyzeSingleCase({
    nodes: [0, 1500, 3000, 4500, 6000].map((x, i) => ({ id: i, x, y: 0, z: 0 })),
    members: [0, 1, 2, 3].map((i) => ({ id: i, startNodeId: i, endNodeId: i + 1, section })),
    restraints: [
      { nodeId: 0, ...pinA },
      { nodeId: 4, ...roller },
    ],
    memberLoads: [
      { type: "udl", memberId: 0, direction: "Z", w: -15, start: 1000, end: 1500 },
      { type: "udl", memberId: 1, direction: "Z", w: -15 },
      { type: "udl", memberId: 2, direction: "Z", w: -15, start: 0, end: 1000 },
      { type: "point", memberId: 1, direction: "Z", P: -40, a: 700 },
    ],
  });

  it.each([
    [1500, 1],
    [3000, 2],
    [4500, 3],
  ])("station at x = %i mm matches node %i of the subdivided beam", (x, node) => {
    const s = at(single.memberDiagrams[0].stations, x);
    expect(s.uz).toBeCloseTo(split.nodalDisplacements[node].uz, 4);
  });

  it("the stations inside each sub-member match the single member too", () => {
    const sub = split.memberDiagrams[1]; // 1.5–3.0 m, holds the point load
    for (const s of sub.stations) {
      const x = 1500 + s.x;
      const t = single.memberDiagrams[0].stations.find((st) => Math.abs(st.x - x) < 1e-6);
      if (t) expect(s.uz).toBeCloseTo(t.uz, 4);
    }
  });
});

describe("member deflection — global components on an inclined member", () => {
  it("the end stations equal the node displacements in global axes", () => {
    const r = analyzeSingleCase({
      nodes: [
        { id: 1, x: 0, y: 0, z: 0 },
        { id: 2, x: 2000, y: 1500, z: 2500 },
      ],
      members: [{ id: "m", startNodeId: 1, endNodeId: 2, section, angle: 0.4 }],
      restraints: [{ nodeId: 1, ...fixed }],
      nodalLoads: [{ nodeId: 2, fx: 3, fy: -2, fz: -5, mx: 1 }],
      memberLoads: [{ type: "udl", memberId: "m", direction: "Z", w: -2 }],
    });
    const stations = r.memberDiagrams[0].stations;
    const end = stations[stations.length - 1];
    const node = r.nodalDisplacements[1];
    expect(end.ux).toBeCloseTo(node.ux, 4);
    expect(end.uy).toBeCloseTo(node.uy, 4);
    expect(end.uz).toBeCloseTo(node.uz, 4);
    expect(stations[0].ux).toBeCloseTo(0, 6);
    // local and global describe the same vector
    for (const s of stations) {
      expect(Math.hypot(s.u1, s.u2, s.u3)).toBeCloseTo(Math.hypot(s.ux, s.uy, s.uz), 4);
    }
  });
});
