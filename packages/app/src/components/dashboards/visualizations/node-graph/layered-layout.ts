import { Graph, layout } from "@dagrejs/dagre";
import { edgeKey } from "./node-graph-data";

export interface Point {
  x: number;
  y: number;
}

type Direction = "LR" | "TB";

/** An edge's route, from the source's border to the target's, and where its
 * value label goes. */
export interface Route {
  points: Point[];
  label: Point;
}

export interface GraphLayout extends Pick<Options, "direction" | "nodeWidth"> {
  width: number;
  height: number;
  /** Node centers. */
  nodes: Map<string, Point>;
  /** Routes keyed by edgeKey. */
  edges: Map<string, Route>;
}

export const NODE_HEIGHT = 44;
const NODE_GAP = 20;
const EDGE_GAP = 10;
const RANK_GAP = 72;
/** How far fitToPanel may squeeze or stretch the gaps between ranks, and
 * stretch the gaps between nodes across them. */
const MIN_RANK_GAP = 28;
const MAX_RANK_STRETCH = 2;
const MAX_NODE_STRETCH = 2;
/** Edges leave and enter a node straight for this long, so arrowheads line up. */
const LEAD = 14;
/** Most room between two edge ends on the same side of a node. */
const PORT_SPACING = 8;
const LABEL_WIDTH = 48;
const LABEL_HEIGHT = 14;
const ROOT = "\u0000root";

interface Options {
  direction: Direction;
  /** Width of every node; they share one so ranks line up. */
  nodeWidth: number;
  /** Leave room for a value label on each edge. */
  labels: boolean;
}

interface Axes {
  rank: "x" | "y";
  cross: "x" | "y";
  rankSize: number;
  crossSize: number;
  /** The point at `along` on the rank axis and `across` on the cross axis. */
  at: (along: number, across: number) => Point;
}

/** The rank axis (along which callers come before callees) and the cross
 * axis, with a node's size along each. */
function axes(direction: Direction, nodeWidth: number): Axes {
  return direction === "LR"
    ? {
        rank: "x",
        cross: "y",
        rankSize: nodeWidth,
        crossSize: NODE_HEIGHT,
        at: (along, across) => ({ x: along, y: across }),
      }
    : {
        rank: "y",
        cross: "x",
        rankSize: NODE_HEIGHT,
        crossSize: nodeWidth,
        at: (along, across) => ({ x: across, y: along }),
      };
}

/**
 * Layered layout: callers in earlier ranks (columns for "LR", rows for "TB"),
 * the services they call in later ones, with edges routed around nodes. The
 * same graph always lays out the same way.
 */
