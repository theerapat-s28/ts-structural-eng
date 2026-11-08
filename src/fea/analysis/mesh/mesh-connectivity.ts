import type { Warnings } from "@app-core/types/output-message.type";
import type { FeaId, FeaNode } from "@app-fea/shared/types/model.type";
import { isFiniteNumber } from "@app-fea/shared/validation/issues";
import type { Vec3 } from "@app-fea/shell/elements/shell-axes";
import { meshShells } from "@app-fea/shell/mesh/mesh-shells";
import type { ShellArea } from "@app-fea/shell/types/model.type";
import type { FeaMesh } from "@app-fea/shell/types/results.type";
import { validateShells } from "@app-fea/shell/validation/validate-shells";
import { roundToDecimalPlaces } from "@app-utils/math";

import type { FeaModel } from "../types/model.type";
import {
  meshNodesAlongMembers,
  nodesOffMesh,
  nodesOffMeshWarnings,
  type NodeOffMesh,
} from "./expand-model";

/** A node the engine generated to mesh the shell areas, and the elements connected at it. */
export interface GeneratedMeshNode extends FeaNode {
  /** Shell elements with a corner at the node, in the order of `MeshConnectivity.shells`. */
  shellIds: FeaId[];
  /** The shell areas of those elements, each once, in model order. */
  areaIds: FeaId[];
  /** Members passing through the node, split there; `x` is mm from the member start. */
  members: { memberId: FeaId; x: number }[];
}

/** The nodes and elements the engine generates by meshing a model's shell areas. */
export interface MeshConnectivity {
  /** Every generated node (none from the model), with what connects at it. */
  nodes: GeneratedMeshNode[];
  /** Every shell element, area by area in model order, with its four corner nodes. */
  shells: FeaMesh["shells"];
  /** Member end nodes inside a shell area but not on its mesh, so not connected to the shell. */
  disconnectedNodes: NodeOffMesh[];
  /** Shell areas that cannot be meshed: `analyze` throws 329 for them. */
  failedAreaIds: FeaId[];
  /** One "Shell area meshing" warning per disconnected node. */
  warnings: Warnings;
}

/**
 * Finds the nodes and elements the engine generates by meshing a model's shell areas, without
 * analysing it: the same meshing `analyze` does, cheap enough to run on every edit so a
 * frontend can show the user which elements connect at each generated node.
 *
 * - `nodes` lists only generated nodes (edge nodes `"<a>~<b>:<k>"`, interior nodes
 *   `"<areaId>:<i>,<j>"`), never a model node. Each lists the shell elements and areas with a
 *   corner at it, and the members split there: a member along a meshed edge passes through
 *   the edge's generated nodes, whatever its `connectIntermediateNodes`.
 * - `disconnectedNodes` lists the member end nodes lying inside an area but not on its mesh,
 *   which are not connected to the shell (`analyze` warns about them).
 *
 * Model nodes on members are listed by `memberConnectivity`. The model need not be valid:
 * nodes with invalid coordinates, shell areas with invalid corners or `mesh` settings, and
 * members with an unknown or invalid end node are skipped (`validateModel` reports them). For a
 * model that `analyze` accepts, `nodes` and `shells` match `result.mesh`.
 *
 * @param model - The model; only its nodes, members and shells are used
 * @returns `nodes`, `shells`, `disconnectedNodes`, `failedAreaIds` and `warnings`; positions in mm
 */
export const meshConnectivity = (model: FeaModel): MeshConnectivity => {
  const nodes = (model.nodes ?? []).filter(
    (n) => isFiniteNumber(n.x) && isFiniteNumber(n.y) && isFiniteNumber(n.z),
  );
  const nodeById = new Map<FeaId, FeaNode>(nodes.map((n) => [n.id, n]));
  const validNode = new Set(nodeById.keys());
  // the areas that can be meshed: corners and mesh settings valid (other fields do not matter)
  const shells: ShellArea[] = (model.shells ?? []).filter(
    (shell) =>
      Array.isArray(shell.nodeIds) &&
      shell.nodeIds.every((id) => validNode.has(id)) &&
      !validateShells([shell], nodeById, validNode).some(
        ({ details }) => details.field === "nodeIds" || details.field?.startsWith("mesh"),
      ),
  );
  const empty: MeshConnectivity = {
    nodes: [],
    shells: [],
    disconnectedNodes: [],
    failedAreaIds: [],
    warnings: [],
  };
  if (shells.length === 0) return empty;

  const meshed = meshShells(nodes, shells);
  const members = model.members ?? [];
  const position = new Map<FeaId, Vec3>(nodes.map((n) => [n.id, [n.x, n.y, n.z]]));

  const generated = new Map<FeaId, GeneratedMeshNode>(
    meshed.nodes.map((n) => [n.id, { ...n, shellIds: [], areaIds: [], members: [] }]),
  );
  for (const element of meshed.elements) {
    for (const id of element.nodeIds) {
      const node = generated.get(id);
      if (!node) continue;
      node.shellIds.push(element.id);
      if (!node.areaIds.includes(element.areaId)) node.areaIds.push(element.areaId);
    }
  }
  meshNodesAlongMembers(members, position, meshed.nodes).forEach((hits, i) => {
    for (const { nodeId, x } of hits) {
      generated
        .get(nodeId)!
        .members.push({ memberId: members[i].id, x: roundToDecimalPlaces(x, 3) });
    }
  });

  const meshNodes = new Set(meshed.elements.flatMap((e) => e.nodeIds));
  const disconnectedNodes = nodesOffMesh(position, members, shells, meshNodes);
  return {
    nodes: [...generated.values()],
    shells: meshed.elements.map(({ id, areaId, nodeIds }) => ({ id, areaId, nodeIds })),
    disconnectedNodes,
    failedAreaIds: meshed.problems,
    warnings: nodesOffMeshWarnings(disconnectedNodes),
  };
};
