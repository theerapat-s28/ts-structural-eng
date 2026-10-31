import {
  FrameErrors,
  type FrameErrorDetails,
  type FrameModelIssue,
} from "@app-core/errors/frame-analysis.error";
import type { FrameId, FrameNode } from "@app-fea/shared/types/model.type";
import { frameIssue, isFiniteNumber } from "@app-fea/shared/validation/issues";

import { isValidShellQuad } from "../elements/shell-axes";
import { meshShells } from "../mesh/mesh-shells";
import type { ShellArea, ShellType } from "../types/model.type";

const SHELL_TYPES = new Set<ShellType>(["shell", "membrane", "plate"]);
const SHELL_SECTION_KEYS = ["thickness", "E"] as const;
const SHELL_MODIFIER_KEYS = ["f11", "f22", "f12", "m11", "m22", "m12"] as const;

/**
 * Checks each shell area on its own: `type`, `angle`, section, modifiers, mesh settings and its
 * four corners (known nodes making a valid quad, see `isValidShellQuad`). Corners at nodes with
 * invalid coordinates are skipped; those are reported on the node.
 *
 * @param shells - The model's shell areas
 * @param nodeById - Model nodes by id
 * @param validNode - Ids of the nodes whose coordinates are valid
 * @returns Every problem found (codes 302, 314, 326 and 327), in model order, with `shellId`
 */
export const validateShells = (
  shells: ShellArea[],
  nodeById: Map<FrameId, FrameNode>,
  validNode: Set<FrameId>,
): FrameModelIssue[] => {
  const issues: FrameModelIssue[] = [];
  const add = (std: { code: number; message: string }, details: FrameErrorDetails = {}) =>
    issues.push(frameIssue(std, details));
  const position = (id: FrameId): [number, number, number] => {
    const node = nodeById.get(id)!;
    return [node.x, node.y, node.z];
  };

  for (const shell of shells) {
    const at = { shellId: shell.id };
    if (shell.type !== undefined && !SHELL_TYPES.has(shell.type)) {
      add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "type" });
    }
    if (shell.angle !== undefined && !isFiniteNumber(shell.angle)) {
      add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "angle" });
    }

    const section = shell.section ?? ({} as typeof shell.section);
    for (const field of SHELL_SECTION_KEYS) {
      if (!isFiniteNumber(section[field]) || section[field] <= 0) {
        add(FrameErrors.INVALID_SHELL_SECTION, { ...at, field: `section.${field}` });
      }
    }
    if (!isFiniteNumber(section.nu) || section.nu < 0 || section.nu >= 0.5) {
      add(FrameErrors.INVALID_SHELL_SECTION, { ...at, field: "section.nu" });
    }
    if (
      section.unitWeight !== undefined &&
      (!isFiniteNumber(section.unitWeight) || section.unitWeight < 0)
    ) {
      add(FrameErrors.INVALID_SHELL_SECTION, { ...at, field: "section.unitWeight" });
    }

    const modifiers = shell.modifiers ?? {};
    for (const key of SHELL_MODIFIER_KEYS) {
      const v: unknown = modifiers[key];
      if (v !== undefined && !(isFiniteNumber(v) && v > 0)) {
        add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: `modifiers.${key}` });
      }
    }
    const weight: unknown = modifiers.weight;
    if (weight !== undefined && !(isFiniteNumber(weight) && weight >= 0)) {
      add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "modifiers.weight" });
    }

    const mesh: unknown = shell.mesh;
    if (mesh !== undefined) {
      const { maxSize, divisions } = (mesh ?? {}) as { maxSize?: unknown; divisions?: unknown };
      if (typeof mesh !== "object" || mesh === null) {
        add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "mesh" });
      } else {
        if (maxSize !== undefined && !(isFiniteNumber(maxSize) && maxSize > 0)) {
          add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "mesh.maxSize" });
        }
        const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 1;
        if (
          divisions !== undefined &&
          !(Array.isArray(divisions) && divisions.length === 2 && divisions.every(count))
        ) {
          add(FrameErrors.INVALID_INPUT_VALUE, { ...at, field: "mesh.divisions" });
        }
      }
    }

    const ids = Array.isArray(shell.nodeIds) ? shell.nodeIds : [];
    if (ids.length !== 4) {
      add(FrameErrors.INVALID_SHELL_GEOMETRY, { ...at, field: "nodeIds" });
      continue;
    }
    if (ids.some((id) => !nodeById.has(id))) {
      add(FrameErrors.UNKNOWN_NODE_REFERENCE, { ...at, field: "nodeIds" });
      continue;
    }
    if (!ids.every((id) => validNode.has(id))) continue; // reported on the node
    if (!isValidShellQuad(ids.map(position))) {
      add(FrameErrors.INVALID_SHELL_GEOMETRY, { ...at, field: "nodeIds" });
    }
  }
  return issues;
};

/**
 * Meshes the shell areas and reports those that cannot be meshed (see `meshShells`). Call it
 * only when every node and every shell is valid.
 *
 * @returns Code 329 for each area that cannot be meshed, with `shellId` and `field: "mesh"`
 */
export const validateShellMesh = (nodes: FrameNode[], shells: ShellArea[]): FrameModelIssue[] =>
  meshShells(nodes, shells).problems.map((shellId) =>
    frameIssue(FrameErrors.INVALID_SHELL_MESH, { shellId, field: "mesh" }),
  );