export function layoutGraph(
  nodeIds: string[],
  edges: ReadonlyArray<{ source: string; target: string }>,
  { direction, nodeWidth, labels }: Options,
): GraphLayout {
  const { rank, cross, rankSize, crossSize, at } = axes(direction, nodeWidth);
  const g = new Graph();
  g.setGraph({ rankdir: direction, nodesep: NODE_GAP, ranksep: RANK_GAP, edgesep: EDGE_GAP });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of nodeIds) g.setNode(id, { width: nodeWidth, height: NODE_HEIGHT });
  for (const { source, target } of edges) {
    // A sized label makes room for the edge's value between the two ranks.
    g.setEdge(
      source,
      target,
      labels ? { width: LABEL_WIDTH, height: LABEL_HEIGHT, labelpos: "c" } : {},
    );
  }
  // A hidden root calling every node nothing calls pulls them all into the
  // first rank, so entry points line up on the left (or top).
  const called = new Set(edges.map((e) => e.target));
  g.setNode(ROOT, { width: 0, height: 0 });
  for (const id of nodeIds) if (!called.has(id)) g.setEdge(ROOT, id, { weight: 10 });
  layout(g);

  const nodes = new Map(
    nodeIds.map((id) => {
      const { x, y } = g.node(id);
      return [id, { x, y }];
    }),
  );
  const routes = new Map<string, Route>();
  for (const e of g.edges()) {
    if (e.v === ROOT) continue;
    const { points = [], x, y } = g.edge(e);
    const middle = points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
    routes.set(edgeKey(e.v, e.w), {
      points: points.slice(1, -1),
      label: { x: x ?? middle.x, y: y ?? middle.y },
    });
  }

  // Spread the ends of a node's edges along its side, in the order they
  // arrive from, instead of piling them onto one point.
  // One slot per node side, keyed by edgeKey(node, side).
  const ends = new Map<
    string,
    { node: Point; list: { key: string; at: number; end: "start" | "end"; side: number }[] }
  >();
  for (const { source, target } of edges) {
    const key = edgeKey(source, target);
    const route = routes.get(key);
    const s = nodes.get(source);
    const t = nodes.get(target);
    if (!route || !s || !t) continue;
    // A call back up the ranks leaves from the near side.
    const side = Math.sign(t[rank] - s[rank]) || 1;
    const towardTarget = route.points[0]?.[cross] ?? t[cross];
    const fromSource = route.points.at(-1)?.[cross] ?? s[cross];
    const add = (id: string, node: Point, end: "start" | "end", at: number, nodeSide: number) => {
      const slot = edgeKey(id, String(nodeSide));
      const entry = ends.get(slot) ?? { node, list: [] };
      entry.list.push({ key, at, end, side: nodeSide });
      ends.set(slot, entry);
    };
    add(source, s, "start", towardTarget, side);
    add(target, t, "end", fromSource, -side);
  }
  for (const { node, list } of ends.values()) {
    list.sort((a, b) => a.at - b.at);
    const step = Math.min(PORT_SPACING, (crossSize * 0.6) / Math.max(1, list.length - 1));
    list.forEach(({ key, end, side }, i) => {
      const route = routes.get(key);
      if (!route) return;
      const offset = (i - (list.length - 1) / 2) * step;
      const port = (distance: number) =>
        at(node[rank] + side * (rankSize / 2 + distance), node[cross] + offset);
      if (end === "start") route.points.unshift(port(0), port(LEAD));
      else route.points.push(port(LEAD), port(0));
    });
  }

  // Bounds of what's drawn, the hidden root left out.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (p: Point, w = 0, h = 0) => {
    minX = Math.min(minX, p.x - w / 2);
    maxX = Math.max(maxX, p.x + w / 2);
    minY = Math.min(minY, p.y - h / 2);
    maxY = Math.max(maxY, p.y + h / 2);
  };
  for (const p of nodes.values()) extend(p, nodeWidth, NODE_HEIGHT);
  for (const route of routes.values()) {
    for (const p of route.points) extend(p);
    if (labels) extend(route.label, LABEL_WIDTH, LABEL_HEIGHT);
  }
  return mapPoints(
    { direction, nodeWidth, width: maxX - minX, height: maxY - minY, nodes, edges: routes },
    (p) => ({ x: p.x - minX, y: p.y - minY }),
  );
}

/** The layout with every node, route point and label moved by `move`, and
 * its size moved as a point too. */
function mapPoints(graph: GraphLayout, move: (p: Point) => Point): GraphLayout {
  const size = move({ x: graph.width, y: graph.height });
  return {
    ...graph,
    width: Math.max(0, size.x),
    height: Math.max(0, size.y),
    nodes: new Map([...graph.nodes].map(([id, p]) => [id, move(p)])),
    edges: new Map(
      [...graph.edges].map(([key, r]) => [
        key,
        { points: r.points.map(move), label: move(r.label) },
      ]),
    ),
  };
}

/** The gaps between `spans` along one axis: their total, and a map that
 * scales them by a factor. */
