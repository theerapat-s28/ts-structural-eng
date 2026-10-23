import type { SectionProperties } from "@app-core/types/section-properties.type";
import { roundToDecimalPlaces } from "@app-utils/math";
import type { Matrix } from "@app-utils/matrix";

import type { LocalMemberLoad } from "../elements/fixed-end-forces";
import type { FrameId } from "../types/model.type";
import type {
  ExtremeValue,
  MemberDiagram,
  MemberStation,
  StationComponent,
} from "../types/results.type";

type ForceComponent = "N" | "V2" | "V3" | "T" | "M2" | "M3";
type DisplacementComponent = "u1" | "u2" | "u3";
type Forces = Record<ForceComponent, number>;
type Displacements = Record<DisplacementComponent, number>;

const FORCE_COMPONENTS: ForceComponent[] = ["N", "V2", "V3", "T", "M2", "M3"];
const DISPLACEMENT_COMPONENTS: DisplacementComponent[] = ["u1", "u2", "u3"];
const COMPONENTS: StationComponent[] = [...FORCE_COMPONENTS, ...DISPLACEMENT_COMPONENTS];
/** Evenly spaced grid for the deflection extremes (force extremes need no grid: see below). */
const DEFLECTION_GRID_INTERVALS = 40;
/** Golden-section steps refining each deflection extreme between its neighbouring grid points. */
const REFINE_STEPS = 30;
const GOLDEN = (Math.sqrt(5) - 1) / 2;
// 3-point Gauss–Legendre rule on [−1, 1], exact up to degree 5
const GAUSS3_POINTS = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)];
const GAUSS3_WEIGHTS = [5 / 9, 8 / 9, 5 / 9];
const FORCE_DECIMALS = 4;
const DISPLACEMENT_DECIMALS = 5;

type Side = "left" | "right";

/** The member data a diagram needs. */
export interface DiagramMember {
  id: FrameId;
  length: number; // mm
  section: Pick<SectionProperties, "E" | "A" | "I22" | "I33">;
  lambda: Matrix; // 3×3 direction cosines, rows = local 1, 2, 3
  released: boolean[]; // 12 local end DOFs
}

/**
 * Internal forces at distance `x` from the member start, in N and N·mm. Taken from the
 * free body of the segment [0, x]; N is positive in tension, `M3` is positive for sagging
 * when local 2 points up. At a point load, `side` picks the value just before or after it.
 *
 * @param startForce - Right-hand local force the start node exerts on the member: [F1, F2, F3, M1, M2, M3]
 */
const internalForces = (
  startForce: number[],
  loads: LocalMemberLoad[],
  x: number,
  side: Side,
): Forces => {
  const [f1, f2, f3, m1, m2, m3] = startForce;
  // Q[axis]: resultant of loads in [0, x]; I[axis]: ∫(s − x)·q ds over [0, x]
  const Q = [0, 0, 0, 0];
  const I = [0, 0, 0, 0];
  for (const load of loads) {
    if (load.type === "point") {
      const included = side === "left" ? load.a < x : load.a <= x;
      if (included) {
        Q[load.axis] += load.P;
        I[load.axis] += load.P * (load.a - x);
      }
    } else {
      const m = Math.min(x, load.end);
      if (m > load.start) {
        // q(s) = w1 + k·(s − start); in u = s − x over [a, b]: q = w1 + k·(u − a)
        const k = (load.w2 - load.w1) / (load.end - load.start);
        const a = load.start - x;
        const b = m - x;
        Q[load.axis] += load.w1 * (b - a) + (k * (b - a) ** 2) / 2;
        I[load.axis] += ((load.w1 - k * a) * (b ** 2 - a ** 2)) / 2 + (k * (b ** 3 - a ** 3)) / 3;
      }
    }
  }
  return {
    N: -f1 - Q[1],
    V2: -f2 - Q[2],
    V3: -f3 - Q[3],
    T: -m1,
    M2: -m2 - x * f3 + I[3],
    M3: -m3 + x * f2 - I[2],
  };
};

/**
 * Local displacements u1, u2, u3 (mm) at every grid point, from Euler–Bernoulli kinematics:
 * `u1' = N/EA`, `u2'' = M3/EI33` (R3 = u2'), `u3'' = −M2/EI22` (R2 = −u3').
 *
 * Each field is `a + b·x + x·∫₀ˣκ − ∫₀ˣ s·κ`, with the running integrals accumulated once along
 * the sorted grid. The grid contains every load breakpoint, so each interval lies inside one
 * smooth piece where N is at most quadratic and M at most cubic, and one 3-point Gauss panel per
 * interval integrates the (at most quartic) integrands exactly.
 *
 * The constants come from the member's own end displacements: end translations first, an end
 * rotation only where a translation is released. A released rotation (hinge) never enters, so
 * the curve is correct at hinged ends whose rotation differs from the node's.
 */
