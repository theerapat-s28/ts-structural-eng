import {
  FrameAnalysisError,
  type FrameErrorDetails,
  type FrameModelIssue,
} from "@app-core/errors/frame-analysis.error";

export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const describe = (d: FrameErrorDetails): string => {
  const parts: string[] = [];
  if (d.nodeId !== undefined) parts.push(`node "${String(d.nodeId)}"`);
  if (d.memberId !== undefined) parts.push(`member "${String(d.memberId)}"`);
  if (d.areaId !== undefined) parts.push(`area "${String(d.areaId)}"`);
  if (d.shellId !== undefined) parts.push(`shell "${String(d.shellId)}"`);
  if (d.edge !== undefined) parts.push(`edge ${d.edge}`);
  if (d.loadCaseId !== undefined) parts.push(`load case "${d.loadCaseId}"`);
  if (d.combinationId !== undefined) parts.push(`combination "${d.combinationId}"`);
  if (d.field !== undefined) parts.push(`field "${d.field}"`);
  if (d.dof !== undefined) parts.push(`DOF ${d.dof}`);
  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
};

/** Builds an issue whose message names where the problem is. */
export const frameIssue = (
  std: { code: number; message: string },
  details: FrameErrorDetails = {},
): FrameModelIssue => ({ code: std.code, message: std.message + describe(details), details });

/** Throws the first issue as a `FrameAnalysisError` carrying all of them. */
export const throwIssues = (issues: FrameModelIssue[]): never => {
  const first = issues[0];
  throw new FrameAnalysisError({ code: first.code, message: first.message }, first.details, issues);
};
