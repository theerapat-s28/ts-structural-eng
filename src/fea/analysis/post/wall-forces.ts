import { VERTICAL_MEMBER_TOLERANCE } from "@app-core/constants/fea.constant";
import { memberInternalForces } from "@app-fea/frame/post/member-diagram";
import type { FeaId } from "@app-fea/shared/types/model.type";
import { elementDofs } from "@app-fea/shared/solver/global-assembly";
import { roundToDecimalPlaces } from "@app-utils/math";

import type { AnalysisSystem } from "../solver/analysis-system";
import type { RawState } from "../solver/load-case-solver";
import type { WallPier, WallSpandrel } from "../types/model.type";
import type {
  PierForces,
  SpandrelForces,
  WallCutSection,
  WallForceComponent,
  WallResultants,
} from "../types/results.type";
import {
  cross,
  dot,
  fromNegativeSide,
  sub,
  wallAxes,
  wallCutPositions,
  wallExtent,
  wallTolerance,
  type Vec3,
  type WallAxes,
  type WallCutFace,
  type WallKind,
  type WallShape,
} from "./wall-geometry";

/** The resultants, in the order of the raw values. */
export const WALL_COMPONENTS: readonly WallForceComponent[] = ["P", "V2", "V3", "T", "M2", "M3"];

const FORCE_DECIMALS = 4;
const LENGTH_DECIMALS = 3;

/** A shell element on the cut's side: its corners on the cut and the sign of their forces. */
interface ShellTerm {
  shell: number; // index into the system shells
  corners: number[]; // corner indices on the cut
  sign: 1 | -1;
}

/** A member piece ending on the cut from the cut's side. */
interface EndTerm {
  piece: number; // index into the system member pieces
  end: 0 | 1; // 0 = start, 1 = end
  point: Vec3;
  sign: 1 | -1;
}

/** A member piece crossing the cut between its ends. */
interface CrossTerm {
  piece: number;
  x: number; // mm from the piece's start
  point: Vec3;
  /** +1 when the piece's start is on the negative side, so [0, x] is the negative part. */
  sign: 1 | -1;
}

/** One cut, ready to turn a raw state into its resultant. */
interface PreparedCut {
  position: number; // z of a pier cut, x from the left end of a spandrel cut (mm)
  face: WallCutFace;
  centroid: Vec3;
  section: WallCutSection; // presented
  shells: ShellTerm[];
  ends: EndTerm[];
  crossings: CrossTerm[];
}

/** A pier or spandrel with its cuts prepared: the resultants are linear in the raw state. */
export interface PreparedWall {
  id: FeaId;
  axes: WallAxes;
  length: number; // mm along axis 1 (spandrel)
  cuts: PreparedCut[];
}

const round = (value: number, decimals = FORCE_DECIMALS) =>
  roundToDecimalPlaces(value, decimals) + 0; // + 0: no −0
const roundPoint = (p: Vec3): Vec3 => [round(p[0], 3), round(p[1], 3), round(p[2], 3)];

const range = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values) });

/**
 * One cut: the shell elements and member pieces on its side that reach it, the members that
 * cross it, its section (a leg per area, a point per member) and the section's centroid.
 */
