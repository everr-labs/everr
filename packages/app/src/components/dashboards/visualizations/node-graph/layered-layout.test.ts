import { describe, expect, it } from "vite-plus/test";
import { arrowhead, fitToPanel, layoutGraph } from "./layered-layout";
import { edgeKey } from "./node-graph-data";

const NODE_WIDTH = 120;
const OPTIONS = { labels: false, nodeWidth: NODE_WIDTH };

const chain = [
  { source: "web", target: "api" },
  { source: "api", target: "db" },
];
const ids = ["web", "api", "db"];
// web → api → db, and worker → db: two entry points, and two calls into db.
const fanIn = {
  ids: [...ids, "worker"],
  edges: [...chain, { source: "worker", target: "db" }],
};

describe("layoutGraph", () => {
  it("puts callers before the services they call, entry points all in the first rank", () => {
    const { nodes } = layoutGraph(fanIn.ids, fanIn.edges, OPTIONS);
    const xs = ids.map((id) => nodes.get(id)?.x ?? 0);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(3);
    expect(nodes.get("worker")?.x).toBe(nodes.get("web")?.x);

    // Even when an entry point shares many targets with a later node.
    const targets = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const shared = layoutGraph(
      ["web", "api", "worker", ...targets],
      [
        { source: "web", target: "api" },
        ...targets.flatMap((t) => [
          { source: "api", target: t },
          { source: "worker", target: t },
        ]),
      ],
      OPTIONS,
    );
    expect(shared.nodes.get("worker")?.x).toBe(shared.nodes.get("web")?.x);
  });

  it("sizes the layout to everything it draws", () => {
    const graph = layoutGraph(fanIn.ids, fanIn.edges, OPTIONS);
    const xs = [...graph.nodes.values()].map((p) => p.x);
    expect(Math.min(...xs) - NODE_WIDTH / 2).toBe(0);
    expect(Math.max(...xs) + NODE_WIDTH / 2).toBe(graph.width);
  });

  it("runs edges from side to side, spreading the ends that meet at a node", () => {
    const { nodes, edges } = layoutGraph(fanIn.ids, fanIn.edges, OPTIONS);
    const api = nodes.get("api");
    const db = nodes.get("db");
    expect(edges.get(edgeKey("api", "db"))?.points[0]?.x).toBe((api?.x ?? 0) + NODE_WIDTH / 2);
    const ends = ["api", "worker"].map((s) => edges.get(edgeKey(s, "db"))?.points.at(-1));
    for (const end of ends) expect(end?.x).toBe((db?.x ?? 0) - NODE_WIDTH / 2);
    expect(ends[0]?.y).not.toBe(ends[1]?.y);
  });
});

describe("fitToPanel", () => {
  const graph = layoutGraph(ids, chain, OPTIONS);
  const fit = (width: number) => fitToPanel(graph, { width, height: graph.height });

  it("squeezes the gaps between ranks to fit, moving edges with their nodes", () => {
    const tight = fit(420);
    expect(tight.width).toBeLessThanOrEqual(420);
    const [web = 0, api = 0, db = 0] = ids.map((id) => tight.nodes.get(id)?.x ?? 0);
    expect(api - web).toBeGreaterThan(NODE_WIDTH);
    expect(db - api).toBeCloseTo(api - web);
    const points = tight.edges.get(edgeKey("api", "db"))?.points ?? [];
    expect(points[0]?.x).toBeCloseTo(api + NODE_WIDTH / 2);
    expect(points.at(-1)?.x).toBeCloseTo(db - NODE_WIDTH / 2);
  });
});

describe("arrowhead", () => {
  it("ends the line at the arrowhead's base, further back for a thicker line", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const thin = arrowhead(points, 1);
    const thick = arrowhead(points, 3);
    expect(thin.route.at(-1)?.x).toBeLessThan(100);
    expect(thick.route.at(-1)?.x).toBeLessThan(thin.route.at(-1)?.x ?? 0);
  });
});
