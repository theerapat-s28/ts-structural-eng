/**
 * Returns the ACI 318 beta1 factor for the equivalent rectangular stress block.
 *
 * @param fc_ - Concrete compressive strength in MPa
 * @returns Beta1 factor (clamped between 0.65 and 0.85)
 */
export const concreteBeta = (fc_: number): number => {
  if (fc_ <= 28) {
    return 0.85;
  }
  const beta = 0.85 - 0.05 * ((fc_ - 28) / 7);
  return Math.max(beta, 0.65);
};

/**
 * Estimates the modulus of elasticity of concrete per ACI 318 (Ec = 4700√f'c).
 *
 * @param fc_ - Concrete compressive strength in MPa
 * @returns Elastic modulus in MPa
 */
export const concreteElasticModulus = (fc_: number): number => {
  return 4700 * Math.sqrt(fc_);
};

/**
 * Converts a pressure value from psi to MPa.
 *
 * @param psi - Value in pounds per square inch
 * @returns Equivalent value in megapascals
 */
export const psiToMpa = (psi: number): number => {
  return psi / 145.038;
};