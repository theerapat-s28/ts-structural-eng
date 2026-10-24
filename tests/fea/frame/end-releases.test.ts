import type { SectionProperties } from "@app-core/types/section-properties.type";
import { beam3dLocalStiffnessRightHanded } from "@app-fea/frame/elements/beam-3d-stiffness";
import { condenseMember } from "@app-fea/frame/elements/static-condensation";
import { analyzeFrame } from "@app-fea/frame/solver/analyze-frame";
import { validateFrameModel } from "@app-fea/frame/validation/validate-model";
import type { MemberEndRelease, Restraint } from "@app-fea/frame/types/model.type";
import type { FrameCaseResult } from "@app-fea/frame/types/results.type";
import { analyzeSingleCase, toLoadCaseModel, type SingleCaseModel } from "./single-case";

const E = 200000; // MPa
const G = 80000; // MPa
const A = 5000; // mm²
const I22 = 4e7; // mm⁴
const I33 = 1e8; // mm⁴
const J = 1e7; // mm⁴
const L = 6000; // mm
const section: SectionProperties = { E, G, A, I22, I33, J };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

/** k = EI33/L in N·mm/rad; 3k is the spring giving fixity factor γ = 0.5. */
const k = (E * I33) / L;

/** Beam along +X from A to B, both nodes fully fixed, releases at the member's end B. */
const fixedBeam = (
  end: MemberEndRelease,
  rest: Partial<SingleCaseModel> = {},
  restraintB: Omit<Restraint, "nodeId"> = fixed,
): SingleCaseModel => ({
  nodes: [
    { id: "A", x: 0, y: 0, z: 0 },
    { id: "B", x: L, y: 0, z: 0 },
  ],
  members: [{ id: "m", startNodeId: "A", endNodeId: "B", section, releases: { end } }],
  restraints: [
    { nodeId: "A", ...fixed },
    { nodeId: "B", ...restraintB },
  ],
  ...rest,
});

const udl = (w: number) => ({
  memberLoads: [{ type: "udl" as const, memberId: "m", direction: "Z" as const, w: -w }],
});

const expectSameMember = (a: FrameCaseResult, b: FrameCaseResult) => {
  for (const end of ["start", "end"] as const) {
    for (const [key, value] of Object.entries(a.memberEndForces[0][end])) {
      expect(value).toBeCloseTo(b.memberEndForces[0][end][key as "f1"], 3);
    }
  }
  a.memberDiagrams[0].stations.forEach((s, i) => {
    const t = b.memberDiagrams[0].stations[i];
    expect(s.x).toBeCloseTo(t.x, 6);
    for (const c of ["N", "V2", "V3", "T", "M2", "M3"] as const) expect(s[c]).toBeCloseTo(t[c], 3);
    for (const c of ["u1", "u2", "u3"] as const) expect(s[c]).toBeCloseTo(t[c], 5);
  });
};

describe("condenseMember — springs in series with the member end", () => {
  const kLocal = beam3dLocalStiffnessRightHanded(E, G, A, I22, I33, J, L);
  // local DOFs: 5 = R3 at the start, 11 = R3 at the end
  const withSpring = (s: number) => condenseMember(kLocal, [{ index: 11, spring: s }]).k;

  it("rotational spring at the far end: M_a = 4k(s + 3k)/(s + 4k), carry-over 2k·s/(s + 4k)", () => {
    for (const s of [0.5 * k, 3 * k, 20 * k]) {
      const kStar = withSpring(s);
      expect(kStar[5][5]).toBeCloseTo((4 * k * (s + 3 * k)) / (s + 4 * k), -2);
      expect(kStar[11][5]).toBeCloseTo((2 * k * s) / (s + 4 * k), -2);
      expect(kStar[11][11]).toBeCloseTo((s * 4 * k) / (s + 4 * k), -2); // s in series with 4k
    }
  });

  it("spring 0 is the classical full release, a very stiff spring is a rigid connection", () => {
    const released = condenseMember(kLocal, [{ index: 11, spring: 0 }]).k;
    expect(released[5][5]).toBeCloseTo(3 * k, -2);
    expect(released[11].every((v) => v === 0)).toBe(true);
    const rigid = withSpring(1e9 * k);
    const scale = Math.max(...kLocal.flat().map(Math.abs));
    rigid.forEach((row, i) =>
      row.forEach((v, j) => expect(Math.abs(v - kLocal[i][j])).toBeLessThan(1e-6 * scale)),
    );
  });

  it("stays symmetric and free of force under rigid-body motion", () => {
    const kStar = condenseMember(kLocal, [
      { index: 4, spring: 2 * k },
      { index: 11, spring: k },
      { index: 6, spring: 1e5 },
    ]).k;
    kStar.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(kStar[j][i], -1)));
    // translation along local 2 and rotation about local 3: u2 = θ·x, R3 = θ
    const translation = [0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
    const rotation = [0, 0, 0, 0, 0, 1, 0, L, 0, 0, 0, 1];
    for (const u of [translation, rotation]) {
      const f = kStar.map((row) => row.reduce((sum, v, j) => sum + v * u[j], 0));
      f.forEach((v) => expect(Math.abs(v)).toBeLessThan(1e-3 * k));
    }
  });

  it("recovers the member-side displacement: node − member = spring force / s", () => {
    const s = 3 * k;
    const condensed = condenseMember(kLocal, [{ index: 11, spring: s }]);
    const uNode = [0, 0, 0, 0, 0, 1e-3, 0, 0, 0, 0, 0, 0]; // start rotates, end node held
    const uMember = condensed.memberEndDisplacements(uNode, new Array(12).fill(0));
    const springForce = condensed.k[11].reduce((sum, v, j) => sum + v * uNode[j], 0);
    expect(uNode[11] - uMember[11]).toBeCloseTo(springForce / s, 12);
    uNode.forEach((v, i) => i !== 11 && expect(uMember[i]).toBe(v));
  });
});

