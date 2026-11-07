import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/fea.constant";
import { STRIP_DEFAULT_DIVISIONS, STRIP_PLANE_TOLERANCE } from "@app-core/constants/shell.constant";
import type { Warnings } from "@app-core/types/output-message.type";
import type { FeaId } from "@app-fea/shared/types/model.type";
import { roundToDecimalPlaces } from "@app-utils/math";

import {
  bilinearShape,
  cartesianDerivatives,
  quadJacobian,
  type Vec2,
} from "../elements/quad-geometry";
import type { Vec3 } from "../elements/shell-axes";
import type { SystemShell } from "../solver/system-shell";
import type { ShellStrip } from "../types/model.type";
import type {
  StripForceComponent,
  StripForces,
  StripResultants,
  StripStation,
} from "../types/results.type";
import { SHELL_FORCE_COMPONENTS } from "./shell-forces";

/** The strip resultants, in the order of the raw values. */
export const STRIP_COMPONENTS: readonly StripForceComponent[] = ["P", "V", "M", "T", "Vp", "Mp"];
const [P, V, M, T, VP, MP] = [0, 1, 2, 3, 4, 5];
const RAW_LENGTH = 4 * SHELL_FORCE_COMPONENTS;

const FORCE_DECIMALS = 4;
const LENGTH_DECIMALS = 3;

/** 4-point Gauss–Legendre rule on −1 ≤ t ≤ 1. */
const GAUSS_4 = (() => {
  const a = Math.sqrt(3 / 7 - (2 / 7) * Math.sqrt(6 / 5));
  const b = Math.sqrt(3 / 7 + (2 / 7) * Math.sqrt(6 / 5));
  const wa = (18 + Math.sqrt(30)) / 36;
  const wb = (18 - Math.sqrt(30)) / 36;
  return [
    { t: -b, w: wb },
    { t: -a, w: wa },
    { t: a, w: wa },
    { t: b, w: wb },
  ];
})();

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: Vec3, q: Vec3): Vec3 => [
  p[1] * q[2] - p[2] * q[1],
  p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0],
];
const scale = (p: Vec3, k: number): Vec3 => [p[0] * k, p[1] * k, p[2] * k];
const add = (p: Vec3, q: Vec3): Vec3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const unit = (p: Vec3): Vec3 => scale(p, 1 / Math.hypot(p[0], p[1], p[2]));

/** The shell forces of one element that one station's resultants take, per raw component. */
interface StationTerm {
  shell: number; // index into the system shells
  coef: number[][]; // 6 resultants × 32 raw corner components (see `shellRawForces`)
}

/** One cut across a strip, ready to turn shell forces into resultants. */
interface PreparedStation {
  x: number; // mm
  point: Vec3;
  segment: number;
  width: number; // covered length of the cut (mm)
  full: boolean; // covered over the whole strip width
  terms: StationTerm[];
}

/** A strip with its stations prepared: the resultants are linear in the shell forces. */
export interface PreparedStrip {
  id: FeaId;
  stations: PreparedStation[];
}

/** A shell element of the strip's plane, with what the cut needs. */
interface PlaneElement {
  index: number;
  shell: SystemShell;
  size: number; // longest side, mm
  sign: 1 | -1; // +1 when the element's local 3 is the strip's normal, −1 when opposite
  points: Vec3[]; // its corners in global axes
}

/**
 * Natural coordinates (ξ, η) of a point of the element plane, by Newton's method on the
 * bilinear map (exact in one step for a parallelogram).
 */
export const inverseBilinear = (corners: readonly Vec2[], x: number, y: number): Vec2 => {
  let xi = 0;
  let eta = 0;
  for (let k = 0; k < 25; k++) {
    const { N, dXi, dEta } = bilinearShape(xi, eta);
    let rx = x;
    let ry = y;
    let xXi = 0;
    let yXi = 0;
    let xEta = 0;
    let yEta = 0;
    for (let i = 0; i < 4; i++) {
      rx -= N[i] * corners[i][0];
      ry -= N[i] * corners[i][1];
      xXi += dXi[i] * corners[i][0];
      yXi += dXi[i] * corners[i][1];
      xEta += dEta[i] * corners[i][0];
      yEta += dEta[i] * corners[i][1];
    }
    const det = xXi * yEta - xEta * yXi;
    const dXiStep = (yEta * rx - xEta * ry) / det;
    const dEtaStep = (-yXi * rx + xXi * ry) / det;
    xi += dXiStep;
    eta += dEtaStep;
    if (Math.abs(dXiStep) + Math.abs(dEtaStep) < 1e-13) break;
  }
  return [xi, eta];
};

