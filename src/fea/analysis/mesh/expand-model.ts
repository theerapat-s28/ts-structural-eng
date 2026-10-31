import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/frame.constant";
import type { Warnings } from "@app-core/types/output-message.type";
import type { Member } from "@app-fea/frame/types/model.type";
import type { FrameId, FrameNode, Restraint } from "@app-fea/shared/types/model.type";
import { shellAxes, type Vec3 } from "@app-fea/shell/elements/shell-axes";
import { meshShells, pointOnSegment, type ShellElement } from "@app-fea/shell/mesh/mesh-shells";
import type { FrameMesh } from "@app-fea/shell/types/results.type";

import type { FrameModel } from "../types/model.type";

const DOF_KEYS = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;

/** A member with the generated mesh nodes lying inside it, where the solver splits it. */
export interface SplitMember extends Member {
  /** Generated node ids strictly between its ends, in order from the start. */
  through?: FrameId[];
}

/** The model the solver analyses: shells meshed, line restraints spread to their nodes. */
export interface ExpandedModel {
  /**
   * Nodes include the generated ones; `shells` are the elements; members list the generated
   * nodes they pass through; restraints include the lines.
   */
  model: FrameModel & { shells: ShellElement[]; members: SplitMember[] };
  /** The shell mesh for the result; undefined without shells. */
  mesh: FrameMesh | undefined;
  warnings: Warnings;
}

/**
 * Restraints of every node on each line restraint's segment (ends included), merged with the
 * point restraints: a DOF fixed by either is fixed.
 */
const spreadLineRestraints = (model: FrameModel, nodes: FrameModel["nodes"]): Restraint[] => {
  const lines = model.lineRestraints ?? [];
  if (lines.length === 0) return model.restraints;
  const position = new Map<FrameId, Vec3>(nodes.map((n) => [n.id, [n.x, n.y, n.z]]));
  const merged = new Map<FrameId, Restraint>(model.restraints.map((r) => [r.nodeId, { ...r }]));
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
const disconnectedNodes = (model: FrameModel, meshNodes: Set<FrameId>): Warnings => {
  const warnings: Warnings = [];
  const shells = model.shells ?? [];
  const position = new Map<FrameId, Vec3>(model.nodes.map((n) => [n.id, [n.x, n.y, n.z]]));
  const memberNodes = new Set(model.members.flatMap((m) => [m.startNodeId, m.endNodeId]));
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
 * The generated nodes lying strictly inside each member (a beam along a meshed edge), so the
 * member can be split there and share them with the shells.
 */
const splitMembers = (model: FrameModel, generated: FrameNode[]): SplitMember[] => {
  if (generated.length === 0) return model.members;
  const position = new Map<FrameId, Vec3>(model.nodes.map((n) => [n.id, [n.x, n.y, n.z]]));
  return model.members.map((member) => {
    const [P, Q] = [position.get(member.startNodeId)!, position.get(member.endNodeId)!];
    const lo = [0, 1, 2].map((k) => Math.min(P[k], Q[k]));
    const hi = [0, 1, 2].map((k) => Math.max(P[k], Q[k]));
    const slack = AREA_GEOMETRY_TOLERANCE * Math.hypot(Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]);
    const through: { id: FrameId; t: number }[] = [];
    for (const node of generated) {
      const x: Vec3 = [node.x, node.y, node.z];
      if (x.some((v, k) => v < lo[k] - slack || v > hi[k] + slack)) continue;
      const t = pointOnSegment(x, P, Q);
      if (t !== null) through.push({ id: node.id, t });
    }
    return through.length === 0
      ? member
      : { ...member, through: through.sort((a, b) => a.t - b.t).map((h) => h.id) };
  });
};

/**
 * Meshes a valid model's shell areas, spreads its line restraints and marks the members that
 * generated nodes split (see `meshShells`).
 * Without shells and line restraints the model is returned as it is.
 */
export const expandModel = (model: FrameModel): ExpandedModel => {
  const shells = model.shells ?? [];
  if (shells.length === 0) {
    return {
      model: { ...model, shells: [], restraints: spreadLineRestraints(model, model.nodes) },
      mesh: undefined,
      warnings: [],
    };
  }
  const meshed = meshShells(model.nodes, shells);
  const nodes = [...model.nodes, ...meshed.nodes];
  const meshNodes = new Set(meshed.elements.flatMap((e) => e.nodeIds));
  return {
    model: {
      ...model,
      nodes,
      members: splitMembers(model, meshed.nodes),
      shells: meshed.elements,
      restraints: spreadLineRestraints(model, nodes),
    },
    mesh: {
      nodes: meshed.nodes,
      shells: meshed.elements.map(({ id, areaId, nodeIds }) => ({ id, areaId, nodeIds })),
    },
    warnings: disconnectedNodes(model, meshNodes),
  };
};
