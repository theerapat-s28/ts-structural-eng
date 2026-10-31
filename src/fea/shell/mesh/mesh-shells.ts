import { AREA_GEOMETRY_TOLERANCE } from "@app-core/constants/frame.constant";
import type { FrameId, FrameNode } from "@app-fea/shared/types/model.type";

import { isValidShellQuad, type Vec3 } from "../elements/shell-axes";
import type { ShellArea } from "../types/model.type";

/** A shell element of the analysed model: a shell area, or one element of its mesh. */
export interface ShellElement extends ShellArea {
  /** The shell area it belongs to (its own id when the area is one element). */
  areaId: FrameId;
}

/** The result of meshing a model's shell areas. */
export interface ShellMeshResult {
  /** Generated nodes, in global coordinates (mm). */
  nodes: FrameNode[];
  /** Every shell element, area by area in model order. */
  elements: ShellElement[];
  /** Areas that could not be meshed (no conforming division counts, a bad generated element, or a generated id already in use). */
  problems: FrameId[];
}

/** A straight piece of an area edge between two model nodes (corners or nodes lying on it). */
interface Segment {
  a: FrameId; // canonical first end
  b: FrameId;
  length: number; // mm
  count: number; // divisions
  chain?: FrameId[]; // node ids from a to b, once generated
}

interface PlannedArea {
  shell: ShellArea;
  /** Per edge i (corner i → i + 1), its segments in edge order and whether each runs a → b. */
  edges: { segment: Segment; forward: boolean }[][];
  minimum: [number, number];
}

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const lerp = (p: Vec3, q: Vec3, t: number): Vec3 => [
  p[0] + (q[0] - p[0]) * t,
  p[1] + (q[1] - p[1]) * t,
  p[2] + (q[2] - p[2]) * t,
];
/** A string that tells `1` and `"1"` apart, for ordering and map keys. */
const idKey = (id: FrameId) => `${typeof id}:${String(id)}`;

/** Parameter t ∈ (0, 1) of `x` on the segment p → q when it lies strictly inside it, else null. */
export const pointOnSegment = (x: Vec3, p: Vec3, q: Vec3, inclusive = false): number | null => {
  const d = sub(q, p);
  const L2 = dot(d, d);
  if (!(L2 > 0)) return null;
  const L = Math.sqrt(L2);
  const tolerance = AREA_GEOMETRY_TOLERANCE * L;
  const t = dot(sub(x, p), d) / L2;
  const margin = inclusive ? -tolerance / L : tolerance / L;
  if (t < margin || t > 1 - margin) return null;
  const off = sub(x, lerp(p, q, t));
  return Math.hypot(off[0], off[1], off[2]) <= tolerance ? t : null;
};

/**
 * Meshes the shell areas of a model whose shells and nodes are valid.
 *
 * - Each area edge is cut into segments at the model nodes lying on it (hard points), so an
 *   edge shared whole by two areas, or partly where areas meet at a node (a T-junction), shares
 *   its segments.
 * - Every segment gets a division count: at least 1, at least `length / maxSize` for an area
 *   with `mesh.maxSize`, and raised until in every area opposite edges add up to the same
 *   count (and at least `mesh.divisions`), adding each division where the elements are longest.
 * - Segment nodes are evenly spaced; interior nodes come from transfinite interpolation of the
 *   four edges, so a planar area stays planar.
 *
 * An area that ends with 1 × 1 divisions is its own element, with its own id. Generated ids:
 * `"<a>~<b>:<k>"` for the k-th node from model node a to b on a segment, `"<areaId>:<i>,<j>"`
 * for interior nodes and for elements.
 *
 * @param nodes - Model nodes
 * @param shells - Shell areas, each with 4 valid corner nodes
 */