function gapsBetween(spans: [number, number][]) {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const gaps = merged.slice(1).map(([start], i): [number, number] => [merged[i]?.[1] ?? 0, start]);
  const total = gaps.reduce((sum, [start, end]) => sum + end - start, 0);
  return {
    total,
    move: (factor: number) => (v: number) => {
      let shift = 0;
      for (const [start, end] of gaps) {
        if (v <= start) break;
        shift += (Math.min(v, end) - start) * (factor - 1);
      }
      return v + shift;
    },
  };
}

/**
 * Fits the layout to a `width` × `height` panel by squeezing or stretching
 * the gaps between ranks, and stretching the gaps between nodes across them,
 * within limits; the caller scales whatever still doesn't fit. Nodes keep
 * their size, so this moves points instead of laying the graph out again,
 * and a resize costs nothing.
 */
export function fitToPanel(
  graph: GraphLayout,
  room: { width: number; height: number },
): GraphLayout {
  const { rank, cross, rankSize, crossSize, at } = axes(graph.direction, graph.nodeWidth);
  const length = { x: graph.width, y: graph.height };
  const space = { x: room.width, y: room.height };
  const centers = [...graph.nodes.values()];
  const scaled = (axis: "x" | "y", size: number, min: number, max: number) => {
    const { total, move } = gapsBetween(
      centers.map((p): [number, number] => [p[axis] - size / 2, p[axis] + size / 2]),
    );
    const factor = total > 0 ? (space[axis] - (length[axis] - total)) / total : 1;
    return move(Math.min(max, Math.max(min, factor)));
  };
  const along = scaled(rank, rankSize, MIN_RANK_GAP / RANK_GAP, MAX_RANK_STRETCH);
  const across = scaled(cross, crossSize, 1, MAX_NODE_STRETCH);
  return mapPoints(graph, (p) => at(along(p[rank]), across(p[cross])));
}

/**
 * An arrowhead at the end of `points`, scaled to the line's `width`, and the
 * route cut back to the arrowhead's base, so a thick line doesn't poke
 * through its tip. Routes end on a straight lead longer than the arrowhead.
 */
export function arrowhead(points: Point[], width: number): { route: Point[]; head: string } {
  const tip = points.at(-1);
  const from = points.at(-2);
  if (!tip || !from) return { route: points, head: "" };
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / length;
  const uy = (tip.y - from.y) / length;
  const long = Math.min(length, 6 + width * 2);
  const half = 3 + width;
  const base = { x: tip.x - ux * long, y: tip.y - uy * long };
  return {
    route: [...points.slice(0, -1), base],
    head: `${tip.x},${tip.y} ${base.x - uy * half},${base.y + ux * half} ${base.x + uy * half},${base.y - ux * half}`,
  };
}

/** A smooth path through an edge's route (a uniform B-spline, as d3's curveBasis). */
export function routePath(points: Point[]): string {
  const [a, b] = points;
  const last = points.at(-1);
  if (!a || !b || !last) return "";
  if (points.length === 2) return `M${a.x},${a.y}L${b.x},${b.y}`;
  const bezier = (p0: Point, p1: Point, p2: Point) =>
    `C${(2 * p0.x + p1.x) / 3},${(2 * p0.y + p1.y) / 3} ${(p0.x + 2 * p1.x) / 3},${(p0.y + 2 * p1.y) / 3} ${(p0.x + 4 * p1.x + p2.x) / 6},${(p0.y + 4 * p1.y + p2.y) / 6}`;
  const parts = [`M${a.x},${a.y}`, `L${(5 * a.x + b.x) / 6},${(5 * a.y + b.y) / 6}`];
  // Repeating the last point makes the curve end on it.
  const padded = [...points, last];
  for (let i = 2; i < padded.length; i++) {
    const [p0, p1, p2] = padded.slice(i - 2, i + 1);
    if (p0 && p1 && p2) parts.push(bezier(p0, p1, p2));
  }
  parts.push(`L${last.x},${last.y}`);
  return parts.join("");
}