/**
 * The interval of the cut `c + s·d` (element-plane coordinates, mm) inside a convex quad with
 * counter-clockwise corners, clipped to `lo ≤ s ≤ hi` (Cyrus–Beck). A cut lying along an edge,
 * within `eps`, counts as inside.
 *
 * @returns `[from, to]`, or null when the cut misses the quad or touches it over less than `eps`
 */
export const clipToQuad = (
  corners: readonly Vec2[],
  c: Vec2,
  d: Vec2,
  lo: number,
  hi: number,
  eps: number,
): [number, number] | null => {
  let from = lo;
  let to = hi;
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % 4];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const length = Math.hypot(ex, ey);
    const n: Vec2 = [-ey / length, ex / length]; // inward normal of a counter-clockwise quad
    const distance = n[0] * (c[0] - p[0]) + n[1] * (c[1] - p[1]);
    const rate = n[0] * d[0] + n[1] * d[1];
    // inside where distance + s·rate ≥ 0
    if (Math.abs(rate) * Math.max(Math.abs(lo), Math.abs(hi)) <= eps) {
      if (distance < -eps) return null;
      continue;
    }
    const s = -distance / rate;
    if (rate > 0) from = Math.max(from, s);
    else to = Math.min(to, s);
  }
  return to - from > eps ? [from, to] : null;
};

/** The shell elements lying in a strip's plane (through `origin`, normal `n`). */
const planeElements = (shells: SystemShell[], origin: Vec3, n: Vec3): PlaneElement[] =>
  shells.flatMap((shell, index) => {
    const { lambda, origin: centre, corners, offsets } = shell.element.axes;
    const size = Math.max(
      ...corners.map((p, i) => {
        const q = corners[(i + 1) % 4];
        return Math.hypot(q[0] - p[0], q[1] - p[1]);
      }),
    );
    const tolerance = STRIP_PLANE_TOLERANCE * size;
    const e1 = lambda[0] as Vec3;
    const e2 = lambda[1] as Vec3;
    const e3 = lambda[2] as Vec3;
    // the element's corners in global axes, as it was built (mean plane plus warping offsets)
    const points = corners.map((p, i) =>
      add(add(add(centre, scale(e1, p[0])), scale(e2, p[1])), scale(e3, offsets[i])),
    );
    const inPlane = points.every((point) => Math.abs(dot(sub(point, origin), n)) <= tolerance);
    if (!inPlane) return [];
    return [{ index, shell, size, sign: dot(e3, n) >= 0 ? 1 : -1, points }];
  });

/** Adds one Gauss point of the cut in one element to the station's coefficients. */
const addGaussPoint = (
  coef: number[][],
  element: PlaneElement,
  axes: { a: Vec3; b: Vec3 },
  local: Vec2,
  s: number,
  weight: number,
) => {
  const { lambda, corners } = element.shell.element.axes;
  const e1 = lambda[0] as Vec3;
  const e2 = lambda[1] as Vec3;
  const ca1 = dot(axes.a, e1);
  const ca2 = dot(axes.a, e2);
  const cb1 = dot(axes.b, e1);
  const cb2 = dot(axes.b, e2);
  // a·X·a and b·X·a of a symmetric tensor X with components 11, 22, 12 in element axes
  const aa = [ca1 * ca1, ca2 * ca2, 2 * ca1 * ca2];
  const ba = [cb1 * ca1, cb2 * ca2, cb1 * ca2 + cb2 * ca1];
  const sign = element.sign;

  const [xi, eta] = inverseBilinear(corners, local[0], local[1]);
  const shape = bilinearShape(xi, eta);
  const { dX, dY } = cartesianDerivatives(quadJacobian(corners, xi, eta), shape);

  for (let c = 0; c < 4; c++) {
    const base = SHELL_FORCE_COMPONENTS * c;
    const N = shape.N[c] * weight;
    for (let j = 0; j < 3; j++) {
      // membrane forces F11, F22, F12
      coef[P][base + j] += aa[j] * N;
      coef[VP][base + j] += ba[j] * N;
      coef[MP][base + j] -= s * aa[j] * N;
      // moments M11, M22, M12, about the strip normal
      coef[M][base + 3 + j] += sign * aa[j] * N;
      coef[T][base + 3 + j] += sign * ba[j] * N;
    }
    // Kirchhoff shear: V = −∫ ∂M_aa/∂a ds and T = ∫ (2·m_ab − s·∂M_aa/∂a) ds, on the bilinear
    // moment field through the corner values (the transverse shear Q_a plus the edge forces of
    // the twisting moment at the ends of each element's piece of the cut)
    const slope = ca1 * dX[c] + ca2 * dY[c]; // ∂N_c/∂a
    for (let j = 0; j < 3; j++) {
      const dM = sign * aa[j] * slope * weight;
      coef[V][base + 3 + j] -= dM;
      coef[T][base + 3 + j] += sign * ba[j] * N - s * dM; // with the m_ab term above: 2·m_ab
    }
  }
};

