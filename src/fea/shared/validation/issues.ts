import { FeaError, type FeaErrorDetails, type FeaModelIssue } from "@app-core/errors/fea.error";

export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const describe = (d: FeaErrorDetails): string => {
  const parts: string[] = [];
  if (d.nodeId !== undefined) parts.push(`node "${String(d.nodeId)}"`);
  if (d.memberId !== undefined) parts.push(`member "${String(d.memberId)}"`);
  if (d.areaId !== undefined) parts.push(`area "${String(d.areaId)}"`);
  if (d.shellId !== undefined) parts.push(`shell "${String(d.shellId)}"`);
  if (d.stripId !== undefined) parts.push(`strip "${String(d.stripId)}"`);
  if (d.edge !== undefined) parts.push(`edge ${d.edge}`);
  if (d.loadCaseId !== undefined) parts.push(`load case "${d.loadCaseId}"`);
  if (d.combinationId !== undefined) parts.push(`combination "${d.combinationId}"`);
  if (d.field !== undefined) parts.push(`field "${d.field}"`);
  if (d.dof !== undefined) parts.push(`DOF ${d.dof}`);
  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
};

/** Builds an issue whose message names where the problem is. */
export const modelIssue = (
  std: { code: number; message: string },
  details: FeaErrorDetails = {},
): FeaModelIssue => ({ code: std.code, message: std.message + describe(details), details });

/** Throws the first issue as a `FeaError` carrying all of them. */
export const throwIssues = (issues: FeaModelIssue[]): never => {
  const first = issues[0];
  throw new FeaError({ code: first.code, message: first.message }, first.details, issues);
};
