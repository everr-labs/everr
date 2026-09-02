import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { Share2 } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { SERIES_COLORS } from "../data-utils";
import type { VisualizationProps } from "../index";
import { formatStatValue } from "../stat-chart/stat-calculations";
import { layoutGraph } from "./force-layout";
import {
  buildNodeGraph,
  type GraphEdge,
  type GraphNode,
} from "./node-graph-data";
import type { NodeGraphSpec } from "./spec";

const MIN_RADIUS = 10;
const MAX_RADIUS = 26;
const MIN_EDGE_WIDTH = 1.25;
const MAX_EDGE_WIDTH = 4;
const ARROW_LENGTH = 9;
const MAX_LABEL_CHARS = 16;

const NODE_COLOR = SERIES_COLORS[0]!;

function formatValue(value: number, unit: string): string {
  return `${formatStatValue(value, undefined)}${unit ? ` ${unit}` : ""}`;
}

/** Value → [min, max] with area (not radius/width) tracking the value. */
function sqrtScale(
  value: number,
  domain: [number, number],
  range: [number, number],
): number {
  if (domain[1] <= domain[0]) return (range[0] + range[1]) / 2;
  const t = Math.sqrt((value - domain[0]) / (domain[1] - domain[0]));
  return range[0] + t * (range[1] - range[0]);
}

function truncateLabel(id: string): string {
  return id.length > MAX_LABEL_CHARS
    ? `${id.slice(0, MAX_LABEL_CHARS - 1)}…`
    : id;
}

type Hover =
  | { kind: "node"; node: GraphNode; x: number; y: number }
  | { kind: "edge"; edge: GraphEdge; x: number; y: number };

/**
 * The graph renders in PIXEL space, not a scaled viewBox: a fixed viewBox
 * squeezed into a small panel shrinks labels below readability, so instead
 * the container is measured and the layout runs at its real size — text
 * stays at its set px size no matter the panel dimensions.
 */
function useContainerSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <Share2 className="size-8" />
      <p className="text-sm">No edges to graph in this result</p>
    </div>
  );
}