/** The station's coefficients for one element, created on first use. */
const termFor = (terms: Map<number, StationTerm>, element: PlaneElement): number[][] => {
  let term = terms.get(element.index);
  if (!term) {
    term = {
      shell: element.index,
      coef: STRIP_COMPONENTS.map(() => new Array<number>(RAW_LENGTH).fill(0)),
    };
    terms.set(element.index, term);
  }
  return term.coef;
};

/** Element-plane coordinates of the cut point at offset `s` (mm). */
const localPoint = (element: PlaneElement, centre: Vec3, b: Vec3, s: number): Vec2 => {
  const { lambda, origin } = element.shell.element.axes;
  const relative = sub(add(centre, scale(b, s)), origin);
  return [dot(relative, lambda[0] as Vec3), dot(relative, lambda[1] as Vec3)];
};

/**
 * Prepares one cut: the part of the line `centre + s·b`, −widthRight ≤ s ≤ widthLeft, on each
 * element of the plane, and the Gauss points that integrate the element's force field there.
 * Where elements overlap on the cut (a cut along a shared edge), each takes an equal share.
 */
const prepareStation = (
  elements: PlaneElement[],
  centre: Vec3,
  axes: { a: Vec3; b: Vec3 },
  widthLeft: number,
  widthRight: number,
): Pick<PreparedStation, "width" | "full" | "terms"> => {
  const pieces: { element: PlaneElement; from: number; to: number }[] = [];
  for (const element of elements) {
    const { lambda, origin, corners } = element.shell.element.axes;
    const e1 = lambda[0] as Vec3;
    const e2 = lambda[1] as Vec3;
    const relative = sub(centre, origin);
    const clipped = clipToQuad(
      corners,
      [dot(relative, e1), dot(relative, e2)],
      [dot(axes.b, e1), dot(axes.b, e2)],
      -widthRight,
      widthLeft,
      AREA_GEOMETRY_TOLERANCE * element.size,
    );
    if (clipped) pieces.push({ element, from: clipped[0], to: clipped[1] });
  }

  const full = widthLeft + widthRight;
  const eps = AREA_GEOMETRY_TOLERANCE * Math.max(full, ...pieces.map((p) => p.element.size));
  const breaks = [...new Set(pieces.flatMap((p) => [p.from, p.to]))].sort((u, v) => u - v);
  const terms = new Map<number, StationTerm>();
  // covered sub-intervals, in order, with the elements over each
  const covered: { u: number; v: number; on: PlaneElement[] }[] = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const [u, v] = [breaks[i], breaks[i + 1]];
    if (v - u <= eps) continue;
    const middle = (u + v) / 2;
    const on = pieces.filter((p) => p.from < middle && middle < p.to).map((p) => p.element);
    if (on.length > 0) covered.push({ u, v, on });
  }

  let width = 0;
  for (const { u, v, on } of covered) {
    width += v - u;
    const half = (v - u) / 2;
    const middle = (u + v) / 2;
    for (const element of on) {
      const coef = termFor(terms, element);
      for (const { t, w } of GAUSS_4) {
        const s = middle + half * t;
        addGaussPoint(
          coef,
          element,
          axes,
          localPoint(element, centre, axes.b, s),
          s,
          (w * half) / on.length,
        );
      }
    }
  }
  return { width, full: width >= full - eps, terms: [...terms.values()] };
};

type StripCut = Pick<PreparedStation, "width" | "full" | "terms">;

