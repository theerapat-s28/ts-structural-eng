import type { SectionProperties } from "@app-core/types/section-properties.type";
import type { MemberStation } from "@app-fea/frame/types/results.type";
import { analyzeSingleCase, type SingleCaseModel } from "./single-case";

const E = 200000; // MPa
const I33 = 8e7; // mm⁴
const section: SectionProperties = { E, G: 80000, A: 5000, I22: 2e7, I33, J: 1e7 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const pinA = { ux: true, uy: true, uz: true, rx: true };
const roller = { uy: true, uz: true };

const L = 6000; // mm
const w = 12; // kN/m = N/mm, peak of the triangular load

const at = (stations: MemberStation[], x: number) => {
  const s = stations.find((st) => Math.abs(st.x - x) < 1e-6);
  if (!s) throw new Error(`no station at x = ${x}`);
  return s;
};

/** Single member along +X (local 2 = +Z) from (0,0,0) to (L,0,0). */
const beam = (
  restraints: SingleCaseModel["restraints"],
  memberLoads: SingleCaseModel["memberLoads"],
): SingleCaseModel => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: L, y: 0, z: 0 },
  ],
  members: [{ id: "m", startNodeId: 1, endNodeId: 2, section }],
  restraints,
  memberLoads,
});

const triangle: SingleCaseModel["memberLoads"] = [
  { type: "trapezoidal", memberId: "m", direction: "Z", w1: 0, w2: -w },
];

describe("trapezoidal member load — closed-form solutions", () => {
  it("fixed–fixed triangular load: wL²/30 and wL²/20 end moments, 3wL/20 and 7wL/20 reactions", () => {
    const r = analyzeSingleCase(
      beam(
        [
          { nodeId: 1, ...fixed },
          { nodeId: 2, ...fixed },
        ],
        triangle,
      ),
    );
    const wL = w * L * 1e-3; // 72 kN
    expect(r.reactions[0].fz).toBeCloseTo((3 * wL) / 20, 6); // 10.8 kN
    expect(r.reactions[1].fz).toBeCloseTo((7 * wL) / 20, 6); // 25.2 kN
    const d = r.memberDiagrams[0];
    expect(at(d.stations, 0).M3).toBeCloseTo((-wL * L * 1e-3) / 30, 4); // −14.4 kN·m
    expect(at(d.stations, L).M3).toBeCloseTo((-wL * L * 1e-3) / 20, 4); // −21.6 kN·m
  });

  it("simply supported triangular load: Mmax = wL²/9√3 at L/√3 and the exact deflection curve", () => {
    const r = analyzeSingleCase(
      beam(
        [
          { nodeId: 1, ...pinA },
          { nodeId: 2, ...roller },
        ],
        triangle,
      ),
    );
    const d = r.memberDiagrams[0];
    expect(d.extremes.M3.max.value).toBeCloseTo((w * L ** 2 * 1e-6) / (9 * Math.sqrt(3)), 4);
    expect(d.extremes.M3.max.x).toBeCloseTo(L / Math.sqrt(3), 2);

    // y(x) = −w·x·(7L⁴ − 10L²x² + 3x⁴) / (360·L·EI)
    const y = (x: number) =>
      (-w * x * (7 * L ** 4 - 10 * L ** 2 * x ** 2 + 3 * x ** 4)) / (360 * L * E * I33);
    for (const x of [1500, 3000, 4500]) expect(at(d.stations, x).u2).toBeCloseTo(y(x), 5);
    // δmax at x = 0.5193·L
    const xMax = L * Math.sqrt(1 - Math.sqrt(8 / 15));
    expect(d.extremes.u2.min.value).toBeCloseTo(y(xMax), 5);
    expect(d.extremes.u2.min.x).toBeCloseTo(xMax, 0);
  });

  it("finds the shear extreme inside a load whose intensity changes sign", () => {
    // q = 10·(1 − 2x/L) N/mm upward: V is quadratic with its vertex at the zero-load point L/2
    const r = analyzeSingleCase(
      beam(
        [
          { nodeId: 1, ...pinA },
          { nodeId: 2, ...roller },
        ],
        [{ type: "trapezoidal", memberId: "m", direction: "Z", w1: 10, w2: -10 }],
      ),
      { stations: 4 }, // 0, 2000, 4000, 6000: L/2 is not a station by itself
    );
    const e = r.memberDiagrams[0].extremes.V2;
    const interior = [e.max, e.min].find((v) => Math.abs(v.x - L / 2) < 1e-6);
    expect(interior).toBeDefined();
    // |V(L/2)| = |−10L/6 + 10·(L/2 − L/4)| = 5 kN, against 10 kN at the ends
    expect(Math.abs(interior!.value)).toBeCloseTo(5, 6);
  });
});

describe("trapezoidal member load — independent check against a subdivided model", () => {
  // Simply supported 6 m beam, load −6 → −18 kN/m over 1.0–4.0 m, so −10 kN/m at 2.0 m.
  // Oracle: nodes at 2.0 and 3.5 m, the load split into matching pieces on each sub-member.
  const intensity = (x: number) => -6 - (12 * (x - 1000)) / 3000;
  const single = analyzeSingleCase(
    beam(
      [
        { nodeId: 1, ...pinA },
        { nodeId: 2, ...roller },
      ],
      [
        {
          type: "trapezoidal",
          memberId: "m",
          direction: "Z",
          w1: -6,
          w2: -18,
          start: 1000,
          end: 4000,
        },
      ],
    ),
    { stations: 61 }, // every 100 mm, so 2.0 and 3.5 m are stations
  );
  const split = analyzeSingleCase({
    nodes: [0, 2000, 3500, 6000].map((x, i) => ({ id: i, x, y: 0, z: 0 })),
    members: [0, 1, 2].map((i) => ({ id: i, startNodeId: i, endNodeId: i + 1, section })),
    restraints: [
      { nodeId: 0, ...pinA },
      { nodeId: 3, ...roller },
    ],
    memberLoads: [
      {
        type: "trapezoidal",
        memberId: 0,
        direction: "Z",
        w1: -6,
        w2: intensity(2000),
        start: 1000,
      },
      {
        type: "trapezoidal",
        memberId: 1,
        direction: "Z",
        w1: intensity(2000),
        w2: intensity(3500),
      },
      { type: "trapezoidal", memberId: 2, direction: "Z", w1: intensity(3500), w2: -18, end: 500 },
    ],
  });

  it("matches the reactions and the node deflections", () => {
    const fz = (r: typeof single, nodeId: number) =>
      r.reactions.find((x) => x.nodeId === nodeId)!.fz;
    expect(fz(single, 1)).toBeCloseTo(fz(split, 0), 6);
    expect(fz(single, 2)).toBeCloseTo(fz(split, 3), 6);
    expect(at(single.memberDiagrams[0].stations, 2000).uz).toBeCloseTo(
      split.nodalDisplacements[1].uz,
      5,
    );
    expect(at(single.memberDiagrams[0].stations, 3500).uz).toBeCloseTo(
      split.nodalDisplacements[2].uz,
      5,
    );
  });

  it("matches the moment and shear inside a sub-member", () => {
    for (const s of split.memberDiagrams[1].stations) {
      const t = single.memberDiagrams[0].stations.find(
        (st) => Math.abs(st.x - (2000 + s.x)) < 1e-6,
      );
      if (!t) continue;
      expect(t.M3).toBeCloseTo(s.M3, 4);
      expect(t.V2).toBeCloseTo(s.V2, 4);
    }
  });
});
