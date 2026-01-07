export const concreteBeta = (fc_: number) => {
  // fc_ in MPa
  if (fc_ <= 28) {
    return 0.85;
  }
  const beta = 0.85 - 0.05 * ((fc_ - 28) / 7);
  return Math.max(beta, 0.65);
};

export const concreteElasticModulus = (fc_: number) => {
  // Assuming fc_ is in MPa
  return 4700 * Math.sqrt(fc_);
};

export const psiToMpa = (psi: number) => {
  // Convert psi to MPa
  return psi / 145.038;
};