/** A cut and its share in a recovered shear. */
interface RecoverySample {
  cut: StripCut;
  weight: number;
}

/** The mesh lines across one strip segment, and the cuts through the elements between them. */
interface SegmentMesh {
  /** Distance along the segment of each line across it (mm), sorted. */
  lines: number[];
  /** Whether the shear jumps at each line: something outside the slab acts on it there. */
  breaks: boolean[];
  tolerance: number; // mm
  /** The cut through the centres of the elements between lines `i` and `i + 1`. */
  cellCut: (cell: number) => StripCut;
}

/**
 * The lines where the elements under a segment meet, and those where the shear jumps: a line with
 * a node in the band where a support, a member, a nodal load or a shell off the plane acts. A run
 * of such lines is something lying along the strip, such as a beam or a wall, which takes load
 * all along it with no jump, so it marks none.
 */
const segmentMesh = (
  elements: PlaneElement[],
  forceNodes: ReadonlySet<number>,
  origin: Vec3,
  axes: { a: Vec3; b: Vec3 },
  widthLeft: number,
  widthRight: number,
  cutAt: (along: number) => StripCut,
): SegmentMesh => {
  const size = Math.max(1, ...elements.map((e) => e.size));
  const tolerance = AREA_GEOMETRY_TOLERANCE * size;
  const corners = elements.flatMap((element) => {
    const across = element.points.map((p) => dot(sub(p, origin), axes.b));
    if (Math.min(...across) >= widthLeft - tolerance) return [];
    if (Math.max(...across) <= -widthRight + tolerance) return [];
    return element.points.map((p, i) => ({
      along: dot(sub(p, origin), axes.a),
      across: across[i],
      node: element.shell.nodeIndices[i],
    }));
  });

  const lines: number[] = [];
  for (const along of corners.map((c) => c.along).sort((u, v) => u - v)) {
    if (lines.length === 0 || along - lines[lines.length - 1] > tolerance) lines.push(along);
  }
  const lineAt = (along: number) => lines.findIndex((s) => Math.abs(s - along) <= tolerance);
  const marked = lines.map(() => false);
  for (const { along, across, node } of corners) {
    const inBand = across <= widthLeft + tolerance && across >= -widthRight - tolerance;
    if (inBand && forceNodes.has(node)) marked[lineAt(along)] = true;
  }
  const breaks = marked.map(
    (mark, i) =>
      mark &&
      !(marked[i - 1] && marked[i + 1]) &&
      !(marked[i - 1] && marked[i - 2]) &&
      !(marked[i + 1] && marked[i + 2]),
  );

  const cuts = new Map<number, StripCut>();
  const cellCut = (cell: number): StripCut => {
    let cut = cuts.get(cell);
    if (!cut) {
      cut = cutAt((lines[cell] + lines[cell + 1]) / 2);
      cuts.set(cell, cut);
    }
    return cut;
  };
  return { lines, breaks, tolerance, cellCut };
};

/**
 * The cuts that give the shear at `along` from one cell: the straight line through the centres of
 * that cell and its neighbour on the side of `along`, or the neighbour on the other side, extended
 * to `along`, where the first is across a jump or off the same cover of shells.
 */
const lineThroughCentres = (mesh: SegmentMesh, cell: number, along: number): RecoverySample[] => {
  const { lines, breaks, tolerance, cellCut } = mesh;
  const centre = (i: number) => (lines[i] + lines[i + 1]) / 2;
  const cut = cellCut(cell);
  const reaches = (neighbour: number): boolean => {
    if (neighbour < 0 || neighbour >= lines.length - 1) return false;
    if (breaks[Math.max(cell, neighbour)]) return false;
    return Math.abs(cellCut(neighbour).width - cut.width) <= tolerance;
  };
  const near = along < centre(cell) ? cell - 1 : cell + 1;
  const far = along < centre(cell) ? cell + 1 : cell - 1;
  const neighbour = [near, far].find(reaches);
  if (neighbour === undefined) return [{ cut, weight: 1 }];
  const share = (along - centre(cell)) / (centre(neighbour) - centre(cell));
  return [
    { cut, weight: 1 - share },
    { cut: cellCut(neighbour), weight: share },
  ];
};

/**
 * The cuts that give the shear and torsion of a station, or null to keep the cut's own. Within an
 * element they are constant along the strip, true at its centre, so they are taken on the straight
 * line through the centres of the elements either side. A station at an end of the segment on a
 * mesh line reads the side it is on, up to a support; one inside the segment on a jump takes the
 * mean of its two sides.
 */
