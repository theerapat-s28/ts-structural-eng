import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/frame.constant";
import type { Warnings } from "@app-core/types/output-message.type";
import { nodesAlongMembers } from "@app-fea/frame/solver/nodes-along-members";
import type { Member } from "@app-fea/frame/types/model.type";
import type { FeaId, FeaNode, Restraint } from "@app-fea/shared/types/model.type";
import { shellAxes, type Vec3 } from "@app-fea/shell/elements/shell-axes";
import { meshShells, pointOnSegment, type ShellElement } from "@app-fea/shell/mesh/mesh-shells";
import type { FeaMesh } from "@app-fea/shell/types/results.type";

import type { FeaModel } from "../types/model.type";
import { findMemberConnectivity, type MemberConnectivity } from "./member-connectivity";

const DOF_KEYS = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;

/** A member with the nodes lying inside it, where the solver splits it. */
export interface SplitMember extends Member {
  /** Model and generated node ids strictly between its ends, in order from the start. */
  through?: FeaId[];
}

/** The model the solver analyses: shells meshed, line restraints spread to their nodes. */
export interface ExpandedModel {
  /**
   * Nodes include the generated ones; `shells` are the elements; members list the nodes they
   * pass through; restraints include the lines.
   */
  model: FeaModel & { shells: ShellElement[]; members: SplitMember[] };
  /** The shell mesh for the result; undefined without shells. */
  mesh: FeaMesh | undefined;
  /** Model nodes connected to members, and those that just miss one (see `memberConnectivity`). */
  connectivity: MemberConnectivity;
  warnings: Warnings;
}

/**
 * Restraints of every node on each line restraint's segment (ends included), merged with the
 * point restraints: a DOF fixed by either is fixed.
 */
const spreadLineRestraints = (model: FeaModel, nodes: FeaModel["nodes"]): Restraint[] => {
  const lines = model.lineRestraints ?? [];
  if (lines.length === 0) return model.restraints;
  const position = new Map<FeaId, Vec3>(nodes.map((n) => [n.id, [n.x, n.y, n.z]]));
  const merged = new Map<FeaId, Restraint>(model.restraints.map((r) => [r.nodeId, { ...r }]));
  for (const line of lines) {
    const [P, Q] = line.nodeIds.map((id) => position.get(id)!);
    for (const node of nodes) {
      const on =
        line.nodeIds.includes(node.id) ||
        pointOnSegment([node.x, node.y, node.z], P, Q, true) !== null;
      if (!on) continue;
      const restraint = merged.get(node.id) ?? { nodeId: node.id };
      for (const key of DOF_KEYS) if (line[key] === true) restraint[key] = true;
      merged.set(node.id, restraint);
    }
  }
  return [...merged.values()];
};

/**
 * Warnings for member nodes lying inside a shell area but not on its mesh: such a node is not
 * connected to the shell.
 */
const disconnectedNodes = (model: FeaModel, meshNodes: Set<FeaId>): Warnings => {
  const warnings: Warnings = [];
  const shells = model.shells ?? [];
  const position = new Map<FeaId, Vec3>(model.nodes.map((n) => [n.id, [n.x, n.y, n.z]]));
  const memberNodes = new Set((model.members ?? []).flatMap((m) => [m.startNodeId, m.endNodeId]));
  for (const shell of shells) {
    const points = shell.nodeIds.map((id) => position.get(id)!);
    const axes = shellAxes(points);
    const size = Math.max(...axes.corners.map(([x, y]) => Math.hypot(x, y)));
    const tolerance = AREA_GEOMETRY_TOLERANCE * size;
    for (const id of memberNodes) {
      if (meshNodes.has(id)) continue;
      const p = position.get(id)!;
      const r: Vec3 = [p[0] - axes.origin[0], p[1] - axes.origin[1], p[2] - axes.origin[2]];
      const [e1, e2, e3] = axes.lambda;
      const z = r[0] * e3[0] + r[1] * e3[1] + r[2] * e3[2];
      if (Math.abs(z) > Math.max(tolerance, ...axes.offsets.map(Math.abs))) continue;
      const x = r[0] * e1[0] + r[1] * e1[1] + r[2] * e1[2];
      const y = r[0] * e2[0] + r[1] * e2[1] + r[2] * e2[2];
      const inside = axes.corners.every(([ax, ay], k) => {
        const [bx, by] = axes.corners[(k + 1) % 4];
        return (bx - ax) * (y - ay) - (by - ay) * (x - ax) > tolerance * size;
      });
      if (inside) {
        warnings.push({
          reference: "Shell area meshing",
          message: `Node "${String(id)}" lies inside shell area "${String(shell.id)}" but not on its mesh, so its members are not connected to the shell; divide the area through the node.`,
        });
      }
    }
  }
  return warnings;
};

/**
 * The nodes lying strictly inside each member, where the solver splits it: the generated mesh
 * nodes (a beam along a meshed edge, so it shares them with the shells) and the model nodes it
 * connects to (see `findMemberConnectivity`).
 */
const splitMembers = (
  model: FeaModel,
  generated: FeaNode[],
): { members: SplitMember[]; connectivity: MemberConnectivity } => {
  const members = model.members ?? [];
  const { connected, connectivity } = findMemberConnectivity(model);
  const position = new Map<FeaId, Vec3>(model.nodes.map((n) => [n.id, [n.x, n.y, n.z]]));
  const meshed = nodesAlongMembers(
    members,
    (id) => position.get(id)!,
    generated,
    (_, L) => AREA_GEOMETRY_TOLERANCE * L,
  );
  const split = members.map((member, i) => {
    const through = [...connected[i], ...meshed[i]].sort((a, b) => a.x - b.x).map((h) => h.nodeId);
    return through.length === 0 ? member : { ...member, through };
  });
  return { members: split, connectivity };
};

/**
 * Meshes a valid model's shell areas, spreads its line restraints and marks where each member
 * is split: at the generated mesh nodes and at the model nodes on it (see `meshShells` and
 * `splitMembers`).
 */
export const expandModel = (model: FeaModel): ExpandedModel => {
  const shells = model.shells ?? [];
  const meshed = shells.length > 0 ? meshShells(model.nodes, shells) : undefined;
  const nodes = meshed ? [...model.nodes, ...meshed.nodes] : model.nodes;
  const split = splitMembers(model, meshed?.nodes ?? []);
  const meshNodes = new Set(meshed?.elements.flatMap((e) => e.nodeIds));
  return {
    model: {
      ...model,
      nodes,
      members: split.members,
      shells: meshed?.elements ?? [],
      restraints: spreadLineRestraints(model, nodes),
    },
    mesh: meshed && {
      nodes: meshed.nodes,
      shells: meshed.elements.map(({ id, areaId, nodeIds }) => ({ id, areaId, nodeIds })),
    },
    connectivity: split.connectivity,
    warnings: [
      ...split.connectivity.warnings,
      ...(meshed ? disconnectedNodes(model, meshNodes) : []),
    ],
  };
};