describe("analyzeFrame — partial fixity (semi-rigid end)", () => {
  const w = 20; // kN/m
  const s = (3 * k) / 1e6; // kN·m/rad: fixity factor γ = 1 / (1 + 3EI/(s·L)) = 0.5
  const wL2 = (w * (L / 1000) ** 2) / 12; // fixed-end moment wL²/12 = 60 kN·m

  it("fixed–semi-rigid beam under UDL matches slope-deflection: M_A = wL²/12·(6k+s)/(4k+s)", () => {
    const r = analyzeSingleCase(fixedBeam({ r3: s }, udl(w)));
    const sN = s * 1e6;
    const MA = (wL2 * (6 * k + sN)) / (4 * k + sN); // 77.1429 kN·m
    const MB = (wL2 * sN) / (4 * k + sN); // 25.7143 kN·m
    const d = r.memberDiagrams[0];
    expect(d.stations[0].M3).toBeCloseTo(-MA, 3);
    expect(d.stations[d.stations.length - 1].M3).toBeCloseTo(-MB, 3);
    // the same through the fixity factor: M_B = wL²/12 · 3γ/(4 − γ)
    expect(MB).toBeCloseTo((wL2 * 3 * 0.5) / (4 - 0.5), 9);
    // peak sagging at zero shear: R_A = wL/2 + (M_A − M_B)/L, M_max = R_A²/2w − M_A
    const RA = (w * L) / 2000 + (MA - MB) / (L / 1000);
    expect(d.extremes.M3.max.value).toBeCloseTo(RA ** 2 / (2 * w) - MA, 3); // 40.4082 kN·m
  });

  it("equals a rigid end at a node held by a rotational restraint spring (exact oracle)", () => {
    const sprung = analyzeSingleCase(fixedBeam({ r3: s }, udl(w)));
    // local 3 of a member along +X is global −Y, so the end spring acts about global Y
    const oracle = analyzeSingleCase(
      fixedBeam({}, udl(w), { ux: true, uy: true, uz: true, rx: true, ry: s, rz: true }),
    );
    expectSameMember(sprung, oracle);
    // the member's own end rotation equals the oracle node's rotation; the node itself is fixed
    expect(sprung.releaseDeformations[0].end.r3).toBeCloseTo(
      0 - -oracle.nodalDisplacements[1].ry,
      8,
    );
  });

  it("a shear spring u2 equals a vertical restraint spring at the node", () => {
    const sv = 5; // kN/mm
    const load = { nodalLoads: [], ...udl(w) };
    const sprung = analyzeSingleCase(fixedBeam({ u2: sv }, load));
    const oracle = analyzeSingleCase(
      fixedBeam({}, load, { ux: true, uy: true, uz: sv, rx: true, ry: true, rz: true }),
    );
    expectSameMember(sprung, oracle);
    expect(sprung.releaseDeformations[0].end.u2).toBeCloseTo(
      sprung.memberEndForces[0].end.f2 / sv,
      5,
    );
  });

  it("axial and torsion springs act in series: δ = P(L/EA + 1/s), φ = T(L/GJ + 1/s)", () => {
    const sa = 50; // kN/mm
    const st = 2000; // kN·m/rad
    const P = 100; // kN
    const T = 10; // kN·m
    const r = analyzeSingleCase({
      nodes: [
        { id: "A", x: 0, y: 0, z: 0 },
        { id: "B", x: L, y: 0, z: 0 },
      ],
      members: [
        {
          id: "m",
          startNodeId: "A",
          endNodeId: "B",
          section,
          releases: { start: { u1: sa, r1: st } },
        },
      ],
      restraints: [{ nodeId: "A", ...fixed }],
      nodalLoads: [{ nodeId: "B", fx: P, mx: T }],
    });
    expect(r.nodalDisplacements[1].ux).toBeCloseTo((P * 1e3 * L) / (E * A) + P / sa, 5);
    expect(r.nodalDisplacements[1].rx).toBeCloseTo((T * 1e6 * L) / (G * J) + T / st, 8);
    expect(r.releaseDeformations[0].start.u1).toBeCloseTo(-P / sa, 5); // node A minus member
    expect(r.releaseDeformations[0].start.r1).toBeCloseTo(-T / st, 8);
    // the diagram starts from the member's own displacement, past the spring
    expect(r.memberDiagrams[0].stations[0].u1).toBeCloseTo(P / sa, 5);
  });

  it("tends to the full release and the rigid connection at the stiffness limits", () => {
    const end = (release: MemberEndRelease) =>
      analyzeSingleCase(fixedBeam(release, udl(w))).memberEndForces[0];
    expect(end({ r3: 1e-6 }).start.m3).toBeCloseTo(end({ r3: true }).start.m3, 3);
    expect(end({ r3: 1e12 }).start.m3).toBeCloseTo(end({}).start.m3, 3);
    expect(end({ r3: 0 })).toEqual(end({ r3: true })); // 0 is a full release
  });

  it("superposes: a combination's release deformations are the factored sum", () => {
    const model = toLoadCaseModel(fixedBeam({ r3: s }));
    const result = analyzeFrame({
      ...model,
      loadCases: [{ id: "D" }, { id: "L" }],
      memberLoads: [
        { loadCase: "D", type: "udl", memberId: "m", direction: "Z", w: -10 },
        { loadCase: "L", type: "point", memberId: "m", direction: "Z", P: -40, a: 2000 },
      ],
      combinations: [
        {
          id: "U",
          terms: [
            { case: "D", factor: 1.2 },
            { case: "L", factor: 1.6 },
          ],
        },
      ],
    });
    const r3 = (r: FrameCaseResult) => r.releaseDeformations[0].end.r3;
    expect(r3(result.combinations.U)).toBeCloseTo(
      1.2 * r3(result.cases.D) + 1.6 * r3(result.cases.L),
      7, // each presented rotation is rounded to 8 decimals
    );
  });
});