const recoverySamples = (
  mesh: SegmentMesh,
  along: number,
  end: "start" | "end" | null,
): RecoverySample[] | null => {
  const { lines, breaks, tolerance, cellCut } = mesh;
  if (lines.length < 2) return null;
  const line = lines.findIndex((s) => Math.abs(s - along) <= tolerance);
  const lastCell = lines.length - 2;
  let cell: number;
  if (line >= 0) {
    if (line === 0) cell = 0;
    else if (line === lines.length - 1) cell = lastCell;
    else if (end === "start") cell = line;
    else if (end === "end") cell = line - 1;
    else if (breaks[line]) {
      return [
        ...lineThroughCentres(mesh, line - 1, along),
        ...lineThroughCentres(mesh, line, along),
      ].map(({ cut, weight }) => ({ cut, weight: weight / 2 }));
    } else cell = line - 1;
  } else {
    cell = lines.findIndex((s, i) => i < lines.length - 1 && along > s && along < lines[i + 1]);
    if (cell < 0) return null; // past the shells
  }
  return cellCut(cell).width > 0 ? lineThroughCentres(mesh, cell, along) : null;
};

/** The station's terms with its shear and torsion taken from the samples. */
const withRecoveredShear = (terms: StationTerm[], samples: RecoverySample[]): StationTerm[] => {
  const recovered = new Map<number, StationTerm>(
    terms.map(({ shell, coef }) => [
      shell,
      {
        shell,
        coef: coef.map((row, r) =>
          r === V || r === T ? new Array<number>(RAW_LENGTH).fill(0) : row,
        ),
      },
    ]),
  );
  for (const { cut, weight } of samples) {
    for (const { shell, coef } of cut.terms) {
      let term = recovered.get(shell);
      if (!term) {
        term = {
          shell,
          coef: STRIP_COMPONENTS.map(() => new Array<number>(RAW_LENGTH).fill(0)),
        };
        recovered.set(shell, term);
      }
      for (const r of [V, T]) {
        for (let i = 0; i < RAW_LENGTH; i++) term.coef[r][i] += weight * coef[r][i];
      }
    }
  }
  return [...recovered.values()];
};

/**
 * Prepares every strip of a model that passed `validateModel`: its stations and, for each, the
 * linear map from the shell elements' raw corner forces to the six resultants on the cut. The
 * shell force field of each element is integrated on its own (no averaging between elements),
 * except V and T, which are recovered from the element centres (see `recoverySamples`).
 *
 * @param strips - The model's strips
 * @param shells - The analysed shell elements
 * @param forceNodes - Indices of the nodes where something other than the shells acts: supports,
 *   members and nodal loads. The shear jumps there, so it is not interpolated across them
 * @returns The prepared strips, and a warning for each strip with stations not fully on shells
 */
