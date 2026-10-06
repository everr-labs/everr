// Third-party attribution and license: see the root NOTICE and LICENSE in this directory.
// SPDX-License-Identifier: MIT
// Adapted for Everr. See README.md for upstream provenance and changes.

import { formatDuration as formatEverrDuration } from "@everr/ui/lib/formatting";
import { resolveThemeColor } from "../theme-colors";
import {
  DASHED_BORDER_LINE_DASH,
  EVENT_DOT_SIZE_RATIO,
  LABEL_FONT,
  LABEL_PADDING_X,
  MAX_EVENT_DOT_SIZE,
  MAX_SPAN_BAR_HEIGHT,
  MIN_EVENT_DOT_SIZE,
  MIN_SPAN_BAR_HEIGHT,
  MIN_WIDTH_FOR_NAME,
  MIN_WIDTH_FOR_NAME_AND_DURATION,
  SPAN_BAR_HEIGHT_RATIO,
} from "./constants";
import type { EventRect, FlamegraphSpan, SpanRect } from "./types";

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export interface FlamegraphRowMetrics {
  ROW_HEIGHT: number;
  SPAN_BAR_HEIGHT: number;
  SPAN_BAR_Y_OFFSET: number;
  EVENT_DOT_SIZE: number;
}

export function getFlamegraphRowMetrics(
  rowHeight: number,
): FlamegraphRowMetrics {
  const spanBarHeight = clamp(
    Math.round(rowHeight * SPAN_BAR_HEIGHT_RATIO),
    MIN_SPAN_BAR_HEIGHT,
    MAX_SPAN_BAR_HEIGHT,
  );
  const spanBarYOffset = Math.floor((rowHeight - spanBarHeight) / 2);
  const eventDotSize = clamp(
    Math.round(spanBarHeight * EVENT_DOT_SIZE_RATIO),
    MIN_EVENT_DOT_SIZE,
    MAX_EVENT_DOT_SIZE,
  );

  return {
    ROW_HEIGHT: rowHeight,
    SPAN_BAR_HEIGHT: spanBarHeight,
    SPAN_BAR_Y_OFFSET: spanBarYOffset,
    EVENT_DOT_SIZE: eventDotSize,
  };
}

interface EventDotColor {
  fill: string;
  stroke: string;
}

/** Event markers use theme tokens, with destructive coloring for errors. */
function getEventDotColor(isError: boolean): EventDotColor {
  return {
    fill: resolveThemeColor(
      isError ? "var(--destructive)" : "var(--foreground)",
    ),
    stroke: resolveThemeColor("var(--background)"),
  };
}

interface DrawEventDotArgs {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  color: EventDotColor;
  eventDotSize: number;
}

function drawEventDot(args: DrawEventDotArgs): void {
  const { ctx, x, y, color, eventDotSize } = args;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);

  ctx.fillStyle = color.fill;
  ctx.strokeStyle = color.stroke;

  ctx.lineWidth = 1;
  const half = eventDotSize / 2;
  ctx.fillRect(-half, -half, eventDotSize, eventDotSize);
  ctx.strokeRect(-half, -half, eventDotSize, eventDotSize);
  ctx.restore();
}

interface DrawSpanBarArgs {
  ctx: CanvasRenderingContext2D;
  span: FlamegraphSpan;
  x: number;
  y: number;
  width: number;
  levelIndex: number;
  spanRectsArray: SpanRect[];
  eventRectsArray: EventRect[];
  color: string;
  metrics: FlamegraphRowMetrics;
  viewStartTs: number;
  timeSpan: number;
  cssWidth: number;
  selectedSpanId?: string | null;
  hoveredSpanId?: string | null;
  isDimmedByFilter?: boolean;
}

