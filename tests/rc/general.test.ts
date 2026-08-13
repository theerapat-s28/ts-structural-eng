import { describe, it, expect } from "vitest";
import { concreteBeta, concreteElasticModulus, psiToMpa } from "@app-rc/general";

describe("concreteBeta", () => {
  it("returns 0.85 for fc_ ≤ 28 MPa", () => {
    expect(concreteBeta(18)).toBe(0.85);
    expect(concreteBeta(28)).toBe(0.85);
  });

  it("decreases linearly for fc_ > 28 MPa", () => {
    // beta = 0.85 - 0.05 * ((35 - 28) / 7) = 0.85 - 0.05 = 0.80
    expect(concreteBeta(35)).toBeCloseTo(0.8);
  });

  it("clamps at 0.65 for very high fc_", () => {
    expect(concreteBeta(100)).toBe(0.65);
  });
});

describe("concreteElasticModulus", () => {
  it("returns 4700 * sqrt(fc_)", () => {
    // fc_ = 25 → Ec = 4700 * 5 = 23500
    expect(concreteElasticModulus(25)).toBeCloseTo(23500);
  });
});

describe("psiToMpa", () => {
  it("converts 1450.38 psi to ~10 MPa", () => {
    expect(psiToMpa(1450.38)).toBeCloseTo(10, 1);
  });

  it("converts 0 psi to 0 MPa", () => {
    expect(psiToMpa(0)).toBe(0);
  });
});
