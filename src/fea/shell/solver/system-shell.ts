import type { FrameId, FrameNode } from "@app-fea/shared/types/model.type";

import { flatShellElement, type FlatShellElement } from "../elements/flat-shell";
import { cornerAreas } from "../elements/quad-geometry";
import type { Vec3 } from "../elements/shell-axes";
import type { ShellArea, ShellModifiers, ShellSection, ShellType } from "../types/model.type";

/** A shell area with everything that does not depend on the loads. */
export interface SystemShell {
  id: FrameId;
  /** The shell area the element belongs to (its own id when the area is one element). */
  areaId: FrameId;
  nodeIndices: number[]; // the four corners, in the shell's order
  type: ShellType;
  section: ShellSection;
  modifiers: ShellModifiers;
  /** Axes, corner transformations and local and global stiffness. */
  element: FlatShellElement;
  /** ∫ Nᵢ dA of each corner on the mean plane (mm²): its share of a uniform surface load. */
  cornerAreas: number[];
}

/**
 * Builds the flat shell element of every shell of a model that passed `validateFrameModel`:
 * axes, corner transformations, local and global stiffness with the stiffness modifiers, and
 * each corner's share of a uniform surface load.
 *
 * @param shells - Shell elements; after `expandModel` each carries its area's id
 * @param nodes - The analysed nodes, generated mesh nodes included
 * @param nodeIndex - Map from node id to index into `nodes`
 */
export const prepareSystemShells = (
  shells: (ShellArea & { areaId?: FrameId })[],
  nodes: FrameNode[],
  nodeIndex: Map<FrameId, number>,
): SystemShell[] =>
  shells.map((shell) => {
    const nodeIndices = shell.nodeIds.map((id) => nodeIndex.get(id) as number);
    const points = nodeIndices.map((n): Vec3 => [nodes[n].x, nodes[n].y, nodes[n].z]);
    const { thickness, E, nu } = shell.section;
    const m = shell.modifiers ?? {};
    const type = shell.type ?? "shell";
    const element = flatShellElement(
      points,
      {
        E,
        nu,
        t: thickness,
        type,
        membraneModifiers: [m.f11 ?? 1, m.f22 ?? 1, m.f12 ?? 1],
        bendingModifiers: [m.m11 ?? 1, m.m22 ?? 1, m.m12 ?? 1],
      },
      shell.angle ?? 0,
    );
    return {
      id: shell.id,
      areaId: shell.areaId ?? shell.id,
      nodeIndices,
      type,
      section: shell.section,
      modifiers: m,
      element,
      cornerAreas: cornerAreas(element.axes.corners),
    };
  });