const prepareCut = (
  system: AnalysisSystem,
  shape: {
    areas: { areaId: FeaId; shells: number[] }[];
    members: { memberId: FeaId; pieces: number[] }[];
  },
  e1: Vec3,
  s: number,
  face: WallCutFace,
  tol: number,
): Omit<PreparedCut, "position"> => {
  const negative = fromNegativeSide(face);
  const sign: 1 | -1 = negative ? 1 : -1;
  const at = (n: number): Vec3 => {
    const node = system.nodes[n];
    return [node.x, node.y, node.z];
  };

  const shells: ShellTerm[] = [];
  const legs: WallCutSection["legs"] = [];
  for (const { areaId, shells: list } of shape.areas) {
    const onCut: Vec3[] = [];
    let normal: Vec3 | undefined;
    let thickness = 0;
    for (const index of list) {
      const shell = system.shells[index];
      const points = shell.nodeIndices.map(at);
      const r = range(points.map((p) => dot(p, e1)));
      if (r.max - r.min <= tol) continue;
      if (Math.abs((negative ? r.max : r.min) - s) > tol) continue;
      const corners = points.flatMap((p, i) => (Math.abs(dot(p, e1) - s) <= tol ? [i] : []));
      shells.push({ shell: index, corners, sign });
      onCut.push(...corners.map((i) => points[i]));
      normal ??= shell.element.axes.lambda[2] as Vec3;
      thickness = shell.section.thickness;
    }
    if (!normal) continue;
    const d = cross(e1, normal);
    const dn = Math.hypot(d[0], d[1], d[2]);
    if (dn === 0) continue;
    // legs run up (spandrel), else toward +X (+Y for a leg parallel to Y)
    let along: Vec3 = [d[0] / dn, d[1] / dn, d[2] / dn];
    const flip =
      Math.abs(along[2]) > VERTICAL_MEMBER_TOLERANCE
        ? along[2] < 0
        : Math.abs(along[0]) > VERTICAL_MEMBER_TOLERANCE
          ? along[0] < 0
          : along[1] < 0;
    if (flip) along = [-along[0], -along[1], -along[2]];
    let start = onCut[0];
    let end = onCut[0];
    for (const p of onCut) {
      if (dot(p, along) < dot(start, along)) start = p;
      if (dot(p, along) > dot(end, along)) end = p;
    }
    const length = dot(sub(end, start), along);
    if (length > tol) legs.push({ areaId, start, end, length, thickness });
  }

  const ends: EndTerm[] = [];
  const crossings: CrossTerm[] = [];
  const members: WallCutSection["members"] = [];
  for (const { memberId, pieces } of shape.members) {
    for (const piece of pieces) {
      const member = system.members[piece];
      const p0 = at(member.startIndex);
      const p1 = at(member.endIndex);
      const s0 = dot(p0, e1);
      const s1 = dot(p1, e1);
      if (Math.abs(s1 - s0) <= tol) continue; // lies in the cut plane
      const r = range([s0, s1]);
      if (r.min < s - tol && r.max > s + tol) {
        const t = (s - s0) / (s1 - s0);
        const point: Vec3 = [
          p0[0] + t * (p1[0] - p0[0]),
          p0[1] + t * (p1[1] - p0[1]),
          p0[2] + t * (p1[2] - p0[2]),
        ];
        crossings.push({ piece, x: t * member.length, point, sign: s1 > s0 ? 1 : -1 });
        members.push({ memberId, point, A: member.section.A });
        break;
      }
      if (Math.abs((negative ? r.max : r.min) - s) <= tol) {
        // the piece's end on the cut: the one with the larger s from below, the smaller from above
        const end: 0 | 1 = negative === s1 > s0 ? 1 : 0;
        const point = end === 1 ? p1 : p0;
        ends.push({ piece, end, point, sign });
        members.push({ memberId, point, A: member.section.A });
        break;
      }
    }
  }

  // centroid: legs by length × thickness at their midpoints, members by A
  let area = 0;
  const sum: Vec3 = [0, 0, 0];
  const addWeighted = (p: Vec3, w: number) => {
    area += w;
    for (let k = 0; k < 3; k++) sum[k] += w * p[k];
  };
  for (const leg of legs) {
    const mid: Vec3 = [0, 1, 2].map((k) => (leg.start[k] + leg.end[k]) / 2) as Vec3;
    addWeighted(mid, leg.length * leg.thickness);
  }
  for (const m of members) addWeighted(m.point, m.A);
  let centroid: Vec3;
  if (area > 0) {
    centroid = sum.map((v) => v / area) as Vec3;
  } else {
    // only corners touch the cut: the mean of the points on it
    const points = [
      ...shells.flatMap((t) => t.corners.map((i) => at(system.shells[t.shell].nodeIndices[i]))),
      ...ends.map((t) => t.point),
      ...crossings.map((t) => t.point),
    ];
    centroid = [0, 1, 2].map(
      (k) => points.reduce((acc, p) => acc + p[k], 0) / Math.max(points.length, 1),
    ) as Vec3;
  }

  return {
    face,
    centroid,
    section: {
      legs: legs.map((leg) => ({
        areaId: leg.areaId,
        start: roundPoint(leg.start),
        end: roundPoint(leg.end),
        length: round(leg.length, LENGTH_DECIMALS),
        thickness: leg.thickness,
      })),
      members: members.map((m) => ({ memberId: m.memberId, point: roundPoint(m.point), A: m.A })),
      length: round(
        legs.reduce((acc, leg) => acc + leg.length, 0),
        LENGTH_DECIMALS,
      ),
      area: round(area, LENGTH_DECIMALS),
      centroid: roundPoint(centroid),
    },
    shells,
    ends,
    crossings,
  };
};

