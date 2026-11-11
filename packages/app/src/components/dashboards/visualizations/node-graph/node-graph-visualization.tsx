import { serviceColor } from "@everr/telemetry-explorer/traces/service-color";
import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { Link } from "@tanstack/react-router";
import { Share2 } from "lucide-react";
import {
  Fragment,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { truncateWithEllipsis } from "#app/lib/truncate.ts";
import { SERIES_COLORS } from "../data-utils";
import { createTextMeasurer } from "../echarts/axis";
import type { VisualizationProps } from "../index";
import { PanelEmptyState } from "../panel-empty-state";
import { createValueFormatter } from "../value-format";
import { arrowhead, fitToPanel, layoutGraph, NODE_HEIGHT, routePath } from "./layered-layout";
import {
  buildNodeGraph,
  edgeKey,
  type GraphEdge,
  type GraphNode,
  type Health,
} from "./node-graph-data";
import type { NodeGraphSpec } from "./spec";

const MIN_EDGE_WIDTH = 1;
const MAX_EDGE_WIDTH = 3;
/** Room around the layout, so card borders and arrowheads aren't clipped. */
const PADDING = 16;
const MAX_LABEL_CHARS = 18;
/** Card width bounds; between them the widest name or stats line sets it. */
const MIN_NODE_WIDTH = 64;
const MAX_NODE_WIDTH = 260;
/** The card's two lines, measured and drawn with the same fonts. */
const NAME_FONT = { size: 12, weight: 600 } as const;
const STATS_FONT_SIZE = 11;
const STATS_SEPARATOR = " · ";
const CARD_INSET = 12;
const CARD_RADIUS = 8;
/** Where the name and value start, after the node's color dot. */
const TEXT_X = 24;

/** Hover dims and highlights ease in rather than snap. */
const HOVER_TRANSITION =
  "transition-[opacity,stroke,fill] duration-150 ease-out motion-reduce:transition-none";
const EDGE_COLOR = "color-mix(in oklab, var(--muted-foreground) 55%, var(--card))";
// Raised a step from the panel, so cards read as objects rather than holes.
const CARD_FILL = "color-mix(in oklab, var(--foreground) 5%, var(--card))";
const CARD_STROKE = "color-mix(in oklab, var(--foreground) 14%, var(--card))";
/** The hover highlight: the chart accent, which no health state uses. */
const HIGHLIGHT_COLOR = SERIES_COLORS[0];
/** The same green, amber and red the stat thresholds use in the demo dashboards. */
const HEALTH_COLOR = {
  ok: "#22c55e",
  warning: "#f59e0b",
  critical: "#ef4444",
};

/** Value → [min, max] with area (not width) tracking the value. */
function sqrtScale(value: number, domain: [number, number], range: [number, number]): number {
  if (domain[1] <= domain[0]) return (range[0] + range[1]) / 2;
  const t = Math.sqrt((value - domain[0]) / (domain[1] - domain[0]));
  return range[0] + t * (range[1] - range[0]);
}

/** A figure on a card or in a tooltip: the value, then each stat, colored
 * by its level. */
interface Figure {
  label: string;
  text: string;
  color?: string;
}

type Hover = { kind: "node"; node: GraphNode } | { kind: "edge"; edge: GraphEdge };

/**
 * The container is measured so the layout can fit its real size: the gap
 * between ranks shrinks first, and the graph only scales down (text with it)
 * when that isn't enough. Its font is read too, to measure card text.
 */
function useContainerSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number; font: string } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const font = getComputedStyle(el).fontFamily;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight, font });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

