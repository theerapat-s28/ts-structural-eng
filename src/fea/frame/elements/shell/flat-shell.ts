import { zeros, type Matrix } from "@app-utils/matrix";

import { dkqPlateStiffness } from "./dkq-plate";
import { membraneQuadStiffness } from "./membrane-quad";
import type { Vec2 } from "./quad-geometry";
import type { RigidityModifiers } from "./rigidity";
import { shellAxes, type ShellAxes, type Vec3 } from "./shell-axes";

/** How a shell element carries load: in its plane, in bending, or both. */
export type ShellType = "shell" | "membrane" | "plate";

/** Material, thickness and behaviour of a flat shell element. */
export interface FlatShellProperties {
  E: number; // MPa
  nu: number;
  t: number; // mm
  type: ShellType;
  /** Membrane stiffness modifiers f11, f22, f12 along local 1 and 2 (default all 1). */
  membraneModifiers?: RigidityModifiers;
  /** Bending stiffness modifiers m11, m22, m12 along local 1 and 2 (default all 1). */
  bendingModifiers?: RigidityModifiers;
}

/** A flat shell element ready for assembly. */
export interface FlatShellElement {
  axes: ShellAxes;
  /** Per corner, global DOFs at the real node → local DOFs at its projection (6×6). */
  transforms: Matrix[];
  /** 24×24 stiffness over the local DOFs `[u₁ u₂ u₃ r₁ r₂ r₃]` of the projected corners. */
  kLocal: Matrix;
  /** 24×24 stiffness over the global DOFs `[ux uy uz rx ry rz]` of the real corners. */
  kGlobal: Matrix;
}

/** Positions of the membrane DOFs [u, v, θz] and the plate DOFs [w, θx, θy] among a node's six. */
const MEMBRANE_DOFS = [0, 1, 5];
const PLATE_DOFS = [2, 3, 4];

/**
 * Local stiffness of a flat four-node shell: the drilling membrane (`membraneQuadStiffness`) on
 * u₁, u₂, r₃ and the DKQ plate (`dkqPlateStiffness`) on u₃, r₁, r₂ of every corner. For a flat
 * element of uniform section the two do not couple. `"membrane"` and `"plate"` keep only their
 * own part, leaving the other DOFs without stiffness.
 *
 * @param corners - The four corners in the element plane (mm), counter-clockwise
 * @param properties - Material, thickness, type and stiffness modifiers
 * @returns The 24×24 stiffness over `[u₁ u₂ u₃ r₁ r₂ r₃]` per corner (N and mm)
 */
export const flatShellLocalStiffness = (
  corners: readonly Vec2[],
  properties: FlatShellProperties,
): Matrix => {
  const { E, nu, t, type } = properties;
  const k = zeros(24, 24);
  const scatter = (part: Matrix, dofs: number[]) => {
    for (let a = 0; a < 12; a++) {
      const i = 6 * Math.floor(a / 3) + dofs[a % 3];
      for (let b = 0; b < 12; b++) k[i][6 * Math.floor(b / 3) + dofs[b % 3]] += part[a][b];
    }
  };
  if (type !== "plate") {
    const membrane = { E, nu, t, modifiers: properties.membraneModifiers };
    scatter(membraneQuadStiffness(corners, membrane), MEMBRANE_DOFS);
  }
  if (type !== "membrane") {
    const plate = { E, nu, t, modifiers: properties.bendingModifiers };
    scatter(dkqPlateStiffness(corners, plate), PLATE_DOFS);
  }
  return k;
};

/**
 * Per corner, the 6×6 transformation from the global DOFs at the real node to the local DOFs at
 * its projection on the mean plane: the direction cosines λ on translations and rotations, plus
 * a rigid link across the offset h along local 3, `u_proj = u + θ × (−h·e₃)`, which adds
 * `−h·r₂` to u₁ and `+h·r₁` to u₂. For a flat element it is just λ.
 */
export const shellNodeTransforms = ({ lambda, offsets }: ShellAxes): Matrix[] =>
  offsets.map((h) => {
    const T = zeros(6, 6);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        T[i][j] = lambda[i][j];
        T[3 + i][3 + j] = lambda[i][j];
      }
    }
    for (let j = 0; j < 3; j++) {
      T[0][3 + j] = -h * lambda[1][j];
      T[1][3 + j] = h * lambda[0][j];
    }
    return T;
  });

/**
 * Transforms a 24×24 local shell stiffness to global DOFs block by block,
 * `k_ab = T_aᵀ·k_local,ab·T_b`, without forming the 24×24 transformation.
 *
 * @param kLocal - Stiffness over the local DOFs of the projected corners
 * @param transforms - The four corner transformations from `shellNodeTransforms`
 */
export const shellGlobalStiffness = (kLocal: Matrix, transforms: Matrix[]): Matrix => {
  const k = zeros(24, 24);
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      const Ta = transforms[a];
      const Tb = transforms[b];
      // block·T_b
      const right = zeros(6, 6);
      for (let i = 0; i < 6; i++) {
        for (let m = 0; m < 6; m++) {
          const v = kLocal[6 * a + i][6 * b + m];
          if (v === 0) continue;
          for (let j = 0; j < 6; j++) right[i][j] += v * Tb[m][j];
        }
      }
      // T_aᵀ·(block·T_b)
      for (let i = 0; i < 6; i++) {
        for (let m = 0; m < 6; m++) {
          const v = Ta[m][i];
          if (v === 0) continue;
          for (let j = 0; j < 6; j++) k[6 * a + i][6 * b + j] += v * right[m][j];
        }
      }
    }
  }
  return k;
};

/**
 * A flat four-node shell element (drilling membrane plus DKQ plate) built on the mean plane of
 * its corners, linked rigidly to the real corners when they are not coplanar.
 *
 * @param points - The four corners in global axes (mm), in order around the element; local 3
 *   follows the right-hand rule around them
 * @param properties - Material, thickness, type and stiffness modifiers
 * @param angle - Rotation of local 1 and 2 about local 3 in rad (default 0)
 */
export const flatShellElement = (
  points: readonly Vec3[],
  properties: FlatShellProperties,
  angle = 0,
): FlatShellElement => {
  const axes = shellAxes(points, angle);
  const transforms = shellNodeTransforms(axes);
  const kLocal = flatShellLocalStiffness(axes.corners, properties);
  return { axes, transforms, kLocal, kGlobal: shellGlobalStiffness(kLocal, transforms) };
};