/**
 * Prepares the piers and spandrels of a model that passed `validateModel`: their axes, cuts
 * (see `wallCutPositions`) and, for each cut, the shell elements and member pieces whose nodal
 * forces make up its resultant.
 *
 * @param walls - The model's piers and spandrels
 */
export const prepareWalls = (
  walls: { piers?: WallPier[]; spandrels?: WallSpandrel[] },
  system: AnalysisSystem,
): { piers: PreparedWall[]; spandrels: PreparedWall[] } => {
  const at = (n: number): Vec3 => {
    const node = system.nodes[n];
    return [node.x, node.y, node.z];
  };
  const prepare = (kind: WallKind, wall: WallPier | WallSpandrel): PreparedWall => {
    const areas = (wall.areaIds ?? []).map((areaId) => ({
      areaId,
      shells: system.shellsByArea.get(areaId) ?? [],
    }));
    const members = (wall.memberIds ?? []).map((memberId) => ({
      memberId,
      pieces: system.memberGroups[system.memberIndex.get(memberId) as number].pieces,
    }));
    const shape: WallShape = {
      areas: areas.map(({ areaId, shells }) => ({
        areaId,
        elements: shells.map((s) => system.shells[s].nodeIndices.map(at)),
      })),
      members: members.map(({ memberId, pieces }) => ({
        memberId,
        pieces: pieces.map((m): [Vec3, Vec3] => [
          at(system.members[m].startIndex),
          at(system.members[m].endIndex),
        ]),
      })),
    };
    const axes = wallAxes(kind, shape, {
      angle: (wall as WallPier).angle,
      reverse: (wall as WallSpandrel).reverse,
    });
    const e1 = axes[0];
    const extent = wallExtent(shape, e1);
    const tol = wallTolerance(extent);
    const offset = kind === "pier" ? 0 : extent.min;
    const extra = (wall.cuts ?? []).map((c) => c + offset);
    const cuts = wallCutPositions(kind, shape, e1, extra).map(({ s, face }) => ({
      position: s - offset,
      ...prepareCut(system, { areas, members }, e1, s, face, tol),
    }));
    return { id: wall.id, axes, length: extent.max - extent.min, cuts };
  };
  return {
    piers: (walls.piers ?? []).map((p) => prepare("pier", p)),
    spandrels: (walls.spandrels ?? []).map((s) => prepare("spandrel", s)),
  };
};

/**
 * The unrounded global force (N) and moment about the cut's centroid (N·mm) on the +1 face of
 * the negative part of one cut: the nodal forces `k·u − f` of the shell elements on the cut's
 * side at their corners on it, the end forces of the member pieces ending on it from that side
 * (both negated when the side is the positive one), and the internal forces of the members
 * crossing it. Linear in the state.
 */