describe("analyzeFrame — release deformations at hinges", () => {
  it("propped-cantilever hinge: the member rotates wL³/48EI past the fixed node", () => {
    const w = 10; // kN/m = N/mm
    const r = analyzeSingleCase(fixedBeam({ r3: true }, udl(w)));
    // local 2 = +Z, R3 = du2/dx; under a downward load the hinged end slopes upward
    const theta = (w * L ** 3) / (48 * E * I33);
    expect(r.releaseDeformations).toHaveLength(1);
    expect(r.releaseDeformations[0].memberId).toBe("m");
    expect(r.releaseDeformations[0].end.r3).toBeCloseTo(-theta, 8);
    expect(r.releaseDeformations[0].start).toEqual({ u1: 0, u2: 0, u3: 0, r1: 0, r2: 0, r3: 0 });
  });

  it("lists only members with releases", () => {
    const r = analyzeSingleCase(fixedBeam({}, udl(10)));
    expect(r.releaseDeformations).toEqual([]);
  });
});

describe("validateFrameModel — release values", () => {
  const issuesOf = (end: Record<string, unknown>) =>
    validateFrameModel(toLoadCaseModel(fixedBeam(end as MemberEndRelease, udl(1))));

  it("accepts true, false, 0 and positive springs", () => {
    expect(issuesOf({ u1: false, u2: 5, r1: true, r3: 0 })).toEqual([]);
  });

  it.each([[-1], [Number.NaN], [Infinity], ["yes"]])(
    "rejects %s with 314 locating the field",
    (v) => {
      const issues = issuesOf({ r3: v });
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe(314);
      expect(issues[0].details).toEqual({ memberId: "m", field: "releases.end.r3" });
    },
  );

  it("springs never make a member a mechanism, full releases still do (307)", () => {
    const both = (value: boolean | number) =>
      validateFrameModel(
        toLoadCaseModel({
          ...fixedBeam({ r1: value }, udl(1)),
          members: [
            {
              id: "m",
              startNodeId: "A",
              endNodeId: "B",
              section,
              releases: { start: { r1: value }, end: { r1: value } },
            },
          ],
        }),
      ).map((i) => i.code);
    expect(both(10)).toEqual([]);
    expect(both(true)).toEqual([307]);
  });
});