export const prepareStrips = (
  strips: ShellStrip[],
  shells: SystemShell[],
  forceNodes: ReadonlySet<number> = new Set(),
): { strips: PreparedStrip[]; warnings: Warnings } => {
  const warnings: Warnings = [];
  const prepared = strips.map((strip): PreparedStrip => {
    const n = unit(strip.normal ?? [0, 0, 1]);
    const points = strip.points.map((p): Vec3 => [p.x, p.y, p.z]);
    const elements = planeElements(shells, points[0], n);
    const inPlane = new Set(elements.map((e) => e.index));
    // a wall meeting the slab acts on it like a support
    const acting = new Set(forceNodes);
    shells.forEach((shell, index) => {
      if (!inPlane.has(index)) shell.nodeIndices.forEach((node) => acting.add(node));
    });
    const stations: PreparedStation[] = [];
    let x0 = 0;
    for (let k = 0; k + 1 < points.length; k++) {
      const chord = sub(points[k + 1], points[k]);
      const along = sub(chord, scale(n, dot(chord, n))); // in the strip plane
      const length = Math.hypot(along[0], along[1], along[2]);
      const a = scale(along, 1 / length);
      const b = cross(n, a);
      const count =
        strip.maxSpacing !== undefined
          ? Math.max(1, Math.ceil(length / strip.maxSpacing - 1e-9))
          : STRIP_DEFAULT_DIVISIONS;
      const start = points[k];
      const mesh = segmentMesh(
        elements,
        acting,
        start,
        { a, b },
        strip.widthLeft,
        strip.widthRight,
        (along) =>
          prepareStation(
            elements,
            add(start, scale(a, along)),
            { a, b },
            strip.widthLeft,
            strip.widthRight,
          ),
      );
      for (let j = 0; j <= count; j++) {
        const t = j / count;
        const point = add(start, scale(chord, t));
        const cut = prepareStation(elements, point, { a, b }, strip.widthLeft, strip.widthRight);
        const samples =
          cut.width > 0
            ? recoverySamples(mesh, t * length, j === 0 ? "start" : j === count ? "end" : null)
            : null;
        stations.push({
          x: x0 + t * length,
          point,
          segment: k,
          ...cut,
          terms: samples ? withRecoveredShear(cut.terms, samples) : cut.terms,
        });
      }
      x0 += length;
    }

    const partial = stations.filter((st) => !st.full).length;
    if (stations.every((st) => st.width === 0)) {
      warnings.push({
        reference: "Strip forces, shell coverage",
        message: `Strip "${String(strip.id)}" crosses no shell element in its plane; all its forces are 0.`,
      });
    } else if (partial > 0) {
      warnings.push({
        reference: "Strip forces, shell coverage",
        message: `Strip "${String(strip.id)}": ${partial} of ${stations.length} stations are not fully on shell elements in its plane (an opening, a slab edge or a strip wider than the slab); their resultants cover the shells crossed and their per-width values use that covered width.`,
      });
    }
    return { id: strip.id, stations };
  });
  return { strips: prepared, warnings };
};

/**
 * Unrounded resultants [P, V, M, T, Vp, Mp] (N, N·mm) of each station of a prepared strip.
 * Linear in `shellForces`, so they superpose like the shell forces.
 *
 * @param shellForces - Raw corner forces of every shell element (see `shellRawForces`)
 */
export const stripRawForces = (strip: PreparedStrip, shellForces: number[][]): number[][] =>
  strip.stations.map(({ terms }) => {
    const out = [0, 0, 0, 0, 0, 0];
    for (const { shell, coef } of terms) {
      const raw = shellForces[shell];
      for (let r = 0; r < 6; r++) {
        let sum = 0;
        for (let i = 0; i < RAW_LENGTH; i++) sum += coef[r][i] * raw[i];
        out[r] += sum;
      }
    }
    return out;
  });

const round = (value: number, decimals = FORCE_DECIMALS) =>
  roundToDecimalPlaces(value, decimals) + 0; // + 0: no −0

/**
 * The presented forces of one strip: totals in kN and kN·m, per-width values in kN/m and
 * kN·m/m, and the max and min of each total along the strip.
 *
 * @param shellForces - Raw corner forces of every shell element, for one case or combination
 */
export const presentStripForces = (strip: PreparedStrip, shellForces: number[][]): StripForces => {
  const raw = stripRawForces(strip, shellForces);
  const stations = strip.stations.map((station, i): StripStation => {
    const values = raw[i];
    // N → kN for forces, N·mm → kN·m for moments
    const totals = STRIP_COMPONENTS.map((_, r) =>
      r === M || r === T || r === MP ? values[r] * 1e-6 : values[r] * 1e-3,
    );
    const resultants = {} as StripResultants;
    const perWidth = {} as StripResultants;
    STRIP_COMPONENTS.forEach((key, r) => {
      resultants[key] = round(totals[r]);
      // kN ÷ m and kN·m ÷ m; the width is in mm
      perWidth[key] = station.width > 0 ? round(totals[r] / (station.width * 1e-3)) : 0;
    });
    return {
      x: round(station.x, LENGTH_DECIMALS),
      point: station.point.map((v) => round(v, LENGTH_DECIMALS)) as [number, number, number],
      segment: station.segment,
      width: round(station.width, LENGTH_DECIMALS),
      ...resultants,
      perWidth,
    };
  });

  const extremes = {} as StripForces["extremes"];
  for (const key of STRIP_COMPONENTS) {
    let max = { value: stations[0][key], x: stations[0].x };
    let min = max;
    for (const station of stations) {
      if (station[key] > max.value) max = { value: station[key], x: station.x };
      if (station[key] < min.value) min = { value: station[key], x: station.x };
    }
    extremes[key] = { max, min };
  }
  return { stripId: strip.id, stations, extremes };
};