export const meshShells = (nodes: FrameNode[], shells: ShellArea[]): ShellMeshResult => {
  const position = new Map<FrameId, Vec3>(nodes.map((n) => [n.id, [n.x, n.y, n.z]]));
  const segments = new Map<string, Segment>();
  const segmentOf = (p: FrameId, q: FrameId): { segment: Segment; forward: boolean } => {
    const forward = idKey(p) < idKey(q);
    const [a, b] = forward ? [p, q] : [q, p];
    const key = `${idKey(a)}|${idKey(b)}`;
    let segment = segments.get(key);
    if (!segment) {
      const d = sub(position.get(b)!, position.get(a)!);
      segment = { a, b, length: Math.hypot(d[0], d[1], d[2]), count: 1 };
      segments.set(key, segment);
    }
    return { segment, forward };
  };

  // ---- Edges cut at the model nodes lying on them -------------------------------------
  const plans: PlannedArea[] = shells.map((shell) => {
    const corners = shell.nodeIds;
    const edges = [0, 1, 2, 3].map((i) => {
      const [p, q] = [corners[i], corners[(i + 1) % 4]];
      const [P, Q] = [position.get(p)!, position.get(q)!];
      const inside: { id: FrameId; t: number }[] = [];
      for (const node of nodes) {
        if (corners.includes(node.id)) continue;
        const t = pointOnSegment([node.x, node.y, node.z], P, Q);
        if (t !== null) inside.push({ id: node.id, t });
      }
      const chain = [p, ...inside.sort((x, y) => x.t - y.t).map((h) => h.id), q];
      return chain.slice(1).map((id, k) => segmentOf(chain[k], id));
    });
    const d = shell.mesh?.divisions;
    return { shell, edges, minimum: d ? [d[0], d[1]] : [1, 1] };
  });

  // ---- Division counts ---------------------------------------------------------------
  for (const { shell, edges } of plans) {
    const maxSize = shell.mesh?.maxSize;
    if (maxSize === undefined) continue;
    for (const { segment } of edges.flat()) {
      segment.count = Math.max(segment.count, Math.ceil(segment.length / maxSize - 1e-9));
    }
  }
  const total = (edge: PlannedArea["edges"][number]) =>
    edge.reduce((sum, { segment }) => sum + segment.count, 0);
  const growTo = (edge: PlannedArea["edges"][number], target: number) => {
    while (total(edge) < target) {
      // one more division where the elements are longest
      const longest = edge.reduce((best, s) =>
        s.segment.length / s.segment.count > best.segment.length / best.segment.count ? s : best,
      );
      longest.segment.count++;
    }
  };
  const balanced = () =>
    plans.every(
      ({ edges, minimum }) =>
        total(edges[0]) === total(edges[2]) &&
        total(edges[1]) === total(edges[3]) &&
        total(edges[0]) >= minimum[0] &&
        total(edges[1]) >= minimum[1],
    );
  const maxPasses = 10 + 4 * plans.length;
  for (let pass = 0; pass < maxPasses && !balanced(); pass++) {
    for (const { edges, minimum } of plans) {
      for (const [p, q, least] of [
        [0, 2, minimum[0]],
        [1, 3, minimum[1]],
      ]) {
        const target = Math.max(total(edges[p]), total(edges[q]), least);
        growTo(edges[p], target);
        growTo(edges[q], target);
      }
    }
  }
  if (!balanced()) {
    return {
      nodes: [],
      elements: [],
      problems: plans
        .filter(
          ({ edges }) => total(edges[0]) !== total(edges[2]) || total(edges[1]) !== total(edges[3]),
        )
        .map((p) => p.shell.id),
    };
  }

  // ---- Nodes along segments ---------------------------------------------------------
  const generated: FrameNode[] = [];
  const generate = (id: FrameId, at: Vec3) => {
    generated.push({ id, x: at[0], y: at[1], z: at[2] });
    position.set(id, at);
  };
  for (const segment of segments.values()) {
    const [A, B] = [position.get(segment.a)!, position.get(segment.b)!];
    segment.chain = [segment.a];
    for (let k = 1; k < segment.count; k++) {
      const id = `${String(segment.a)}~${String(segment.b)}:${k}`;
      generate(id, lerp(A, B, k / segment.count));
      segment.chain.push(id);
    }
    segment.chain.push(segment.b);
  }

  // ---- Areas ------------------------------------------------------------------------
  const elements: ShellElement[] = [];
  const problems: FrameId[] = [];
  for (const { shell, edges } of plans) {
    // node ids along each edge, corner i → corner i + 1
    const along = edges.map((edge) =>
      edge.flatMap(({ segment, forward }, k) => {
        const chain = forward ? segment.chain! : [...segment.chain!].reverse();
        return k === 0 ? chain : chain.slice(1);
      }),
    );
    const n1 = along[0].length - 1;
    const n2 = along[1].length - 1;
    const { mesh: _mesh, ...properties } = shell;
    if (n1 === 1 && n2 === 1) {
      elements.push({ ...properties, areaId: shell.id });
      continue;
    }

    const bottom = along[0];
    const right = along[1];
    const top = [...along[2]].reverse();
    const left = [...along[3]].reverse();
    const fractions = (ids: FrameId[]) => {
      const out = [0];
      for (let k = 1; k < ids.length; k++) {
        const d = sub(position.get(ids[k])!, position.get(ids[k - 1])!);
        out.push(out[k - 1] + Math.hypot(d[0], d[1], d[2]));
      }
      return out.map((v) => v / out[out.length - 1]);
    };
    const [uB, uT, vL, vR] = [bottom, top, left, right].map(fractions);
    const C = shell.nodeIds.map((id) => position.get(id)!);
    const grid: FrameId[][] = [];
    for (let i = 0; i <= n1; i++) {
      grid.push([]);
      for (let j = 0; j <= n2; j++) {
        if (j === 0) grid[i].push(bottom[i]);
        else if (j === n2) grid[i].push(top[i]);
        else if (i === 0) grid[i].push(left[j]);
        else if (i === n1) grid[i].push(right[j]);
        else {
          // transfinite (Coons) interpolation of the four edges
          const v0 = (vL[j] + vR[j]) / 2;
          const u0 = (uB[i] + uT[i]) / 2;
          const u = (1 - v0) * uB[i] + v0 * uT[i];
          const v = (1 - u0) * vL[j] + u0 * vR[j];
          const [B, T, L, R] = [bottom[i], top[i], left[j], right[j]].map(
            (id) => position.get(id)!,
          );
          const at = [0, 1, 2].map(
            (k) =>
              (1 - v) * B[k] +
              v * T[k] +
              (1 - u) * L[k] +
              u * R[k] -
              ((1 - u) * (1 - v) * C[0][k] +
                u * (1 - v) * C[1][k] +
                u * v * C[2][k] +
                (1 - u) * v * C[3][k]),
          ) as Vec3;
          const id = `${String(shell.id)}:${i},${j}`;
          generate(id, at);
          grid[i].push(id);
        }
      }
    }
    let ok = true;
    for (let j = 0; j < n2; j++) {
      for (let i = 0; i < n1; i++) {
        const nodeIds = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
        if (!isValidShellQuad(nodeIds.map((id) => position.get(id)!))) ok = false;
        elements.push({
          ...properties,
          id: `${String(shell.id)}:${i},${j}`,
          nodeIds,
          areaId: shell.id,
        });
      }
    }
    if (!ok) problems.push(shell.id);
  }

  // ---- Generated ids must be new ----------------------------------------------------
  const taken = new Set(nodes.map((n) => idKey(n.id)));
  for (const node of generated) {
    if (taken.has(idKey(node.id))) {
      const owner = elements.find((e) => e.nodeIds.includes(node.id));
      if (owner && !problems.includes(owner.areaId)) problems.push(owner.areaId);
    }
    taken.add(idKey(node.id));
  }
  const shellIds = new Set<string>();
  for (const element of elements) {
    const key = idKey(element.id);
    if (shellIds.has(key) && !problems.includes(element.areaId)) problems.push(element.areaId);
    shellIds.add(key);
  }

  return { nodes: generated, elements, problems };
};
