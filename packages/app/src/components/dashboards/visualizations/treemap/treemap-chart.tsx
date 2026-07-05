// oxlint-disable typescript/consistent-type-assertions -- every assertion here bridges recharts' erased tile types: it injects each leaf's concrete datum as flat props on the cell (typed only as the base props) and passes the datum back through onClick as `unknown`. These casts recover the concrete generic tile `T` that is provably present at runtime but that recharts' own types can't carry.
import { type ReactNode, useState } from "react";
import { ResponsiveContainer, Treemap } from "recharts";
import { CursorTooltip } from "@/components/cursor-tooltip";

export interface TreemapTileDatum {
  name: string;
  /** Text drawn inside the tile; falls back to `name`. */
  label?: string;
  /** Tile area — must be positive. */
  value: number;
  fill: string;
}

const TILE_GAP = 2;

interface TreemapCellProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  depth?: number;
  valueText?: (tile: TreemapTileDatum) => string | null;
  badgeText?: (tile: TreemapTileDatum) => string | null;
  onTileEnter?: (tile: TreemapTileDatum, e: React.MouseEvent) => void;
  onTileLeave?: () => void;
}

/** Custom Treemap cell — recharts injects the layout (x/y/width/height) and
 *  the tile's own datum fields as flat props on top of the ones set below. */
function TreemapCell(props: TreemapCellProps) {
  const { x = 0, y = 0, width = 0, height = 0, depth = 0 } = props;

  // recharts invokes content for the root node too — only leaves draw.
  if (depth <= 0) return null;
  const tileX = x + TILE_GAP / 2;
  const tileY = y + TILE_GAP / 2;
  const tileWidth = width - TILE_GAP;
  const tileHeight = height - TILE_GAP;
  if (tileWidth <= 0 || tileHeight <= 0) return null;

  const tile = props as unknown as TreemapTileDatum;
  const label = tile.label ?? tile.name ?? "";
  // Crude width fit (~6.5px/char at 11px); SVG text doesn't clip on its own.
  const canLabel = tileHeight >= 24 && tileWidth >= Math.min(64, label.length * 6.5 + 12);
  const valueText = props.valueText?.(tile) ?? null;
  const canValue =
    valueText !== null && canLabel && tileHeight >= 40 && tileWidth >= valueText.length * 6 + 12;
  const badge = props.badgeText?.(tile) ?? null;
  const canBadge = badge !== null && tileWidth >= 82 && tileHeight >= 24;
  const badgeWidth = badge === null ? 0 : badge.length * 6 + 14;
  const badgeX = tileX + tileWidth - badgeWidth - 6;

  return (
    <g
      onMouseEnter={(e) => props.onTileEnter?.(tile, e)}
      onMouseLeave={() => props.onTileLeave?.()}
    >
      <rect
        x={tileX}
        y={tileY}
        width={tileWidth}
        height={tileHeight}
        fill={tile.fill}
        fillOpacity={0.85}
        stroke="var(--card)"
        strokeWidth={1}
        rx={2}
      />
      {canBadge && (
        <>
          <rect
            x={badgeX}
            y={tileY + 6}
            width={badgeWidth}
            height={14}
            fill="rgba(15, 23, 42, 0.24)"
            rx={7}
          />
          <text
            x={badgeX + badgeWidth / 2}
            y={tileY + 15}
            fill="white"
            fontSize={8.5}
            textAnchor="middle"
          >
            {badge}
          </text>
        </>
      )}
      {canLabel && (
        <text x={tileX + 6} y={tileY + 15} fill="white" fontSize={11}>
          {label}
        </text>
      )}
      {canValue && (
        <text x={tileX + 6} y={tileY + 29} fill="white" opacity={0.85} fontSize={10}>
          {valueText}
        </text>
      )}
    </g>
  );
}

export interface TreemapChartProps<T extends TreemapTileDatum> {
  /** One entry per tile. Areas are proportional to `value`. */
  data: T[];
  /** Target tile aspect ratio for the squarified layout. */
  aspectRatio?: number;
  /** Secondary text under the tile label (e.g. a formatted value). */
  tileValueText?: (tile: T) => string | null;
  /** Small pill in the tile's top-right corner. */
  tileBadgeText?: (tile: T) => string | null;
  /** Tooltip card content for the hovered tile. Omit to disable the tooltip. */
  renderTooltip?: (tile: T) => ReactNode;
  onSelectTile?: (tile: T) => void;
}

/** Flat squarified treemap filling its parent — the parent controls the size. */
export function TreemapChart<T extends TreemapTileDatum>({
  data,
  aspectRatio = 4 / 3,
  tileValueText,
  tileBadgeText,
  renderTooltip,
  onSelectTile,
}: TreemapChartProps<T>) {
  // Tooltip follows the cursor (like the time-series chart's portal tooltip)
  // instead of recharts' tile-center anchoring: the hovered tile comes from
  // the cell's enter/leave, the position from every mousemove over the chart.
  const [hover, setHover] = useState<{ tile: T; x: number; y: number } | null>(null);

  return (
    <div
      className="h-full w-full"
      onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
      onMouseLeave={() => setHover(null)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={data}
          dataKey="value"
          aspectRatio={aspectRatio}
          type="flat"
          isAnimationActive={false}
          content={
            <TreemapCell
              valueText={tileValueText as TreemapCellProps["valueText"]}
              badgeText={tileBadgeText as TreemapCellProps["badgeText"]}
              onTileEnter={
                renderTooltip &&
                ((tile, e) => setHover({ tile: tile as T, x: e.clientX, y: e.clientY }))
              }
              onTileLeave={renderTooltip && (() => setHover(null))}
            />
          }
          onClick={
            onSelectTile &&
            ((node: unknown) => {
              const clicked = node as { payload?: T };
              onSelectTile(clicked?.payload ?? (node as T));
            })
          }
        />
      </ResponsiveContainer>
      {hover && renderTooltip && (
        <CursorTooltip x={hover.x} y={hover.y}>
          {renderTooltip(hover.tile)}
        </CursorTooltip>
      )}
    </div>
  );
}