export function NodeGraphVisualization({
  spec,
  data,
  timeRange,
}: VisualizationProps<NodeGraphSpec>) {
  const { formatter, figures } = useMemo(() => {
    const formatter = createValueFormatter(spec.valueFormat);
    const statFormatters = new Map(
      spec.stats.map((stat) => [stat.column, createValueFormatter(stat.format)]),
    );
    const figures = (value: number, health: Health | undefined): Figure[] => [
      { label: "Value", text: formatter.format(value) },
      ...(health?.stats ?? []).map((stat) => ({
        label: stat.column,
        text: statFormatters.get(stat.column)?.format(stat.value) ?? String(stat.value),
        color: stat.level && HEALTH_COLOR[stat.level],
      })),
    ];
    return { formatter, figures };
  }, [spec.valueFormat, spec.stats]);
  // The bar shows the first rate, such as the share of calls that failed.
  const barColumn = spec.stats.find((stat) => stat.reduce === "rate")?.column;
  const model = useMemo(() => (data ? buildNodeGraph(data, spec) : null), [data, spec]);
  const { ref: containerRef, size } = useContainerSize();
  const font = size?.font;
  // Measured only once the panel has a font, so never during server rendering.
  const { nodeWidth, cardFigures } = useMemo(() => {
    const cardFigures = new Map<string, { shown: Figure[]; more: boolean }>();
    if (!model || font === undefined) return { nodeWidth: MIN_NODE_WIDTH, cardFigures };
    const measureName = createTextMeasurer(font, NAME_FONT.size, NAME_FONT.weight);
    const measureStats = createTextMeasurer(font, STATS_FONT_SIZE);
    const statsLine = (shown: Figure[], more: boolean) =>
      measureStats([...shown.map((f) => f.text), ...(more ? ["…"] : [])].join(STATS_SEPARATOR));
    const all = new Map(model.nodes.map((n) => [n.id, figures(n.value, n.health)]));
    const text = Math.max(
      0,
      ...model.nodes.map((n) =>
        Math.max(
          measureName(truncateWithEllipsis(n.id, MAX_LABEL_CHARS)),
          statsLine(all.get(n.id) ?? [], false),
        ),
      ),
    );
    const nodeWidth = Math.min(
      MAX_NODE_WIDTH,
      Math.max(MIN_NODE_WIDTH, Math.ceil(text) + TEXT_X + CARD_INSET),
    );
    // A capped card shows the figures that fit whole, then an ellipsis; the
    // tooltip has them all. A first figure too wide on its own is cut short.
    const room = nodeWidth - TEXT_X - CARD_INSET;
    for (const [id, list] of all) {
      let count = list.length;
      while (count > 1 && statsLine(list.slice(0, count), count < list.length) > room) count--;
      const [first] = list;
      if (count === 1 && first && statsLine([first], false) > room) {
        let text = first.text;
        while (text.length > 1 && measureStats(`${text}…`) > room) text = text.slice(0, -1);
        cardFigures.set(id, { shown: [{ ...first, text: `${text.trimEnd()}…` }], more: false });
        continue;
      }
      cardFigures.set(id, { shown: list.slice(0, count), more: count < list.length });
    }
    return { nodeWidth, cardFigures };
  }, [model, font, figures]);
  // Laid out once per result; fitting it to the panel only moves points.
  const laidOut = useMemo(
    () =>
      model
        ? layoutGraph(
            model.nodes.map((n) => n.id),
            model.edges,
            { nodeWidth, labels: spec.showValues },
          )
        : null,
    [model, nodeWidth, spec.showValues],
  );
  const fitted = useMemo(() => {
    if (!laidOut || !size) return null;
    const room = { width: size.width - PADDING * 2, height: size.height - PADDING * 2 };
    return { room, graph: fitToPanel(laidOut, room) };
  }, [laidOut, size]);
  const [hover, setHover] = useState<Hover | null>(null);
  const hoveredNode = hover?.kind === "node" ? hover.node.id : null;
  // The hovered node and its neighbors, to dim everything else.
  const active = useMemo(() => {
    if (hoveredNode === null || !model) return null;
    const ids = new Set([hoveredNode]);
    for (const e of model.edges) {
      if (e.source === hoveredNode) ids.add(e.target);
      if (e.target === hoveredNode) ids.add(e.source);
    }
    return ids;
  }, [hoveredNode, model]);

  if (!model || model.nodes.length === 0)
    return (
      <PanelEmptyState
        icon={Share2}
        data={data}
        unusable="No row has both a source and a different target node."
      />
    );
  const { nodes, edges, droppedRows, hiddenNodes } = model;

  let low = Infinity;
  let high = -Infinity;
  for (const e of edges) {
    low = Math.min(low, e.value);
    high = Math.max(high, e.value);
  }
  const isEdgeActive = (e: GraphEdge) =>
    hoveredNode === null || e.source === hoveredNode || e.target === hoveredNode;
  const traceRange = { from: timeRange.from.toISOString(), to: timeRange.to.toISOString() };

  const notShown = [
    droppedRows > 0 && `${droppedRows} row${droppedRows === 1 ? "" : "s"}`,
    hiddenNodes > 0 && `${hiddenNodes} node${hiddenNodes === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  let transform = "";
  if (size && fitted) {
    const { room, graph } = fitted;
    const scale = Math.min(
      1,
      room.width / Math.max(graph.width, 1),
      room.height / Math.max(graph.height, 1),
    );
    const x = (size.width - graph.width * scale) / 2;
    const y = (size.height - graph.height * scale) / 2;
    transform = `translate(${x} ${y}) scale(${scale})`;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 overflow-hidden"
      onMouseLeave={() => setHover(null)}
    >
      {size && fitted && (
        <svg
          width={size.width}
          height={size.height}
          className="block"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- must stay an <svg> to render the graph nodes/edges; role="img" + aria-label give it an accessible name
          role="img"
          aria-label="Node graph"
        >
          <g transform={transform}>
            {edges.map((edge) => {
              const key = edgeKey(edge.source, edge.target);
              const route = fitted.graph.edges.get(key);
              if (!route) return null;
              const width = edge.hasValue
                ? sqrtScale(edge.value, [low, high], [MIN_EDGE_WIDTH, MAX_EDGE_WIDTH])
                : 1.5;
              const { route: line, head } = spec.directed
                ? arrowhead(route.points, width)
                : { route: route.points, head: "" };
              const d = routePath(line);
              // Only health colors an edge; the hovered node's other edges
              // take the accent, never its service color, which could read
              // as a health state.
              const level = edge.health?.level;
              const color =
                level === "warning" || level === "critical"
                  ? HEALTH_COLOR[level]
                  : hoveredNode !== null && isEdgeActive(edge)
                    ? HIGHLIGHT_COLOR
                    : EDGE_COLOR;
              return (
                <g key={key} opacity={isEdgeActive(edge) ? 1 : 0.2} className={HOVER_TRANSITION}>
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    className={HOVER_TRANSITION}
                    strokeWidth={width}
                    pointerEvents="none"
                  />
                  {head && (
                    <polygon
                      points={head}
                      fill={color}
                      className={HOVER_TRANSITION}
                      pointerEvents="none"
                    />
                  )}
                  {spec.showValues && (
                    <text
                      x={route.label.x}
                      y={route.label.y}
                      dominantBaseline="central"
                      textAnchor="middle"
                      fontSize={10}
                      fill="var(--muted-foreground)"
                      stroke="var(--card)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      pointerEvents="none"
                    >
                      {formatter.format(edge.value)}
                    </text>
                  )}
                  {/* invisible wide hit area for the tooltip */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(10, width)}
                    onMouseEnter={() => setHover({ kind: "edge", edge })}
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              );
            })}

            {nodes.map((node) => {
              const p = fitted.graph.nodes.get(node.id);
              if (!p) return null;
              const x = p.x - nodeWidth / 2;
              const y = p.y - NODE_HEIGHT / 2;
              const level = node.health?.level;
              const line = cardFigures.get(node.id);
              const rate =
                barColumn === undefined
                  ? undefined
                  : node.health?.stats.find((stat) => stat.column === barColumn)?.value;
              const card = (
                <>
                  <rect
                    x={x}
                    y={y}
                    width={nodeWidth}
                    height={NODE_HEIGHT}
                    rx={CARD_RADIUS}
                    fill={CARD_FILL}
                    stroke={
                      hoveredNode === node.id
                        ? HIGHLIGHT_COLOR
                        : level === "warning" || level === "critical"
                          ? HEALTH_COLOR[level]
                          : CARD_STROKE
                    }
                    className={HOVER_TRANSITION}
                  />
                  {rate !== undefined && (
                    <ShareBar
                      x={x + CARD_INSET}
                      y={y + NODE_HEIGHT - 6}
                      width={nodeWidth - CARD_INSET * 2}
                      rate={rate}
                    />
                  )}
                  <circle
                    cx={x + CARD_INSET + 3}
                    cy={y + 16}
                    r={3.5}
                    // The same color the service has in Traces.
                    fill={serviceColor(node.id)}
                  />
                  <text
                    x={x + TEXT_X}
                    y={y + 20}
                    fill="var(--foreground)"
                    fontSize={NAME_FONT.size}
                    fontWeight={NAME_FONT.weight}
                    pointerEvents="none"
                  >
                    {truncateWithEllipsis(node.id, MAX_LABEL_CHARS)}
                  </text>
                  <text
                    x={x + TEXT_X}
                    y={y + 34}
                    fill="var(--muted-foreground)"
                    fontSize={STATS_FONT_SIZE}
                    className="tabular-nums"
                    pointerEvents="none"
                  >
                    {(line?.shown ?? figures(node.value, node.health)).map((f, i) => (
                      <Fragment key={f.label}>
                        {i > 0 && STATS_SEPARATOR}
                        <tspan fill={f.color}>{f.text}</tspan>
                      </Fragment>
                    ))}
                    {line?.more && `${STATS_SEPARATOR}…`}
                  </text>
                </>
              );
              return (
                <g
                  key={node.id}
                  opacity={active === null || active.has(node.id) ? 1 : 0.3}
                  className={HOVER_TRANSITION}
                  onMouseEnter={() => setHover({ kind: "node", node })}
                  onMouseLeave={() => setHover(null)}
                >
                  {spec.linkToTraces ? (
                    <Link
                      to="/traces"
                      search={{ service: [node.id], ...traceRange }}
                      aria-label={`Traces for ${node.id}`}
                    >
                      {card}
                    </Link>
                  ) : (
                    card
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {/* rows the result contained but the graph could not place */}
      {notShown && (
        <div className="pointer-events-none absolute top-2 right-2 rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
          {notShown} not shown
        </div>
      )}

      {hover && (
        <PointerTooltip containerRef={containerRef}>
          {hover.kind === "node" ? (
            <>
              <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: serviceColor(hover.node.id) }}
                />
                {hover.node.id}
              </div>
              <FigureRows figures={figures(hover.node.value, hover.node.health)} />
              <div className="mt-1 text-muted-foreground">
                {hover.node.inEdges} in · {hover.node.outEdges} out
                {spec.linkToTraces && " · click for traces"}
              </div>
            </>
          ) : (
            <>
              <div className="mb-1 text-muted-foreground">
                {hover.edge.source} → {hover.edge.target}
              </div>
              <FigureRows figures={figures(hover.edge.value, hover.edge.health)} />
            </>
          )}
        </PointerTooltip>
      )}
    </div>
  );
}

/**
 * A CursorTooltip that follows the pointer over `containerRef` on its own,
 * so moving the mouse re-renders only the tooltip, never the graph.
 */
function PointerTooltip({
  containerRef,
  children,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const move = (e: MouseEvent) => setPointer({ x: e.clientX, y: e.clientY });
    el.addEventListener("mousemove", move);
    return () => el.removeEventListener("mousemove", move);
  }, [containerRef]);
  if (!pointer) return null;
  return (
    <CursorTooltip x={pointer.x} y={pointer.y}>
      {children}
    </CursorTooltip>
  );
}

/**
 * A bar split by the first rate stat, usually the share of the calls a node
 * receives that failed: red for that share, green for the rest, so how bad a
 * failing node is shows at a glance. Any share gets at least a sliver, so it
 * never vanishes into rounding.
 */
function ShareBar({ x, y, width, rate }: { x: number; y: number; width: number; rate: number }) {
  const failed = rate > 0 ? Math.min(width, Math.max(2, width * rate)) : 0;
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={width} height={2.5} rx={1.25} fill={HEALTH_COLOR.ok} opacity={0.7} />
      {failed > 0 && (
        <rect
          x={x + width - failed}
          y={y}
          width={failed}
          height={2.5}
          rx={1.25}
          fill={HEALTH_COLOR.critical}
        />
      )}
    </g>
  );
}

function FigureRows({ figures }: { figures: Figure[] }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
      {figures.map(({ label, text, color }) => (
        <Fragment key={label}>
          <span className="text-muted-foreground">{label}</span>
          <span className="text-right font-medium tabular-nums" style={{ color }}>
            {text}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
