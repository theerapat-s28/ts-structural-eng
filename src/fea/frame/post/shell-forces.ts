import { roundToDecimalPlaces } from "@app-utils/math";
import { matVec } from "@app-utils/matrix";

import { dkqCurvatureRows, plateRigidity } from "../elements/shell/dkq-plate";
import { membraneRigidity, membraneStrainRows } from "../elements/shell/membrane-quad";
import {
  bilinearShape,
  cartesianDerivatives,
  GAUSS_2X2,
  quadJacobian,
} from "../elements/shell/quad-geometry";
import type { SystemShell } from "../solver/frame-system";
import { elementDofs } from "../solver/global-assembly";
import type { ShellCornerForces, ShellElementForces } from "../types/results.type";

/** Raw components per corner: F11 F22 F12 (N/mm), M11 M22 M12 (N·mm/mm), V13 V23 (N/mm). */
export const SHELL_FORCE_COMPONENTS = 8;

const FORCE_DECIMALS = 4;
const ROOT3 = Math.sqrt(3);
const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * Bilinear functions through the 2×2 Gauss points (in `GAUSS_2X2` order), evaluated at each
 * corner: the corner is at ±√3 in the Gauss points' own coordinates, ξ' = √3·ξ.
 */
const atCorners = CORNERS.map(([xi, eta]) => bilinearShape(ROOT3 * xi, ROOT3 * eta));

/**
 * Unrounded forces per unit width at the four corners of a shell, in its local axes 1, 2, from
 * the global displacements `U` (N and mm): 8 values per corner in `nodeIds` order.
 *
 * - Membrane forces `n = D_m·ε` and moments are evaluated at the 2×2 Gauss points and
 *   extrapolated bilinearly to the corners.
 * - Moments follow the member convention: M11 is positive when it puts the −3 face in tension
 *   (sagging with local 3 up), so M = −∫ z·σ dz.
 * - The plate has no shear strain, so V13, V23 come from moment equilibrium,
 *   `V13 = −(∂M11/∂x₁ + ∂M12/∂x₂)` and `V23 = −(∂M12/∂x₁ + ∂M22/∂x₂)` (as V2 = −dM3/dx for a
 *   member), on the bilinear field through the Gauss-point moments. They are coarser than the
 *   moments.
 *
 * Everything is linear in `U`, so load combinations superpose it.
 */
export const shellRawForces = (shell: SystemShell, U: number[]): number[] => {
  const { element, type, section, modifiers: m } = shell;
  const dofs = elementDofs(shell.nodeIndices);
  // local DOFs [u₁ u₂ u₃ r₁ r₂ r₃] of each projected corner
  const local = element.transforms.map((T, i) =>
    matVec(
      T,
      dofs.slice(6 * i, 6 * i + 6).map((d) => U[d]),
    ),
  );
  const { corners } = element.axes;
  const properties = { E: section.E, nu: section.nu, t: section.thickness };
  const out = new Array<number>(4 * SHELL_FORCE_COMPONENTS).fill(0);
  const extrapolate = (atGauss: number[][], first: number) => {
    atCorners.forEach(({ N }, c) => {
      for (let k = 0; k < 3; k++) {
        out[SHELL_FORCE_COMPONENTS * c + first + k] = N.reduce(
          (sum, w, g) => sum + w * atGauss[g][k],
          0,
        );
      }
    });
  };

  if (type !== "plate") {
    const D = membraneRigidity({ ...properties, modifiers: [m.f11 ?? 1, m.f22 ?? 1, m.f12 ?? 1] });
    const u = local.flatMap((d) => [d[0], d[1], d[5]]);
    extrapolate(
      GAUSS_2X2.map(({ xi, eta }) => matVec(D, matVec(membraneStrainRows(corners, xi, eta).B, u))),
      0,
    );
  }

  if (type !== "membrane") {
    const D = plateRigidity({ ...properties, modifiers: [m.m11 ?? 1, m.m22 ?? 1, m.m12 ?? 1] });
    const w = local.flatMap((d) => [d[2], d[3], d[4]]);
    const moments = GAUSS_2X2.map(({ xi, eta }) =>
      matVec(D, matVec(dkqCurvatureRows(corners, xi, eta).B, w)).map((v) => -v),
    );
    extrapolate(moments, 3);
    CORNERS.forEach(([xi, eta], c) => {
      const { dXi, dEta } = atCorners[c];
      const { dX, dY } = cartesianDerivatives(quadJacobian(corners, xi, eta), {
        dXi: dXi.map((v) => ROOT3 * v),
        dEta: dEta.map((v) => ROOT3 * v),
      });
      const d = (weights: number[], k: number) =>
        weights.reduce((sum, v, g) => sum + v * moments[g][k], 0);
      out[SHELL_FORCE_COMPONENTS * c + 6] = -(d(dX, 0) + d(dY, 2));
      out[SHELL_FORCE_COMPONENTS * c + 7] = -(d(dX, 2) + d(dY, 1));
    });
  }
  return out;
};

const round = (value: number) => roundToDecimalPlaces(value, FORCE_DECIMALS) + 0; // + 0: no −0

/**
 * The presented forces of one shell: kN/m, kN·m/m and kN/m per corner, with the face stresses
 * `σ = F/t ∓ 6M/t²` in MPa (top = +3 face).
 *
 * @param raw - From `shellRawForces`, or a factored sum of them
 */
export const presentShellForces = (
  shell: SystemShell,
  nodeIds: ShellCornerForces["nodeId"][],
  raw: number[],
): ShellElementForces => {
  const t = shell.section.thickness;
  return {
    shellId: shell.id,
    areaId: shell.areaId,
    corners: nodeIds.map((nodeId, c) => {
      const [F11, F22, F12, M11, M22, M12, V13, V23] = raw.slice(
        SHELL_FORCE_COMPONENTS * c,
        SHELL_FORCE_COMPONENTS * (c + 1),
      );
      // N/mm ÷ mm and N·mm/mm ÷ mm² are MPa
      const face = (F: number, M: number, side: 1 | -1) => round(F / t - (side * 6 * M) / t ** 2);
      return {
        nodeId,
        F11: round(F11), // N/mm = kN/m
        F22: round(F22),
        F12: round(F12),
        M11: round(M11 * 1e-3), // N·mm/mm = 10⁻³ kN·m/m
        M22: round(M22 * 1e-3),
        M12: round(M12 * 1e-3),
        V13: round(V13),
        V23: round(V23),
        S11Top: face(F11, M11, 1),
        S22Top: face(F22, M22, 1),
        S12Top: face(F12, M12, 1),
        S11Bot: face(F11, M11, -1),
        S22Bot: face(F22, M22, -1),
        S12Bot: face(F12, M12, -1),
      };
    }),
  };
};
