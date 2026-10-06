import { roundToDecimalPlaces } from "@app-utils/math";
import type { LocalMemberLoad } from "../elements/fixed-end-forces";
import type {
  ExtremeValue,
  MemberDiagram,
  MemberStation,
  StationComponent,
} from "../types/results.type";
import type { FrameId } from "../types/model.type";

const COMPONENTS: StationComponent[] = ["N", "V2", "V3", "T", "M2", "M3"];
const EXTREME_GRID_INTERVALS = 200;
const OUTPUT_DECIMALS = 4;

type Side = "left" | "right";

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
): Record<StationComponent, number> => {
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
        Q[load.axis] += load.w * (m - load.start);
        I[load.axis] += (load.w * ((m - x) ** 2 - (load.start - x) ** 2)) / 2;
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

const toStation = (x: number, f: Record<StationComponent, number>): MemberStation => ({
  x: roundToDecimalPlaces(x, 3),
  N: roundToDecimalPlaces(f.N * 1e-3, OUTPUT_DECIMALS),
  V2: roundToDecimalPlaces(f.V2 * 1e-3, OUTPUT_DECIMALS),
  V3: roundToDecimalPlaces(f.V3 * 1e-3, OUTPUT_DECIMALS),
  T: roundToDecimalPlaces(f.T * 1e-6, OUTPUT_DECIMALS),
  M2: roundToDecimalPlaces(f.M2 * 1e-6, OUTPUT_DECIMALS),
  M3: roundToDecimalPlaces(f.M3 * 1e-6, OUTPUT_DECIMALS),
});

/**
 * Builds the force diagrams of one member from its start-end force and its loads.
 *
 * @param startForce - Force the start node exerts on the member, right-hand local, N and N·mm
 * @param loads - Member loads in local axes, N and mm
 * @param L - Member length in mm
 * @param stationCount - Number of evenly spaced stations (at least 2); load breakpoints and
 *   zero-shear points are added, with both sides reported at a point load
 */
export const memberDiagram = (
  memberId: FrameId,
  startForce: number[],
  loads: LocalMemberLoad[],
  L: number,
  stationCount = 21,
): MemberDiagram => {
  const breakpoints = new Set<number>([0, L]);
  for (const load of loads) {
    if (load.type === "point") breakpoints.add(load.a);
    else {
      breakpoints.add(load.start);
      breakpoints.add(load.end);
    }
  }

  const pushUnique = (list: number[], x: number) => {
    if (!list.some((v) => Math.abs(v - x) < 1e-9 * L)) list.push(x);
  };

  // Zero-shear points: V is linear between breakpoints, so the root is exact
  const roots: number[] = [];
  const sortedBreaks = [...breakpoints].sort((a, b) => a - b);
  const dense: number[] = [...sortedBreaks];
  for (let i = 0; i <= EXTREME_GRID_INTERVALS; i++)
    pushUnique(dense, (L * i) / EXTREME_GRID_INTERVALS);
  dense.sort((a, b) => a - b);
  for (let i = 0; i < dense.length - 1; i++) {
    const xa = dense[i];
    const xb = dense[i + 1];
    for (const key of ["V2", "V3"] as const) {
      const va = internalForces(startForce, loads, xa, "right")[key];
      const vb = internalForces(startForce, loads, xb, "left")[key];
      if (va * vb < 0) roots.push(xa + ((xb - xa) * va) / (va - vb));
    }
  }

  const uniform: number[] = [];
  const count = Math.max(2, Math.floor(stationCount));
  for (let i = 0; i < count; i++) pushUnique(uniform, (L * i) / (count - 1));
  const stationXs: number[] = [...uniform];
  for (const x of [...sortedBreaks, ...roots]) pushUnique(stationXs, x);
  stationXs.sort((a, b) => a - b);

  const stations: MemberStation[] = [];
  for (const x of stationXs) {
    const isBreak = sortedBreaks.some((b) => Math.abs(b - x) < 1e-9 * L);
    const right = internalForces(startForce, loads, x, "right");
    if (isBreak && x > 0 && x < L) {
      const left = internalForces(startForce, loads, x, "left");
      if (COMPONENTS.some((c) => Math.abs(left[c] - right[c]) > 1e-9)) {
        stations.push(toStation(x, left));
      }
    }
    stations.push(toStation(x, right));
  }

  // Extremes over every station plus the dense grid, both sides of each breakpoint
  const extremes = {} as MemberDiagram["extremes"];
  const samples: Record<StationComponent, number>[] = [];
  const xsExtreme = [...dense, ...roots];
  for (const x of xsExtreme) {
    samples.push(internalForces(startForce, loads, x, "right"));
    samples.push(internalForces(startForce, loads, x, "left"));
  }
  const xOf = (index: number) => xsExtreme[Math.floor(index / 2)];
  for (const c of COMPONENTS) {
    let maxI = 0;
    let minI = 0;
    samples.forEach((s, i) => {
      if (s[c] > samples[maxI][c]) maxI = i;
      if (s[c] < samples[minI][c]) minI = i;
    });
    const scale = c === "N" || c === "V2" || c === "V3" ? 1e-3 : 1e-6;
    const make = (i: number): ExtremeValue => ({
      value: roundToDecimalPlaces(samples[i][c] * scale, OUTPUT_DECIMALS),
      x: roundToDecimalPlaces(xOf(i), 3),
    });
    extremes[c] = { max: make(maxI), min: make(minI) };
  }

  return { memberId, length: L, stations, extremes };
};
