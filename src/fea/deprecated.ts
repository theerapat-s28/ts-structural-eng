// Names before 3.2.0, kept as deprecated aliases until 4.0.0
import { analyze, createAnalysis, validateModel } from "./analysis";
import type {
  Analysis,
  AnalyzeOptions,
  FeaCaseResult,
  FeaEnvelope,
  FeaModel,
  FeaResult,
} from "./analysis";
import type { FeaId, FeaNode } from "./shared";
import type { FeaMesh } from "./shell";

/** @deprecated Renamed `analyze`; this alias is removed in 4.0.0. */
export const analyzeFrame = analyze;
/** @deprecated Renamed `createAnalysis`; this alias is removed in 4.0.0. */
export const createFrameAnalysis = createAnalysis;
/** @deprecated Renamed `validateModel`; this alias is removed in 4.0.0. */
export const validateFrameModel = validateModel;

/** @deprecated Renamed `AnalyzeOptions`; this alias is removed in 4.0.0. */
export type AnalyzeFrameOptions = AnalyzeOptions;
/** @deprecated Renamed `Analysis`; this alias is removed in 4.0.0. */
export type FrameAnalysis = Analysis;
/** @deprecated Renamed `FeaModel`; this alias is removed in 4.0.0. */
export type FrameModel = FeaModel;
/** @deprecated Renamed `FeaResult`; this alias is removed in 4.0.0. */
export type FrameResult = FeaResult;
/** @deprecated Renamed `FeaCaseResult`; this alias is removed in 4.0.0. */
export type FrameCaseResult = FeaCaseResult;
/** @deprecated Renamed `FeaEnvelope`; this alias is removed in 4.0.0. */
export type FrameEnvelope = FeaEnvelope;
/** @deprecated Renamed `FeaMesh`; this alias is removed in 4.0.0. */
export type FrameMesh = FeaMesh;
/** @deprecated Renamed `FeaNode`; this alias is removed in 4.0.0. */
export type FrameNode = FeaNode;
/** @deprecated Renamed `FeaId`; this alias is removed in 4.0.0. */
export type FrameId = FeaId;
