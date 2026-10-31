// Analysis of the whole model: members and shells together
export { analyzeFrame, createFrameAnalysis } from "./solver/analyze-frame";
export type { AnalyzeFrameOptions, FrameAnalysis } from "./solver/analyze-frame";
export { validateFrameModel } from "./validation/validate-model";
export { distributeAreaLoads } from "./solver/distribute-area-loads";
export { memberDemandEnvelope } from "./post/demand-envelope";
export type { MemberDemandEnvelope, DemandEnvelopeOptions } from "./post/demand-envelope";
export type {
  LineRestraint,
  NodalLoad,
  LoadCaseType,
  LoadCase,
  CombinationTerm,
  LoadCombination,
  FrameModel,
} from "./types/model.type";
export type {
  NodalDisplacement,
  NodalReaction,
  AutoRestrainedDof,
  GoverningValue,
  GoverningExtremeValue,
  Bound,
  FrameCaseResult,
  FrameEnvelope,
  FrameResult,
} from "./types/results.type";
