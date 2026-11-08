import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/fea.constant";
import type { Warnings } from "@app-core/types/output-message.type";
import { areaPlane, type AreaPlane, type Vec3 } from "@app-fea/frame/area/area-geometry";
import { areaMemberLoads } from "@app-fea/frame/area/area-member-loads";
import { edgeMemberChain, memberAdjacency } from "@app-fea/frame/area/edge-members";
import type { MemberLoad, NullArea } from "@app-fea/frame/types/model.type";
import type { AreaLoad, FeaId } from "@app-fea/shared/types/model.type";

import type { FeaModel } from "../types/model.type";
import type { AnalysisSystem } from "./analysis-system";

const WARNING_REFERENCE = "Membrane area, out-of-plane load";
const DIRECTIONS: Record<"X" | "Y" | "Z", Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The loads that a membrane cannot carry, moved to the members along its edges. */
export interface MembraneTributaryLoads {
  memberLoads: MemberLoad[];
  /** Indices of the shell elements whose loads lose their out-of-plane part. */
  shells: Set<number>;
  warnings: Warnings;
}

/**
 * Passes the out-of-plane part of the loads on membrane areas, meshed or not, to the members
 * along their edges, by the two-way tributary distribution of null areas. A membrane has no
 * out-of-plane stiffness, so left on the membrane that part would act at its nodes and bypass
 * the beams. The in-plane part stays on the membrane. Everything is linear in the loads.
 *
 * Applies to an area that is flat and has members along all four edges; another area keeps
 * its loads at its nodes, with a warning (and error 332 if a generated node takes any of it).
 *
 * @param model - The model as given, with its shell areas not yet meshed
 * @param system - The prepared system, for the elements of each area
 */
export const membraneTributaryLoads = (
  model: FeaModel,
  system: AnalysisSystem,
): MembraneTributaryLoads => {
  const result: MembraneTributaryLoads = { memberLoads: [], shells: new Set(), warnings: [] };
  const membranes = (model.shells ?? []).filter((s) => s.type === "membrane");
  if (membranes.length === 0) return result;

  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const position = (id: FeaId): Vec3 => {
    const node = nodeById.get(id)!;
    return [node.x, node.y, node.z];
  };
  const adjacency = memberAdjacency(model.members ?? []);
  const areas: NullArea[] = [];
  const areaLoads: AreaLoad[] = [];

  for (const shell of membranes) {
    const found = areaPlane(shell.nodeIds.map(position));
    const plane: AreaPlane | null = "problem" in found ? null : found;
    // the first element's normal stands in for the area's when the area is not flat
    const elements = system.shellsByArea.get(shell.id) ?? [];
    const normal = plane?.normal ?? (system.shells[elements[0]].element.axes.lambda[2] as Vec3);

    // [load case, out-of-plane load in kN/m² along +normal, cosine to the normal]
    const parts: { loadCase: string; q: number; cosine: number }[] = [];
    for (const load of model.areaLoads ?? []) {
      if (load.areaId !== shell.id) continue;
      const cosine = load.direction === "3" ? 1 : dot(DIRECTIONS[load.direction], normal);
      const q = load.projected ? load.q * Math.abs(cosine) : load.q;
      parts.push({ loadCase: load.loadCase, q: q * cosine, cosine });
    }
    const { unitWeight = 0, thickness } = shell.section;
    const weight = unitWeight * thickness * (shell.modifiers?.weight ?? 1) * 1e-3; // kN/m²
    for (const { id, selfWeight = 0 } of model.loadCases) {
      if (selfWeight !== 0 && weight !== 0) {
        parts.push({ loadCase: id, q: -selfWeight * weight * normal[2], cosine: normal[2] });
      }
    }
    const loaded = parts.some((p) => p.q !== 0 && Math.abs(p.cosine) > AREA_GEOMETRY_TOLERANCE);
    if (!loaded) continue;

    const ids = shell.nodeIds;
    const supported =
      plane !== null &&
      ids.every((id, i) => edgeMemberChain(id, ids[(i + 1) % 4], position, adjacency) !== null);
    if (!supported) {
      result.warnings.push({
        reference: WARNING_REFERENCE,
        message: `Membrane area "${String(shell.id)}" has no out-of-plane stiffness and is not flat or lacks members along its edges, so the out-of-plane part of its loads acts at its nodes and is not distributed along the members on its edges.`,
      });
      continue;
    }

    areas.push({ id: shell.id, nodeIds: ids, distribution: "twoWay" });
    for (const { loadCase, q } of parts) {
      if (q !== 0) areaLoads.push({ loadCase, areaId: shell.id, direction: "3", q });
    }
    elements.forEach((element) => result.shells.add(element));
    result.warnings.push({
      reference: WARNING_REFERENCE,
      message: `Membrane area "${String(shell.id)}" has no out-of-plane stiffness, so the out-of-plane part of its loads is passed to the members along its edges by two-way tributary area, as for a null area.`,
    });
  }

  if (areas.length > 0) {
    result.memberLoads = areaMemberLoads({
      nodes: model.nodes,
      members: model.members,
      areas,
      areaLoads,
    }).memberLoads;
  }
  return result;
};
