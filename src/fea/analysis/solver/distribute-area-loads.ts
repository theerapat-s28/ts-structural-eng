import type { Warnings } from "@app-core/types/output-message.type";
import { areaMemberLoads } from "@app-fea/frame/area/area-member-loads";
import type { MemberLoad } from "@app-fea/frame/types/model.type";
import { throwIssues } from "@app-fea/shared/validation/issues";

import type { FrameModel } from "../types/model.type";
import { validateFrameModel } from "../validation/validate-model";

/**
 * The member loads that a model's null areas send to the members along their edges — what
 * `analyzeFrame` adds to `memberLoads` — so they can be checked or previewed.
 *
 * Two-way areas send each point to the nearest edge (corner-bisector split); one-way areas
 * split strips parallel to their unsupported edges half to each end; cantilever areas send
 * `q · c` and a torque `q · c² / 2` per unit length to their support edge (c = depth). Edges
 * split by intermediate nodes are cut at those nodes. Loads are per unit true area (a
 * `projected` load is first converted, `q · |n · direction|`) and come out as trapezoidal loads
 * per member length in global X, Y and Z (and torques), each tagged with its load case.
 *
 * @param model - The frame model, validated first
 * @returns `memberLoads` and `warnings` (a one-way support edge parallel to the span)
 * @throws {FrameAnalysisError} 301–317 for an invalid model, with every problem in `issues`
 */
export const distributeAreaLoads = (
  model: FrameModel,
): { memberLoads: MemberLoad[]; warnings: Warnings } => {
  const issues = validateFrameModel(model);
  if (issues.length > 0) throwIssues(issues);
  return areaMemberLoads(model);
};
