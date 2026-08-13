import { describe, it, expect } from "vitest";
import { solveQuadratic, roundToDecimalPlaces } from "@app-utils/math";

describe("solveQuadratic", () => {
  it("returns two real roots for a positive discriminant", () => {
    // x² - 5x + 6 = 0  →  x = 2, 3
    const roots = solveQuadratic(1, -5, 6);
    expect(roots).toHaveLength(2);
    expect(roots).toContain(2);
    expect(roots).toContain(3);
  });

  it("returns a repeated root when discriminant is zero", () => {
    // x² - 4x + 4 = 0  →  x = 2, 2
    const roots = solveQuadratic(1, -4, 4);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeCloseTo(2);
    expect(roots[1]).toBeCloseTo(2);
  });

  it("returns an empty array when discriminant is negative", () => {
    // x² + x + 1 = 0  →  no real roots
    const roots = solveQuadratic(1, 1, 1);
    expect(roots).toHaveLength(0);
  });
});

describe("roundToDecimalPlaces", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundToDecimalPlaces(3.14159, 2)).toBe(3.14);
  });

  it("rounds to 0 decimal places", () => {
    expect(roundToDecimalPlaces(3.7, 0)).toBe(4);
  });

  it("handles negative numbers", () => {
    expect(roundToDecimalPlaces(-2.346, 2)).toBe(-2.35);
  });
});
