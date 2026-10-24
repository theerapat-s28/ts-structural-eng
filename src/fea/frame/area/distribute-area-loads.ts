import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/frame.constant";
import type { Warnings } from "@app-core/types/output-message.type";

import type { FrameId, FrameModel, LoadDirection, Member, MemberLoad } from "../types/model.type";
import { throwIssues, validateFrameModel } from "../validation/validate-model";
import {
  areaPlane,
  clipPolygon,
  edgeVector,
  resolveAreaSupports,
  type AreaPlane,
  type Vec2,
  type Vec3,
} from "./area-geometry";
import { edgeMemberChain, memberAdjacency, type EdgeSegment } from "./edge-members";

/**
 * Line load along an edge per unit area load, as breakpoints in order of `s` (mm from the edge
 * start): `w` is the tributary width in mm, so `q · w · 10⁻³` is the line load in kN/m.
 */
type Profile = { s: number; w: number }[];

interface LoadedEdge {
  chain: EdgeSegment[];
  profile: Profile;
  /** Cantilever only: torque per unit area load (mm², c²/2) about the edge direction. */
  torque?: number;
}

const GLOBAL_AXES: ["X" | "Y" | "Z", number][] = [
  ["X", 0],
  ["Y", 1],
  ["Z", 2],
];

const dot2 = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

/** Linear interpolation of a profile at `s` (0 outside it). */
const valueAt = (profile: Profile, s: number): number => {
  for (let k = 1; k < profile.length; k++) {
    const a = profile[k - 1];
    const b = profile[k];
    if (s >= a.s && s <= b.s)
      return b.s > a.s ? a.w + ((b.w - a.w) * (s - a.s)) / (b.s - a.s) : b.w;
  }
  return 0;
};

/**
 * Width of a convex polygon, given in (s, d) coordinates, across the s axis: the extent in d
 * at each vertex position s. Between vertices the width is linear, so this is exact.
 */