const displacementsOnGrid = (
  member: DiagramMember,
  startForce: number[],
  endDisplacements: number[],
  loads: LocalMemberLoad[],
  grid: number[],
): { onGrid: Displacements[]; at: (x: number) => Displacements } => {
  const { E, A, I22, I33 } = member.section;
  const L = member.length;
  const n = grid.length;

  // integrands: [N/EA, M3/EI33, s·M3/EI33, −M2/EI22, −s·M2/EI22]
  const integrands = (s: number) => {
    const f = internalForces(startForce, loads, s, "right");
    const k3 = f.M3 / (E * I33);
    const k2 = -f.M2 / (E * I22);
    return [f.N / (E * A), k3, s * k3, k2, s * k2];
  };
  /** ∫ₐᵇ of every integrand: one 3-point Gauss panel, interior points only (no load side). */
  const panel = (a: number, b: number): number[] => {
    const half = (b - a) / 2;
    const mid = (a + b) / 2;
    const out = [0, 0, 0, 0, 0];
    GAUSS3_POINTS.forEach((p, k) => {
      const g = integrands(mid + half * p);
      for (let c = 0; c < 5; c++) out[c] += half * GAUSS3_WEIGHTS[k] * g[c];
    });
    return out;
  };
  const cumulative = Array.from({ length: 5 }, () => new Float64Array(n));
  for (let i = 1; i < n; i++) {
    const g = panel(grid[i - 1], grid[i]);
    for (let c = 0; c < 5; c++) cumulative[c][i] = cumulative[c][i - 1] + g[c];
  }
  const [strain, k3, sk3, k2, sk2] = cumulative;
  const last = n - 1;

  /** a, b of `u = a + b·x + P(x)` from the first independent pair of end conditions. */
  const planeConstants = (
    translation: number,
    rotation: number,
    rotationSign: number,
    PL: number, // P(L)
    dPL: number, // P'(L)
  ) => {
    const { released } = member;
    // rows [ca, cb | rhs] of ca·a + cb·b = rhs
    const conditions: [number, number, number][] = [];
    if (!released[translation]) conditions.push([1, 0, endDisplacements[translation]]);
    if (!released[6 + translation]) {
      conditions.push([1, L, endDisplacements[6 + translation] - PL]);
    }
    if (!released[rotation]) conditions.push([0, 1, rotationSign * endDisplacements[rotation]]);
    if (!released[6 + rotation]) {
      conditions.push([0, 1, rotationSign * endDisplacements[6 + rotation] - dPL]);
    }
    for (let i = 0; i < conditions.length; i++) {
      for (let j = i + 1; j < conditions.length; j++) {
        const [a1, b1, r1] = conditions[i];
        const [a2, b2, r2] = conditions[j];
        const det = a1 * b2 - a2 * b1;
        if (Math.abs(det) > 1e-12 * Math.max(1, L)) {
          return { a: (r1 * b2 - r2 * b1) / det, b: (a1 * r2 - a2 * r1) / det };
        }
      }
    }
    return { a: 0, b: 0 }; // unreachable: such releases are rejected as a mechanism (307)
  };

  const P3 = (i: number) => grid[i] * k3[i] - sk3[i];
  const P2 = (i: number) => grid[i] * k2[i] - sk2[i];
  const plane2 = planeConstants(1, 5, 1, P3(last), k3[last]); // u2, with u2' = R3
  const plane3 = planeConstants(2, 4, -1, P2(last), k2[last]); // u3, with u3' = −R2
  const axialStart = member.released[0] ? endDisplacements[6] - strain[last] : endDisplacements[0];

  const onGrid = grid.map((x, i) => ({
    u1: axialStart + strain[i],
    u2: plane2.a + plane2.b * x + P3(i),
    u3: plane3.a + plane3.b * x + P2(i),
  }));

  /** Displacement anywhere: the grid value plus one exact Gauss panel to x. */
  const at = (x: number): Displacements => {
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (grid[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    const a = grid[lo];
    if (x - a <= 0) return onGrid[lo];
    const g = panel(a, x);
    const c = cumulative.map((col, k) => col[lo] + g[k]);
    return {
      u1: axialStart + c[0],
      u2: plane2.a + plane2.b * x + (x * c[1] - c[2]),
      u3: plane3.a + plane3.b * x + (x * c[3] - c[4]),
    };
  };

  return { onGrid, at };
};

const SCALE: Record<StationComponent, number> = {
  N: 1e-3,
  V2: 1e-3,
  V3: 1e-3,
  T: 1e-6,
  M2: 1e-6,
  M3: 1e-6,
  u1: 1,
  u2: 1,
  u3: 1,
};
const present = (c: StationComponent, value: number) =>
  roundToDecimalPlaces(
    value * SCALE[c],
    c === "u1" || c === "u2" || c === "u3" ? DISPLACEMENT_DECIMALS : FORCE_DECIMALS,
  ) + 0;

/**
 * Builds the force and displacement diagrams of one member from its end forces, its end
 * displacements and its loads.
 *
 * @param member - Member geometry, section, axes and end releases
 * @param startForce - Force the start node exerts on the member, right-hand local, N and N·mm
 * @param endDisplacements - The 12 local right-hand displacements of the member's end nodes, mm and rad
 * @param loads - Member loads in local axes, N and mm
 * @param stationCount - Number of evenly spaced stations (at least 2); load breakpoints and
 *   zero-shear points are added, with both sides reported at a point load
 * @param withStations - false returns the extremes only, with an empty `stations` array
 */
export const memberDiagram = (
  member: DiagramMember,
  startForce: number[],
  endDisplacements: number[],
  loads: LocalMemberLoad[],
  stationCount = 21,
  withStations = true,
): MemberDiagram => {
  const L = member.length;
  const tolerance = 1e-9 * L;
  const breakpoints = new Set<number>([0, L]);
  for (const load of loads) {
    if (load.type === "point") breakpoints.add(load.a);
    else {
      breakpoints.add(load.start);
      breakpoints.add(load.end);
    }
  }
  const sortedBreaks = [...breakpoints].sort((a, b) => a - b);
  const isBreak = (x: number) => sortedBreaks.some((b) => Math.abs(b - x) < tolerance);

  /** Sorted, with points closer than the tolerance merged (the first one kept). */
  const mergeSorted = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted)
      if (out.length === 0 || v - out[out.length - 1] >= tolerance) out.push(v);
    return out;
  };

  // Inside each piece between breakpoints N and V are at most quadratic (linear loads), so the
  // quadratic through both ends and the midpoint is exact. Its roots (zero shear: the moment
  // extremes) and its vertex (zero load: the N and V extremes) are added to the grid.
  const roots: number[] = [];
  for (let i = 0; i < sortedBreaks.length - 1; i++) {
    const xa = sortedBreaks[i];
    const xb = sortedBreaks[i + 1];
    const fa = internalForces(startForce, loads, xa, "right");
    const fm = internalForces(startForce, loads, (xa + xb) / 2, "right");
    const fb = internalForces(startForce, loads, xb, "left");
    const inside = (t: number) => t > 0 && t < 1 && roots.push(xa + (xb - xa) * t);
    for (const key of ["N", "V2", "V3"] as const) {
      // f(t) = A·t² + B·t + C on t ∈ [0, 1]
      const C = fa[key];
      const A = 2 * fa[key] - 4 * fm[key] + 2 * fb[key];
      const B = 4 * fm[key] - 3 * fa[key] - fb[key];
      const scale = Math.max(Math.abs(fa[key]), Math.abs(fm[key]), Math.abs(fb[key]));
      const curved = Math.abs(A) > 1e-12 * scale;
      if (curved) inside(-B / (2 * A));
      if (key === "N") continue;
      if (!curved) {
        if (Math.abs(B) > 1e-12 * scale) inside(-C / B);
      } else {
        const disc = B * B - 4 * A * C;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          inside((-B - sq) / (2 * A));
          inside((-B + sq) / (2 * A));
        }
      }
    }
  }
  const coarse = Array.from(
    { length: DEFLECTION_GRID_INTERVALS + 1 },
    (_, i) => (L * i) / DEFLECTION_GRID_INTERVALS,
  );

  const count = Math.max(2, Math.floor(stationCount));
  const uniform = withStations
    ? Array.from({ length: count }, (_, i) => (L * i) / (count - 1))
    : [];
  // One grid for everything: breakpoints, zero-shear points, stations and the deflection grid
  const grid = mergeSorted([...sortedBreaks, ...roots, ...uniform, ...coarse]);
  const field = displacementsOnGrid(member, startForce, endDisplacements, loads, grid);
  const displacements = field.onGrid;
  const gridIndex = (x: number) => {
    let lo = 0;
    let hi = grid.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (grid[mid] < x - tolerance) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  // ---- Stations -------------------------------------------------------------------
  const stations: MemberStation[] = [];
  if (withStations) {
    const [l1, l2, l3] = member.lambda;
    const toStation = (x: number, f: Forces, u: Displacements): MemberStation => {
      const station = { x: roundToDecimalPlaces(x, 3) } as MemberStation;
      for (const c of FORCE_COMPONENTS) station[c] = present(c, f[c]);
      for (const c of DISPLACEMENT_COMPONENTS) station[c] = present(c, u[c]);
      // global = Σ local component × its axis direction
      const g = [0, 1, 2].map((k) => u.u1 * l1[k] + u.u2 * l2[k] + u.u3 * l3[k]);
      station.ux = roundToDecimalPlaces(g[0], DISPLACEMENT_DECIMALS) + 0;
      station.uy = roundToDecimalPlaces(g[1], DISPLACEMENT_DECIMALS) + 0;
      station.uz = roundToDecimalPlaces(g[2], DISPLACEMENT_DECIMALS) + 0;
      return station;
    };
    const stationXs = mergeSorted([...uniform, ...sortedBreaks, ...roots]);
    for (const x of stationXs) {
      const u = displacements[gridIndex(x)];
      const right = internalForces(startForce, loads, x, "right");
      if (isBreak(x) && x > 0 && x < L) {
        const left = internalForces(startForce, loads, x, "left");
        if (FORCE_COMPONENTS.some((c) => Math.abs(left[c] - right[c]) > 1e-9)) {
          stations.push(toStation(x, left, u));
        }
      }
      stations.push(toStation(x, right, u));
    }
  }

  // ---- Extremes -------------------------------------------------------------------
  // N and V are at most quadratic, T constant and M at most cubic inside each piece, so their
  // extremes lie at a breakpoint (either side), a zero-load or a zero-shear point — all on the
  // grid, so these are exact.
  // Deflections are taken on the grid, then refined by golden-section search.
  const extremes = {} as MemberDiagram["extremes"];
  const best = {} as Record<
    StationComponent,
    { max: [number, number, number]; min: [number, number, number] }
  >;
  const consider = (c: StationComponent, value: number, x: number, i: number) => {
    const b = best[c];
    if (!b) best[c] = { max: [value, x, i], min: [value, x, i] };
    else {
      if (value > b.max[0]) b.max = [value, x, i];
      if (value < b.min[0]) b.min = [value, x, i];
    }
  };
  grid.forEach((x, i) => {
    const sides: Side[] = isBreak(x) && x > 0 && x < L ? ["right", "left"] : ["right"];
    for (const side of sides) {
      const f = internalForces(startForce, loads, x, side);
      for (const c of FORCE_COMPONENTS) consider(c, f[c], x, i);
    }
    for (const c of DISPLACEMENT_COMPONENTS) consider(c, displacements[i][c], x, i);
  });

  const refine = (c: DisplacementComponent, i: number, sign: 1 | -1): [number, number] => {
    // maximise sign·u between the neighbouring grid points
    let a = grid[Math.max(0, i - 1)];
    let b = grid[Math.min(grid.length - 1, i + 1)];
    const value = (x: number) => sign * field.at(x)[c];
    let x1 = b - GOLDEN * (b - a);
    let x2 = a + GOLDEN * (b - a);
    let f1 = value(x1);
    let f2 = value(x2);
    for (let step = 0; step < REFINE_STEPS; step++) {
      if (f1 < f2) {
        a = x1;
        x1 = x2;
        f1 = f2;
        x2 = a + GOLDEN * (b - a);
        f2 = value(x2);
      } else {
        b = x2;
        x2 = x1;
        f2 = f1;
        x1 = b - GOLDEN * (b - a);
        f1 = value(x1);
      }
    }
    return f1 >= f2 ? [sign * f1, x1] : [sign * f2, x2];
  };
  for (const c of DISPLACEMENT_COMPONENTS) {
    const b = best[c];
    const [maxValue, maxX] = refine(c, b.max[2], 1);
    if (maxValue > b.max[0]) b.max = [maxValue, maxX, b.max[2]];
    const [minValue, minX] = refine(c, b.min[2], -1);
    if (minValue < b.min[0]) b.min = [minValue, minX, b.min[2]];
  }

  for (const c of COMPONENTS) {
    const make = ([value, x]: [number, number, number]): ExtremeValue => ({
      value: present(c, value),
      x: roundToDecimalPlaces(x, 3),
    });
    extremes[c] = { max: make(best[c].max), min: make(best[c].min) };
  }

  return { memberId: member.id, length: L, stations, extremes };
};
