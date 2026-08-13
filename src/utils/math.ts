/**
 * Solves the quadratic equation ax² + bx + c = 0.
 *
 * @param a - Coefficient of x²
 * @param b - Coefficient of x
 * @param c - Constant term
 * @returns Array of real roots (empty if discriminant < 0)
 */
export const solveQuadratic = (a: number, b: number, c: number): number[] => {
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return [];
  }
  const sqrtDiscriminant = Math.sqrt(discriminant);
  const root1 = (-b + sqrtDiscriminant) / (2 * a);
  const root2 = (-b - sqrtDiscriminant) / (2 * a);
  return [root1, root2];
};

/**
 * Rounds a number to a specified number of decimal places.
 *
 * @param value - The number to round
 * @param decimalPlaces - Number of decimal places to keep
 * @returns The rounded number
 */
export const roundToDecimalPlaces = (value: number, decimalPlaces: number): number => {
  const factor = Math.pow(10, decimalPlaces);
  return Math.round(value * factor) / factor;
};