export function NodeGraphVisualization({
  spec,
  data,
}: VisualizationProps<NodeGraphSpec>) {
  const model = useMemo(
    () => (data ? buildNodeGraph(data, spec) : null),
    [data, spec],
  );
  const { ref: containerRef, size } = useContainerSize();
  // Layout inset — room for node circles and their labels, scaled down so
  // small panels don't lose most of their area to padding.
  const padding = size
    ? Math.min(70, Math.max(30, Math.min(size.width, size.height) * 0.12))
    : 0;
  const positions = useMemo(
    () =>
      model && size
        ? layoutGraph(
            model.nodes.map((n) => n.id),
            model.edges,
            size.width,
            size.height,
            padding,
          )
        : null,
    [model, size, padding],
  );
  const [hover, setHover] = useState<Hover | null>(null);

  if (!model || model.nodes.length === 0) return <EmptyState />;
  const { nodes, edges, droppedRows, hiddenNodes } = model;

  // Node sizes shrink a bit with the panel so circles don't crowd small
  // panels — labels keep their px size regardless.
  const sizeScale = size
    ? Math.min(1, Math.max(0.55, Math.min(size.width, size.height) / 540))
    : 1;
  const nodeDomain: [number, number] = [
    Math.min(...nodes.map((n) => n.value)),
    Math.max(...nodes.map((n) => n.value)),
  ];
  const edgeDomain: [number, number] = [
    Math.min(...edges.map((e) => e.value), Infinity),
    Math.max(...edges.map((e) => e.value), -Infinity),
  ];
  const radius = (n: GraphNode) =>
    sqrtScale(n.value, nodeDomain, [
      MIN_RADIUS * sizeScale,
      MAX_RADIUS * sizeScale,
    ]);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // Edges sharing endpoints in both directions bow apart so neither hides
  // the other.
  const reversed = new Set(edges.map((e) => `${e.target}${e.source}`));

  const hoveredNode = hover?.kind === "node" ? hover.node.id : null;
  const isEdgeActive = (e: GraphEdge) =>
    hoveredNode === null ||
    e.source === hoveredNode ||
    e.target === hoveredNode;
  const isNodeActive = (n: GraphNode) =>
    hoveredNode === null ||
    n.id === hoveredNode ||
    edges.some(
      (e) =>
        (e.source === hoveredNode && e.target === n.id) ||
        (e.target === hoveredNode && e.source === n.id),
    );

  const notShown = [
    droppedRows > 0 && `${droppedRows} row${droppedRows === 1 ? "" : "s"}`,
    hiddenNodes > 0 && `${hiddenNodes} node${hiddenNodes === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full flex-col border-t border-border">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: chart hover tracking */}
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        onMouseMove={(e) =>
          setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
        }
        onMouseLeave={() => setHover(null)}
      >
        {size && positions && (
          <svg
            width={size.width}
            height={size.height}
            className="block"
            role="img"
            aria-label="Node graph"
          >
            {edges.map((edge) => {
              const s = positions.get(edge.source);
              const t = positions.get(edge.target);
              if (!s || !t) return null;
              const dx = t.x - s.x;
              const dy = t.y - s.y;
              const dist = Math.hypot(dx, dy) || 1;
              const ux = dx / dist;
              const uy = dy / dist;
              // Perpendicular offset when the reverse edge also exists.
              const twin = reversed.has(`${edge.source}${edge.target}`);
              const ox = twin ? -uy * 5 : 0;
              const oy = twin ? ux * 5 : 0;
              const sourceNode = nodeById.get(edge.source)!;
              const targetNode = nodeById.get(edge.target)!;
              const x1 = s.x + ux * (radius(sourceNode) + 2) + ox;
              const y1 = s.y + uy * (radius(sourceNode) + 2) + oy;
              const tipX = t.x - ux * (radius(targetNode) + 3) + ox;
              const tipY = t.y - uy * (radius(targetNode) + 3) + oy;
              const x2 = spec.directed ? tipX - ux * ARROW_LENGTH : tipX;
              const y2 = spec.directed ? tipY - uy * ARROW_LENGTH : tipY;
              const width = edge.hasValue
                ? sqrtScale(edge.value, edgeDomain, [
                    MIN_EDGE_WIDTH,
                    MAX_EDGE_WIDTH,
                  ])
                : 1.5;
              const active = isEdgeActive(edge);
              const key = `${edge.source}->${edge.target}`;
              return (
                <g key={key} opacity={active ? 1 : 0.15}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="var(--muted-foreground)"
                    strokeOpacity={0.45}
                    strokeWidth={width}
                    pointerEvents="none"
                  />
                  {spec.directed && (
                    <polygon
                      points={`${tipX},${tipY} ${
                        tipX - ux * ARROW_LENGTH - uy * (ARROW_LENGTH / 2.4)
                      },${tipY - uy * ARROW_LENGTH + ux * (ARROW_LENGTH / 2.4)} ${
                        tipX - ux * ARROW_LENGTH + uy * (ARROW_LENGTH / 2.4)
                      },${tipY - uy * ARROW_LENGTH - ux * (ARROW_LENGTH / 2.4)}`}
                      fill="var(--muted-foreground)"
                      fillOpacity={0.55}
                      pointerEvents="none"
                    />
                  )}
                  {spec.showValues && (
                    <text
                      x={(x1 + tipX) / 2 - uy * 7}
                      y={(y1 + tipY) / 2 + ux * 7}
                      fill="var(--muted-foreground)"
                      fontSize={10}
                      textAnchor="middle"
                      pointerEvents="none"
                    >
                      {formatValue(edge.value, spec.unit)}
                    </text>
                  )}
                  {/* invisible wide hit area for the tooltip */}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: edge hover tooltip */}
                  <line
                    x1={x1}
                    y1={y1}
                    x2={tipX}
                    y2={tipY}
                    stroke="transparent"
                    strokeWidth={Math.max(10, width)}
                    onMouseEnter={(e) =>
                      setHover({
                        kind: "edge",
                        edge,
                        x: e.clientX,
                        y: e.clientY,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              );
            })}

            {nodes.map((node) => {
              const p = positions.get(node.id);
              if (!p) return null;
              const r = radius(node);
              const active = isNodeActive(node);
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: node hover tooltip
                <g
                  key={node.id}
                  opacity={active ? 1 : 0.3}
                  onMouseEnter={(e) =>
                    setHover({ kind: "node", node, x: e.clientX, y: e.clientY })
                  }
                  onMouseLeave={() => setHover(null)}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    fill={NODE_COLOR}
                    fillOpacity={0.85}
                    stroke="var(--card)"
                    strokeWidth={1.5}
                  />
                  <text
                    x={p.x}
                    y={p.y + r + 14}
                    fill="var(--foreground)"
                    fontSize={11}
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    {truncateLabel(node.id)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        {/* rows the result contained but the graph could not place */}
        {notShown && (
          <div className="pointer-events-none absolute top-2 right-2 rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
            {notShown} not shown
          </div>
        )}

        {hover && (
          <CursorTooltip x={hover.x} y={hover.y}>
            {hover.kind === "node" ? (
              <>
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: NODE_COLOR }}
                  />
                  <span className="text-muted-foreground">{hover.node.id}</span>
                  <span className="text-right font-medium tabular-nums">
                    {formatValue(hover.node.value, spec.unit)}
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {hover.node.inEdges} in · {hover.node.outEdges} out
                </div>
              </>
            ) : (
              <>
                <div className="mb-1 text-muted-foreground">
                  {hover.edge.source} → {hover.edge.target}
                </div>
                <div className="text-right font-medium tabular-nums">
                  {formatValue(hover.edge.value, spec.unit)}
                </div>
              </>
            )}
          </CursorTooltip>
        )}
      </div>
    </div>
  );
}
