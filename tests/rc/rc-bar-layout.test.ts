import { describe, it, expect } from "vitest";
import { rectBeamBarLayout } from "@app-rc/rc-bar-layout";
import { RCDesignError } from "@app-core/errors/rc-design.error";

describe("rectBeamBarLayout", () => {
  it("lays out a 200x400 section with 2-D20 top and 6-D20 bottom bars using ACI defaults", () => {
    // cover=40, stirrup=10, aggregate=20 (ACI 318-19 Table 20.6.1.3.1)
    // min clear spacing = max(25, 20, 4/3*20) = 26.667mm
    // available width = 200 - 2*(40+10) = 100mm
    // max bars/layer = floor((100+26.667)/(20+26.667)) = 2
    const result = rectBeamBarLayout({
      b: 200,
      h: 400,
      topBars: { count: 2, diameter: 20 },
      bottomBars: { count: 6, diameter: 20 },
    });

    // top: 2 bars fit in a single layer
    expect(result.top.numberOfLayers).toBe(1);
    expect(result.top.barsPerLayer).toEqual([2]);
    expect(result.d_).toBeCloseTo(60, 1); // cover + stirrup + db/2 = 40+10+10

    // bottom: only 2 bars fit per layer -> 3 layers of 2
    expect(result.bottom.numberOfLayers).toBe(3);
    expect(result.bottom.barsPerLayer).toEqual([2, 2, 2]);
    // layer centers at 60, 105, 150 (pitch = db + 25mm layer spacing) -> centroid 105mm from bottom face
    expect(result.d).toBeCloseTo(400 - 105, 1);

    expect(result.top.As).toBeCloseTo(628.3, 1); // 2 * pi/4 * 20^2
    expect(result.bottom.As).toBeCloseTo(1885.0, 1); // 6 * pi/4 * 20^2
    expect(result.unit).toBe("mm");
    expect(result.warnings).toEqual([]);
  });

  it("fits all bars in a single layer for a wide enough section", () => {
    const result = rectBeamBarLayout({
      b: 400,
      h: 500,
      topBars: { count: 0, diameter: 20 },
      bottomBars: { count: 4, diameter: 20 },
    });

    expect(result.top.numberOfLayers).toBe(0);
    expect(result.top.barsPerLayer).toEqual([]);
    expect(result.bottom.numberOfLayers).toBe(1);
    expect(result.bottom.barsPerLayer).toEqual([4]);
  });

  it("respects explicit cover, stirrup diameter, and aggregate size overrides", () => {
    const defaultResult = rectBeamBarLayout({
      b: 300,
      h: 500,
      topBars: { count: 3, diameter: 25 },
      bottomBars: { count: 3, diameter: 25 },
    });

    const largerCoverResult = rectBeamBarLayout({
      b: 300,
      h: 500,
      topBars: { count: 3, diameter: 25 },
      bottomBars: { count: 3, diameter: 25 },
      cover: 50,
      stirrupDiameter: 12,
      maxAggregateSize: 25,
    });

    expect(largerCoverResult.d_).toBeGreaterThan(defaultResult.d_);
  });

  it("throws SECTION_TOO_NARROW_FOR_BAR when the bar cannot fit within the width", () => {
    expect(() =>
      rectBeamBarLayout({
        b: 100,
        h: 400,
        topBars: { count: 0, diameter: 20 },
        bottomBars: { count: 2, diameter: 32 },
      }),
    ).toThrow(RCDesignError);
  });

  it("throws BAR_LAYOUT_EXCEEDS_SECTION_HEIGHT when layers don't fit within h", () => {
    expect(() =>
      rectBeamBarLayout({
        b: 200,
        h: 150,
        topBars: { count: 2, diameter: 20 },
        bottomBars: { count: 6, diameter: 20 },
      }),
    ).toThrow(RCDesignError);
  });
});
