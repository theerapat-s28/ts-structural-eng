import type { Matrix } from "@app-utils/matrix";

/** Stiffness modifiers on the components 11, 22 and 12 of a rigidity matrix (1 = unmodified). */
export type RigidityModifiers = readonly [number, number, number];

/**
 * Isotropic rigidity `c·[[1, ν, 0], [ν, 1, 0], [0, 0, (1 − ν)/2]]` with stiffness modifiers applied
 * as `S·D·S`, `S = diag(√f₁₁, √f₂₂, √f₁₂)`: D₁₁, D₂₂ and D₃₃ scale by their own modifier and the
 * coupling D₁₂ by √(f₁₁·f₂₂), so D stays symmetric and positive definite and equal modifiers
 * scale it uniformly.
 *
 * @param c - E·t/(1 − ν²) for a membrane, E·t³/(12(1 − ν²)) for a plate
 * @param nu - Poisson's ratio
 * @param modifiers - Positive modifiers [f₁₁, f₂₂, f₁₂] (default all 1)
 */
export const isotropicRigidity = (
  c: number,
  nu: number,
  modifiers: RigidityModifiers = [1, 1, 1],
): Matrix => {
  const [f11, f22, f12] = modifiers;
  return [
    [c * f11, c * nu * Math.sqrt(f11 * f22), 0],
    [c * nu * Math.sqrt(f11 * f22), c * f22, 0],
    [0, 0, ((c * (1 - nu)) / 2) * f12],
  ];
};
