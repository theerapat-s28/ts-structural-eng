import { shellAxes, type Vec3 } from "@app-fea/frame/elements/shell/shell-axes";

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const expectVector = (actual: number[], expected: number[]) =>
  expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 12));

describe("shellAxes", () => {
  it("horizontal, counter-clockwise from above: local 1, 2, 3 = +X, +Y, +Z", () => {
    const axes = shellAxes([
      [0, 0, 0],
      [4000, 0, 0],
      [4000, 3000, 0],
      [0, 3000, 0],
    ]);
    expectVector(axes.lambda[0], [1, 0, 0]);
    expectVector(axes.lambda[1], [0, 1, 0]);
    expectVector(axes.lambda[2], [0, 0, 1]);
    expectVector(axes.origin, [2000, 1500, 0]);
    expect(axes.corners).toEqual([
      [-2000, -1500],
      [2000, -1500],
      [2000, 1500],
      [-2000, 1500],
    ]);
    expect(axes.offsets).toEqual([0, 0, 0, 0]);
  });

  it("horizontal, clockwise from above: local 3 = −Z, local 1 = +X, local 2 = −Y", () => {
    const axes = shellAxes([
      [0, 0, 0],
      [0, 3000, 0],
      [4000, 3000, 0],
      [4000, 0, 0],
    ]);
    expectVector(axes.lambda[0], [1, 0, 0]);
    expectVector(axes.lambda[1], [0, -1, 0]);
    expectVector(axes.lambda[2], [0, 0, -1]);
  });

  it("wall in the XZ plane: local 1 = +X, local 2 = +Z (up), local 3 = −Y, as for a member along +X", () => {
    const axes = shellAxes([
      [0, 0, 0],
      [6000, 0, 0],
      [6000, 0, 3000],
      [0, 0, 3000],
    ]);
    expectVector(axes.lambda[0], [1, 0, 0]);
    expectVector(axes.lambda[1], [0, 0, 1]);
    expectVector(axes.lambda[2], [0, -1, 0]);
  });

  it("inclined roof: orthonormal, right-handed, local 1 horizontal and local 2 rising", () => {
    const axes = shellAxes([
      [0, 0, 0],
      [5000, 1000, 0],
      [4000, 5000, 3000],
      [-1000, 4000, 3000],
    ]);
    const [e1, e2, e3] = axes.lambda;
    for (const e of axes.lambda) expect(dot(e, e)).toBeCloseTo(1, 12);
    expect(dot(e1, e2)).toBeCloseTo(0, 12);
    expect(dot(e2, e3)).toBeCloseTo(0, 12);
    expectVector(cross(e1, e2), e3);
    expect(e1[2]).toBeCloseTo(0, 12);
    expect(e2[2]).toBeGreaterThan(0);
    expect(e3[2]).toBeGreaterThan(0);
  });

  it("rotates local 1 and 2 about local 3 by angle", () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [4000, 0, 0],
      [4000, 3000, 0],
      [0, 3000, 0],
    ];
    const axes = shellAxes(points, Math.PI / 6);
    expectVector(axes.lambda[0], [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]);
    expectVector(axes.lambda[1], [-Math.sin(Math.PI / 6), Math.cos(Math.PI / 6), 0]);
    expectVector(axes.lambda[2], [0, 0, 1]);
  });

  it("puts a warped element's corners alternately h above and below the mean plane", () => {
    const h = 30;
    const axes = shellAxes([
      [0, 0, h],
      [4000, 0, -h],
      [4000, 3000, h],
      [0, 3000, -h],
    ]);
    expectVector(axes.lambda[2], [0, 0, 1]);
    [h, -h, h, -h].forEach((v, i) => expect(axes.offsets[i]).toBeCloseTo(v, 10));
    expect(axes.corners[2][0]).toBeCloseTo(2000, 10);
    expect(axes.corners[2][1]).toBeCloseTo(1500, 10);
  });
});