export function drawSpanBar(args: DrawSpanBarArgs): void {
  const {
    ctx,
    span,
    x,
    y,
    width,
    levelIndex,
    spanRectsArray,
    eventRectsArray,
    color,
    metrics,
    viewStartTs,
    timeSpan,
    cssWidth,
    selectedSpanId,
    hoveredSpanId,
    isDimmedByFilter,
  } = args;

  const spanY = y + metrics.SPAN_BAR_Y_OFFSET;
  const isSelected = selectedSpanId === span.spanId;
  const isHovered = hoveredSpanId === span.spanId;
  const isSelectedOrHovered = isSelected || isHovered;
  const shouldDim = isDimmedByFilter && !isSelectedOrHovered;

  // Dim non-matching spans when filter is active (matches waterfall's .dimmed-span { opacity: 0.4 }).
  // Alpha is applied to bar + events only; label is drawn after restoring alpha to 1
  // so text stays readable against the faded bar.
  if (shouldDim) {
    ctx.globalAlpha = 0.15;
  }

  ctx.beginPath();
  ctx.roundRect(x, spanY, width, metrics.SPAN_BAR_HEIGHT, 2);

  if (isSelectedOrHovered) {
    // Selection uses the same background token as the surrounding UI.
    ctx.fillStyle = resolveThemeColor("var(--background)");
    ctx.fill();
    if (isSelected) {
      ctx.setLineDash(DASHED_BORDER_LINE_DASH);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();
    if (isSelected) {
      ctx.setLineDash([]);
    }
  } else {
    ctx.fillStyle = color;
    ctx.fill();
    // Subtle outline to match spec: 1px semi-transparent black border at rest
    ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (span.hasError) {
    ctx.save();
    ctx.globalAlpha = shouldDim ? 0.05 : 0.3;
    ctx.fillStyle = resolveThemeColor("var(--destructive)");
    ctx.fill();
    ctx.globalAlpha = shouldDim ? 0.15 : 1;
    ctx.strokeStyle = resolveThemeColor("var(--destructive)");
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  spanRectsArray.push({
    span,
    x,
    y: spanY,
    width,
    height: metrics.SPAN_BAR_HEIGHT,
    level: levelIndex,
    color,
  });

  span.event?.forEach((event) => {
    const spanDurationMs = span.durationNano / 1e6;
    if (spanDurationMs <= 0) {
      return;
    }

    const eventTimeMs = event.offsetNs / 1e6;
    if (eventTimeMs < viewStartTs || eventTimeMs > viewStartTs + timeSpan)
      return;
    const eventX = ((eventTimeMs - viewStartTs) / timeSpan) * cssWidth;
    const eventY = spanY + metrics.SPAN_BAR_HEIGHT / 2;

    const dotColor = getEventDotColor(event.isError);
    drawEventDot({
      ctx,
      x: eventX,
      y: eventY,
      color: dotColor,
      eventDotSize: metrics.EVENT_DOT_SIZE,
    });

    eventRectsArray.push({
      event,
      span,
      cx: eventX,
      cy: eventY,
      halfSize: metrics.EVENT_DOT_SIZE / 2,
    });
  });

  // Restore alpha before drawing label so text is legible on dimmed bars
  if (shouldDim) {
    ctx.globalAlpha = 1;
  }

  drawSpanLabel({
    ctx,
    span,
    x,
    y: spanY,
    width,
    color,
    isSelectedOrHovered,
    spanBarHeight: metrics.SPAN_BAR_HEIGHT,
  });
}

function formatDuration(durationNano: number): string {
  const durationMs = durationNano / 1e6;
  return formatEverrDuration(durationMs, "ms");
}

interface DrawSpanLabelArgs {
  ctx: CanvasRenderingContext2D;
  span: FlamegraphSpan;
  x: number;
  y: number;
  width: number;
  color: string;
  isSelectedOrHovered: boolean;
  spanBarHeight: number;
}

function drawSpanLabel(args: DrawSpanLabelArgs): void {
  const { ctx, span, x, y, width, color, isSelectedOrHovered, spanBarHeight } =
    args;

  if (width < MIN_WIDTH_FOR_NAME) {
    return;
  }

  const name = span.name;

  ctx.save();

  // Clip text to span bar bounds
  ctx.beginPath();
  ctx.rect(x, y, width, spanBarHeight);
  ctx.clip();

  ctx.font = LABEL_FONT;
  ctx.fillStyle = isSelectedOrHovered ? color : "rgba(0, 0, 0, 0.7)";
  ctx.textBaseline = "middle";

  const textY = y + spanBarHeight / 2;
  const leftX = x + LABEL_PADDING_X;
  const rightX = x + width - LABEL_PADDING_X;
  const availableWidth = width - LABEL_PADDING_X * 2;

  if (width >= MIN_WIDTH_FOR_NAME_AND_DURATION) {
    const duration = formatDuration(span.durationNano);
    const durationWidth = ctx.measureText(duration).width;
    const minGap = 6;
    const nameSpace = availableWidth - durationWidth - minGap;

    // Duration right-aligned
    ctx.textAlign = "right";
    ctx.fillText(duration, rightX, textY);

    // Name left-aligned, truncated to fit remaining space
    if (nameSpace > 20) {
      ctx.textAlign = "left";
      ctx.fillText(truncateText(ctx, name, nameSpace), leftX, textY);
    }
  } else {
    // Name only, truncated to fit
    ctx.textAlign = "left";
    ctx.fillText(truncateText(ctx, name, availableWidth), leftX, textY);
  }

  ctx.restore();
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  const ellipsis = "...";
  const ellipsisWidth = ctx.measureText(ellipsis).width;

  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid)).width + ellipsisWidth <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo > 0 ? `${text.slice(0, lo)}${ellipsis}` : ellipsis;
}
