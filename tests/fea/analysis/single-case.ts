import { analyze, type AnalyzeOptions } from "@app-fea/analysis/solver/analyze";
import type { MemberLoad } from "@app-fea/frame/types/model.type";
import type { FeaModel, LoadCase, NodalLoad } from "@app-fea/analysis/types/model.type";
import type { FeaCaseResult } from "@app-fea/analysis/types/results.type";

type Untagged<T> = T extends unknown ? Omit<T, "loadCase"> : never;
export type UntaggedNodalLoad = Untagged<NodalLoad>;
export type UntaggedMemberLoad = Untagged<MemberLoad>;

/** A load case written with its loads inline, for compact tests. */
export type CaseWithLoads = LoadCase & {
  nodalLoads?: UntaggedNodalLoad[];
  memberLoads?: UntaggedMemberLoad[];
};

/** Moves inline loads to the model's top-level load lists, tagged with their load case. */
export const flattenCases = (
  cases: CaseWithLoads[],
): Pick<FeaModel, "loadCases" | "nodalLoads" | "memberLoads"> => ({
  loadCases: cases.map(({ nodalLoads: _n, memberLoads: _m, ...loadCase }) => loadCase),
  nodalLoads: cases.flatMap((c) =>
    (c.nodalLoads ?? []).map((l) => ({ ...l, loadCase: c.id }) as NodalLoad),
  ),
  memberLoads: cases.flatMap((c) =>
    (c.memberLoads ?? []).map((l) => ({ ...l, loadCase: c.id }) as MemberLoad),
  ),
});

/** A model with the loads of a single load case written inline, for compact tests. */
export type SingleCaseModel = Omit<
  FeaModel,
  "loadCases" | "combinations" | "nodalLoads" | "memberLoads"
> &
  Pick<CaseWithLoads, "nodalLoads" | "memberLoads" | "selfWeight">;

export const SINGLE_CASE_ID = "LC";

/** Wraps the inline loads in one load case. */
export const toLoadCaseModel = (model: SingleCaseModel): FeaModel => {
  const { nodalLoads, memberLoads, selfWeight, ...rest } = model;
  return {
    ...rest,
    ...flattenCases([{ id: SINGLE_CASE_ID, selfWeight, nodalLoads, memberLoads }]),
  };
};

/** Analyses a single-case model and returns that case's result. */
export const analyzeSingleCase = (
  model: SingleCaseModel,
  options?: AnalyzeOptions,
): FeaCaseResult => analyze(toLoadCaseModel(model), options).cases[SINGLE_CASE_ID];