const cutRawForces = (system: AnalysisSystem, state: RawState, cut: PreparedCut) => {
  const F: Vec3 = [0, 0, 0];
  const M: Vec3 = [0, 0, 0];
  const c = cut.centroid;
  const addAt = (p: Vec3, f: Vec3, m: Vec3, sign: number) => {
    const r = sub(p, c);
    const rf = cross(r, f);
    for (let k = 0; k < 3; k++) {
      F[k] += sign * f[k];
      M[k] += sign * (m[k] + rf[k]);
    }
  };

  for (const { shell: index, corners, sign } of cut.shells) {
    const shell = system.shells[index];
    const dofs = elementDofs(shell.nodeIndices);
    const u = dofs.map((d) => state.U[d]);
    const p = state.shellPressures[index];
    for (const i of corners) {
      const f = [0, 0, 0, 0, 0, 0];
      for (let r = 0; r < 6; r++) {
        const row = shell.element.kGlobal[6 * i + r];
        let v = 0;
        for (let j = 0; j < 24; j++) v += row[j] * u[j];
        f[r] = v;
      }
      for (let k = 0; k < 3; k++) f[k] -= p[k] * 1e-3 * shell.cornerAreas[i];
      const node = system.nodes[shell.nodeIndices[i]];
      addAt([node.x, node.y, node.z], [f[0], f[1], f[2]], [f[3], f[4], f[5]], sign);
    }
  }

  const toGlobal = (lambda: number[][], local: number[]): Vec3 => [
    lambda[0][0] * local[0] + lambda[1][0] * local[1] + lambda[2][0] * local[2],
    lambda[0][1] * local[0] + lambda[1][1] * local[1] + lambda[2][1] * local[2],
    lambda[0][2] * local[0] + lambda[1][2] * local[1] + lambda[2][2] * local[2],
  ];
  for (const { piece, end, point, sign } of cut.ends) {
    const { lambda } = system.members[piece];
    const f = state.memberForces[piece].slice(6 * end, 6 * end + 6);
    addAt(point, toGlobal(lambda, f.slice(0, 3)), toGlobal(lambda, f.slice(3, 6)), sign);
  }
  for (const { piece, x, point, sign } of cut.crossings) {
    const { lambda } = system.members[piece];
    const f = memberInternalForces(
      state.memberForces[piece].slice(0, 6),
      state.memberLoads[piece],
      x,
    );
    addAt(point, toGlobal(lambda, f.slice(0, 3)), toGlobal(lambda, f.slice(3, 6)), sign);
  }
  return { F, M };
};

/** The presented resultant of one cut in the wall's axes (kN, kN·m). */
const cutResultants = (
  system: AnalysisSystem,
  state: RawState,
  axes: WallAxes,
  cut: PreparedCut,
): WallResultants => {
  const { F, M } = cutRawForces(system, state, cut);
  return {
    P: round(dot(F, axes[0]) * 1e-3),
    V2: round(dot(F, axes[1]) * 1e-3),
    V3: round(dot(F, axes[2]) * 1e-3),
    T: round(dot(M, axes[0]) * 1e-6),
    M2: round(dot(M, axes[1]) * 1e-6),
    M3: round(dot(M, axes[2]) * 1e-6),
  };
};

const presentAxes = (axes: WallAxes): PierForces["axes"] =>
  axes.map((e) => e.map((v) => round(v, 9)) as Vec3) as PierForces["axes"];

/** The presented forces of one pier in a raw state. */
export const presentPierForces = (
  system: AnalysisSystem,
  state: RawState,
  pier: PreparedWall,
): PierForces => ({
  pierId: pier.id,
  axes: presentAxes(pier.axes),
  cuts: pier.cuts.map((cut) => ({
    z: round(cut.position, LENGTH_DECIMALS),
    face: cut.face as PierForces["cuts"][number]["face"],
    ...cutResultants(system, state, pier.axes, cut),
    section: cut.section,
  })),
});

/** The presented forces of one spandrel in a raw state. */
export const presentSpandrelForces = (
  system: AnalysisSystem,
  state: RawState,
  spandrel: PreparedWall,
): SpandrelForces => ({
  spandrelId: spandrel.id,
  axes: presentAxes(spandrel.axes),
  length: round(spandrel.length, LENGTH_DECIMALS),
  cuts: spandrel.cuts.map((cut) => ({
    x: round(cut.position, LENGTH_DECIMALS),
    face: cut.face as SpandrelForces["cuts"][number]["face"],
    ...cutResultants(system, state, spandrel.axes, cut),
    section: cut.section,
  })),
});
