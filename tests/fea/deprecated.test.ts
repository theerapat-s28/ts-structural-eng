import * as core from "@app-core/index";
import * as fea from "@app-fea/index";
import type { FeaModel } from "@app-fea/index";

const model: FeaModel = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 3000, y: 0, z: 0 },
  ],
  members: [
    { id: "m", startNodeId: 1, endNodeId: 2, section: { E: 1, G: 1, A: 1, I22: 1, I33: 1, J: 1 } },
  ],
  restraints: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loadCases: [{ id: "L" }],
};

describe("names before 3.2.0", () => {
  it("are the renamed functions and constants", () => {
    expect(fea.analyzeFrame).toBe(fea.analyze);
    expect(fea.createFrameAnalysis).toBe(fea.createAnalysis);
    expect(fea.validateFrameModel).toBe(fea.validateModel);
    expect(core.FrameAnalysisError).toBe(core.FeaError);
    expect(core.FrameErrors).toBe(core.FeaErrors);
  });

  it("still catch the errors analyze throws", () => {
    const unstable: fea.FrameModel = { ...model, restraints: [] };
    expect(() => fea.analyzeFrame(unstable)).toThrow(core.FrameAnalysisError);
    expect(() => fea.analyze(unstable)).toThrow(core.FeaError);
  });
});
