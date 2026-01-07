export const solveQuadratic = (a: number, b: number, c: number): number[] => {
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return []; // No real roots
  }
  const sqrtDiscriminant = Math.sqrt(discriminant);
  const root1 = (-b + sqrtDiscriminant) / (2 * a);
  const root2 = (-b - sqrtDiscriminant) / (2 * a);
  return [root1, root2];
};

export const roundToDecimalPlaces = (
  value: number,
  decimalPlaces: number,
): number => {
  const factor = Math.pow(10, decimalPlaces);
  return Math.round(value * factor) / factor;
};