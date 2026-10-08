import { FrameAnalysisError, FrameErrors } from "@app-core/errors/frame-analysis.error";
import { analyzeFrame } from "@app-fea/frame/solver/analyze-frame";
import type { FrameModel } from "@app-fea/frame/types/model.type";

const sec = { E: 200000, G: 80000, A: 5000, I22: 8e7, I33: 8e7, J: 1e7 };
const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

const base = (): FrameModel => ({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 3000, y: 0, z: 0 },
  ],
  members: [{ id: "m", startNodeId: 1, endNodeId: 2, section: sec }],
  restraints: [{ nodeId: 1, ...fixed }],
  nodalLoads: [{ nodeId: 2, fz: -1 }],
});

const codeOf = (model: FrameModel): number | undefined => {
  try {
    analyzeFrame(model);
  } catch (e) {
    expect(e).toBeInstanceOf(FrameAnalysisError);
    return (e as FrameAnalysisError).code;
  }
  return undefined;
};

describe("FrameAnalysisError", () => {
  it("is a separate error class with a coded message", () => {
    const error = new FrameAnalysisError(FrameErrors.STRUCTURE_UNSTABLE);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(304);
    expect(error.message).toBe(FrameErrors.STRUCTURE_UNSTABLE.message);
  });

  it("uses the 3XX group", () => {
    const codes = Object.values(FrameErrors).map((e) => e.code);
    expect(codes).toEqual([301, 302, 303, 304, 305, 306, 307, 308]);
  });
});

describe("analyzeFrame validation", () => {
  it("accepts the base model", () => {
    expect(codeOf(base())).toBeUndefined();
  });

  it("301: zero-length member", () => {
    const m = base();
    m.nodes[1] = { id: 2, x: 0, y: 0, z: 0 };
    expect(codeOf(m)).toBe(301);
  });

  it("302: unknown node in a member, restraint, nodal load or member load", () => {
    const a = base();
    a.members[0].endNodeId = 99;
    expect(codeOf(a)).toBe(302);
    const b = base();
    b.restraints.push({ nodeId: 99, ux: true });
    expect(codeOf(b)).toBe(302);
    const c = base();
    c.nodalLoads = [{ nodeId: 99, fx: 1 }];
    expect(codeOf(c)).toBe(302);
    const d = base();
    d.memberLoads = [{ type: "udl", memberId: "nope", direction: "Z", w: 1 }];
    expect(codeOf(d)).toBe(302);
  });

  it("303: duplicate node, member or restraint ids", () => {
    const a = base();
    a.nodes.push({ id: 1, x: 5, y: 5, z: 5 });
    expect(codeOf(a)).toBe(303);
    const b = base();
    b.members.push({ ...b.members[0] });
    expect(codeOf(b)).toBe(303);
    const c = base();
    c.restraints.push({ nodeId: 1, ux: true });
    expect(codeOf(c)).toBe(303);
  });

  it("304: a mechanism (axial and torsional rigid-body motion)", () => {
    const m = base();
    m.restraints = [{ nodeId: 1, uy: true, uz: true }];
    expect(codeOf(m)).toBe(304);
  });

  it("304: a member whose node is not connected to any support", () => {
    const m = base();
    m.nodes.push({ id: 3, x: 0, y: 5000, z: 0 }, { id: 4, x: 3000, y: 5000, z: 0 });
    m.members.push({ id: "floating", startNodeId: 3, endNodeId: 4, section: sec });
    expect(codeOf(m)).toBe(304);
  });

  it("305: non-positive section properties", () => {
    const m = base();
    m.members[0].section = { ...sec, I33: 0 };
    expect(codeOf(m)).toBe(305);
    const n = base();
    n.members[0].section = { ...sec, E: Number.NaN };
    expect(codeOf(n)).toBe(305);
  });

  it("306: no restraints at all", () => {
    const m = base();
    m.restraints = [];
    expect(codeOf(m)).toBe(306);
    const n = base();
    n.restraints = [{ nodeId: 1, ux: false }];
    expect(codeOf(n)).toBe(306);
  });

  it("307: releases that let the member move as a rigid body", () => {
    const m = base();
    m.members[0].releases = { start: { u1: true }, end: { u1: true } };
    expect(codeOf(m)).toBe(307);
    const n = base();
    n.members[0].releases = { start: { r1: true }, end: { r1: true } };
    expect(codeOf(n)).toBe(307);
  });

  it("308: loads outside the member", () => {
    const a = base();
    a.memberLoads = [{ type: "point", memberId: "m", direction: "Z", P: 1, a: 3500 }];
    expect(codeOf(a)).toBe(308);
    const b = base();
    b.memberLoads = [{ type: "udl", memberId: "m", direction: "Z", w: 1, start: 2000, end: 1000 }];
    expect(codeOf(b)).toBe(308);
    const c = base();
    c.memberLoads = [{ type: "udl", memberId: "m", direction: "Z", w: 1, start: -10, end: 1000 }];
    expect(codeOf(c)).toBe(308);
  });
});
