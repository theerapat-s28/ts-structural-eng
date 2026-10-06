import { rectBeamToSectionProperties } from "@app-rc/rc-section-properties";
import { concreteElasticModulus } from "@app-rc/general";

describe("rectBeamToSectionProperties", () => {
  const section = { fc_: 28, b: 300, h: 600 };
  const Ec = concreteElasticModulus(28);

  it("defaults to the beam modifier (0.35) and reports gross A and J", () => {
    const {
      sectionProperties: p,
      warnings,
      calculationDetails,
      unit,
    } = rectBeamToSectionProperties(section);
    expect(p.E).toBeCloseTo(Ec, 8);
    expect(p.G).toBeCloseTo(Ec / 2.4, 8);
    expect(p.A).toBe(180000);
    expect(p.I33).toBeCloseTo((0.35 * 300 * 600 ** 3) / 12, 4); // 1.89e9
    expect(p.I22).toBeCloseTo((0.35 * 600 * 300 ** 3) / 12, 4);
    expect(calculationDetails.inertiaModifier).toBe(0.35);
    expect(unit).toBe("N, mm, MPa");
    expect(warnings).toHaveLength(0);
  });

  it("computes the rectangle torsion constant", () => {
    // a = 600, t = 300: 600·300³·(1/3 − 0.21·0.5·(1 − 300⁴/(12·600⁴)))
    const expected = 600 * 300 ** 3 * (1 / 3 - 0.21 * 0.5 * (1 - 1 / 192));
    expect(rectBeamToSectionProperties(section).sectionProperties.J).toBeCloseTo(expected, 4);
    // square 100×100 ≈ 0.1406·a⁴ (textbook value)
    const square = rectBeamToSectionProperties({ fc_: 28, b: 100, h: 100 }).sectionProperties.J;
    expect(square / 100 ** 4).toBeCloseTo(0.1408, 3);
  });

  it("uses 0.70 for columns, a custom modifier, and Poisson's ratio", () => {
    const col = rectBeamToSectionProperties(section, { member: "column" }).sectionProperties;
    expect(col.I33).toBeCloseTo((0.7 * 300 * 600 ** 3) / 12, 4);
    const custom = rectBeamToSectionProperties(section, {
      inertiaModifier: 0.5,
      poissonRatio: 0.25,
    });
    expect(custom.sectionProperties.I33).toBeCloseTo((0.5 * 300 * 600 ** 3) / 12, 4);
    expect(custom.sectionProperties.G).toBeCloseTo(Ec / 2.5, 8);
  });

  it("warns, citing ACI 6.6.3.1.1, when gross inertia is used", () => {
    const { warnings, sectionProperties } = rectBeamToSectionProperties(section, {
      member: "gross",
    });
    expect(sectionProperties.I33).toBeCloseTo((300 * 600 ** 3) / 12, 4);
    expect(warnings.map((w) => w.reference)).toContain("ACI318-19, 6.6.3.1.1");
  });
});