const widthProfile = (polygon: Vec2[], tolerance: number): Profile => {
  const positions: number[] = [];
  for (const s of polygon.map((p) => p[0]).sort((a, b) => a - b)) {
    if (positions.length === 0 || s - positions[positions.length - 1] > tolerance)
      positions.push(s);
  }
  return positions.map((s) => {
    let min = Infinity;
    let max = -Infinity;
    polygon.forEach((p, i) => {
      const q = polygon[(i + 1) % polygon.length];
      const lo = Math.min(p[0], q[0]) - tolerance;
      const hi = Math.max(p[0], q[0]) + tolerance;
      if (s < lo || s > hi) return;
      const ds = q[0] - p[0];
      const values =
        Math.abs(ds) <= tolerance ? [p[1], q[1]] : [p[1] + ((s - p[0]) / ds) * (q[1] - p[1])];
      for (const d of values) {
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
    });
    return { s, w: max - min };
  });
};

/** Unit inward normal of edge i of a counter-clockwise polygon (the area is on its left). */
const inwardNormal = (corners: Vec2[], i: number): Vec2 => {
  const e = edgeVector(corners, i);
  const L = Math.hypot(...e);
  return [-e[1] / L, e[0] / L];
};

/** A profile pinned to the edge ends: clamped to [0, L], with breakpoints at 0 and L. */
const pinToEdge = (profile: Profile, L: number): Profile => {
  const inside = profile.filter((p) => p.s > 0 && p.s < L);
  return [{ s: 0, w: valueAt(profile, 0) }, ...inside, { s: L, w: valueAt(profile, L) }];
};

/**
 * Two-way: every point of the area goes to the nearest edge line, so edge i takes the area
 * clipped by `dᵢ(p) ≤ dⱼ(p)` for every other edge j (the corner-bisector, or straight-skeleton,
 * split of a convex polygon), carried straight across onto the edge.
 */
const twoWayProfile = (plane: AreaPlane, i: number, tolerance: number): Profile => {
  const { corners } = plane;
  const ni = inwardNormal(corners, i);
  let region = corners;
  corners.forEach((cj, j) => {
    if (j === i) return;
    const nj = inwardNormal(corners, j);
    // dᵢ(p) ≤ dⱼ(p)  ⇔  (nᵢ − nⱼ)·p ≤ nᵢ·cᵢ − nⱼ·cⱼ
    region = clipPolygon(
      region,
      [ni[0] - nj[0], ni[1] - nj[1]],
      dot2(ni, corners[i]) - dot2(nj, cj),
    );
  });
  const e = edgeVector(corners, i);
  const L = Math.hypot(...e);
  const t: Vec2 = [e[0] / L, e[1] / L];
  const local = region.map((p): Vec2 => {
    const r: Vec2 = [p[0] - corners[i][0], p[1] - corners[i][1]];
    return [dot2(r, t), dot2(r, ni)];
  });
  return pinToEdge(widthProfile(local, tolerance), L);
};

/**
 * One-way: strips parallel to `span` run across the area and half of each strip goes to each
 * edge it ends on. A strip of width db meets edge i (at angle θ to the span) over ds = db/sin θ,
 * so the edge takes `chord(b) / 2 · sin θ` per unit length; edges parallel to the span take none.
 */
const oneWayProfile = (
  plane: AreaPlane,
  i: number,
  span: Vec2,
  tolerance: number,
): Profile | null => {
  const { corners } = plane;
  const across: Vec2 = [-span[1], span[0]];
  const chord = widthProfile(
    corners.map((p): Vec2 => [dot2(p, across), dot2(p, span)]),
    tolerance,
  );
  const e = edgeVector(corners, i);
  const L = Math.hypot(...e);
  const sin = Math.abs(e[0] * span[1] - e[1] * span[0]) / L;
  if (sin <= AREA_GEOMETRY_TOLERANCE) return null;
  const b0 = dot2(corners[i], across);
  const b1 = b0 + dot2(e, across);
  const at = (b: number) => (valueAt(chord, b) / 2) * sin;
  const inside = chord
    .filter((p) => (p.s - b0) * (p.s - b1) < 0)
    .map((p) => ({ s: ((p.s - b0) / (b1 - b0)) * L, w: at(p.s) }));
  const profile = [{ s: 0, w: at(b0) }, ...inside, { s: L, w: at(b1) }];
  return profile.sort((a, b) => a.s - b.s);
};

/**
 * Cuts an edge profile at the members along the edge and maps each piece onto its member, as
 * positions from the member start. Pieces that carry nothing are dropped.
 */
const segmentPieces = (
  profile: Profile,
  segment: EdgeSegment,
  memberLength: number,
  tolerance: number,
): { start: number; end: number; w1: number; w2: number }[] => {
  const { from, to, reversed } = segment;
  const cuts = [
    from,
    ...profile.map((p) => p.s).filter((s) => s > from + tolerance && s < to - tolerance),
    to,
  ];
  const x = (s: number) => {
    const along = ((s - from) / (to - from)) * memberLength;
    return Math.min(memberLength, Math.max(0, reversed ? memberLength - along : along));
  };
  const peak = Math.max(...profile.map((p) => Math.abs(p.w)));
  const pieces = [];
  for (let k = 1; k < cuts.length; k++) {
    const wa = valueAt(profile, cuts[k - 1]);
    const wb = valueAt(profile, cuts[k]);
    if (Math.max(Math.abs(wa), Math.abs(wb)) <= AREA_GEOMETRY_TOLERANCE * peak) continue;
    const [xa, xb] = [x(cuts[k - 1]), x(cuts[k])];
    pieces.push(
      xa < xb ? { start: xa, end: xb, w1: wa, w2: wb } : { start: xb, end: xa, w1: wb, w2: wa },
    );
  }
  return pieces;
};

/**
 * Turns the area loads of a model into member loads, assuming the model is valid (as
 * `validateFrameModel` checks): each area's edge profiles are built once, then scaled for each
 * of its loads and split into global X, Y and Z trapezoidal loads (plus torques for a cantilever).
 * Everything is linear in `q`, so load-case superposition still holds.
 */
export const areaMemberLoads = (
  model: FrameModel,
): { memberLoads: MemberLoad[]; warnings: Warnings } => {
  const areas = model.areas ?? [];
  const areaLoads = model.areaLoads ?? [];
  const memberLoads: MemberLoad[] = [];
  const warnings: Warnings = [];
  if (areas.length === 0 || areaLoads.length === 0) return { memberLoads, warnings };

  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const position = (id: FrameId): Vec3 => {
    const node = nodeById.get(id)!;
    return [node.x, node.y, node.z];
  };
  const lengthOf = (member: Member) => {
    const [a, b] = [position(member.startNodeId), position(member.endNodeId)];
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  };

  const loadedAreas = new Set(areaLoads.map((l) => l.areaId));
  const adjacency = memberAdjacency(model.members);
  const prepared = new Map<FrameId, { plane: AreaPlane; edges: LoadedEdge[] }>();
  for (const area of areas) {
    if (!loadedAreas.has(area.id)) continue;
    const ids = area.nodeIds;
    const plane = areaPlane(ids.map(position)) as AreaPlane;
    const supports = resolveAreaSupports(plane, area.distribution, area.supportEdges)!;
    const tolerance = AREA_GEOMETRY_TOLERANCE * plane.size;
    const n = ids.length;

    const edges: LoadedEdge[] = [];
    for (const i of supports.loadedEdges) {
      const chain = edgeMemberChain(ids[i], ids[(i + 1) % n], position, adjacency)!;
      const L = Math.hypot(...edgeVector(plane.corners, i));

      if (area.distribution === "cantilever") {
        const depth = Math.hypot(...edgeVector(plane.corners, (i + 1) % n));
        edges.push({
          chain,
          profile: [
            { s: 0, w: depth },
            { s: L, w: depth },
          ],
          torque: depth ** 2 / 2,
        });
      } else if (area.distribution === "twoWay") {
        edges.push({ chain, profile: twoWayProfile(plane, i, tolerance) });
      } else {
        const profile = oneWayProfile(plane, i, supports.span!, tolerance);
        if (profile) edges.push({ chain, profile });
        else {
          warnings.push({
            reference: "Null area, one-way distribution",
            message: `Area "${String(area.id)}": support edge ${i} runs parallel to the span and receives no load.`,
          });
        }
      }
    }
    prepared.set(area.id, { plane, edges });
  }

  for (const load of areaLoads) {
    const area = prepared.get(load.areaId);
    if (!area || load.q === 0) continue;
    const { plane, edges } = area;
    const e: Vec3 =
      load.direction === "3"
        ? plane.normal
        : (GLOBAL_AXES.map(([axis]) => (axis === load.direction ? 1 : 0)) as Vec3);
    const components = GLOBAL_AXES.filter(([, k]) => Math.abs(e[k]) > AREA_GEOMETRY_TOLERANCE);
    // Lever arm (inward, in plane) × load: only the normal part of the load twists the edge,
    // about +edge direction; validation rejects a load along a cantilever's support edge.
    const normalPart = e[0] * plane.normal[0] + e[1] * plane.normal[1] + e[2] * plane.normal[2];
    // per projected area → per true area: Aproj / A = |n · e|
    const q = load.projected ? load.q * Math.abs(normalPart) : load.q;
    if (q === 0) continue;
    const tolerance = AREA_GEOMETRY_TOLERANCE * plane.size;

    for (const { chain, profile, torque } of edges) {
      for (const segment of chain) {
        const { member } = segment;
        const L = lengthOf(member);
        for (const piece of segmentPieces(profile, segment, L, tolerance)) {
          for (const [axis, k] of components) {
            memberLoads.push({
              loadCase: load.loadCase,
              type: "trapezoidal",
              memberId: member.id,
              direction: axis as LoadDirection,
              w1: q * e[k] * piece.w1 * 1e-3, // kN/m² · mm → kN/m
              w2: q * e[k] * piece.w2 * 1e-3,
              start: piece.start,
              end: piece.end,
            });
          }
        }
        if (torque !== undefined && Math.abs(normalPart) > AREA_GEOMETRY_TOLERANCE) {
          // member local 1 is ±edge direction
          const sign = segment.reversed ? -1 : 1;
          memberLoads.push({
            loadCase: load.loadCase,
            type: "torque",
            memberId: member.id,
            t: q * normalPart * torque * sign * 1e-6, // kN/m² · mm² → kN·m/m
          });
        }
      }
    }
  }

  return { memberLoads, warnings };
};

/**
 * The member loads that a model's null areas send to the members along their edges — what
 * `analyzeFrame` adds to `memberLoads` — so they can be checked or previewed.
 *
 * Two-way areas send each point to the nearest edge (corner-bisector split); one-way areas
 * split strips parallel to their unsupported edges half to each end; cantilever areas send
 * `q · c` and a torque `q · c² / 2` per unit length to their support edge (c = depth). Edges
 * split by intermediate nodes are cut at those nodes. Loads are per unit true area (a
 * `projected` load is first converted, `q · |n · direction|`) and come out as trapezoidal loads
 * per member length in global X, Y and Z (and torques), each tagged with its load case.
 *
 * @param model - The frame model, validated first
 * @returns `memberLoads` and `warnings` (a one-way support edge parallel to the span)
 * @throws {FrameAnalysisError} 301–317 for an invalid model, with every problem in `issues`
 */
export const distributeAreaLoads = (
  model: FrameModel,
): { memberLoads: MemberLoad[]; warnings: Warnings } => {
  const issues = validateFrameModel(model);
  if (issues.length > 0) throwIssues(issues);
  return areaMemberLoads(model);
};
