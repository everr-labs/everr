/**
 * PROTOTYPE variant B, "Map": where does an alert go, drawn.
 *
 * Alerts on the left (the default destination's tiers, then the rules that
 * name their own channels), channels on the right, and the deliveries between
 * them as drawn edges weighted by how much travelled in range. A tier with no
 * edge and a rule pointed at a channel that does not exist are visible as
 * exactly that: a source with nothing leaving it. Hovering or focusing a node
 * lights its edges and dims the rest, so "who hears about criticals" and
 * "what reaches #oncall" are the same gesture from either side.
 *
 * Narrow, the map stacks and the edges give way to a line of text on each
 * source, so nothing is lost, only the picture.
 */
import { Button } from "@everr/ui/components/button";
import { Switch } from "@everr/ui/components/switch";
import { kickerClass } from "@everr/ui/lib/typography";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { ROW_TARGET } from "@/components/alerts/list-row";
import type { AlertingSeverity } from "@/data/alerting/types";
import {
  CHANNELS,
  DELIVERIES,
  DESTINATION,
  type DeliveryRecord,
  MISSING_CHANNEL,
  OVERRIDES,
  SEVERITIES,
  TIER_DELIVERIES,
  UNDELIVERED,
} from "./fixtures";
import {
  ChannelMark,
  channelByNameOrMissing,
  channelDetail,
  DeliveryPhrase,
  SEVERITY_DOT,
  SEVERITY_LABEL,
} from "./shared";

type Source =
  | {
      kind: "tier";
      id: string;
      label: string;
      severity: AlertingSeverity | null;
    }
  | {
      kind: "rule";
      id: string;
      label: string;
      severity: AlertingSeverity;
      path: string;
    };

type Edge = { from: string; to: string; sent: number; failed: number };

type Point = { x: number; y: number };
type Drawn = Edge & { a: Point; b: Point };

function sources(split: boolean): Source[] {
  const tiers: Source[] = split
    ? SEVERITIES.map((s) => ({
        kind: "tier",
        id: `tier:${s}`,
        label: SEVERITY_LABEL[s],
        severity: s,
      }))
    : [{ kind: "tier", id: "tier:all", label: "All alerts", severity: null }];
  const rules: Source[] = OVERRIDES.map((r) => ({
    kind: "rule",
    id: `rule:${r.path}`,
    label: r.name,
    severity: r.severity,
    path: r.path,
  }));
  return [...tiers, ...rules];
}

function edges(split: boolean): Edge[] {
  const out: Edge[] = [];
  if (split) {
    for (const s of SEVERITIES) {
      for (const name of DESTINATION.tiers[s]) {
        const r = TIER_DELIVERIES[s]?.[name];
        out.push({
          from: `tier:${s}`,
          to: name,
          sent: r?.sent ?? 0,
          failed: r?.failed ?? 0,
        });
      }
    }
  } else {
    for (const name of DESTINATION.tiers.all) {
      const r = DELIVERIES[name];
      out.push({
        from: "tier:all",
        to: name,
        sent: r?.sent ?? 0,
        failed: r?.failed ?? 0,
      });
    }
  }
  for (const rule of OVERRIDES) {
    for (const name of rule.channels) {
      // Per-rule counts are not in the fixture; a rule edge draws thin.
      out.push({ from: `rule:${rule.path}`, to: name, sent: 3, failed: 0 });
    }
  }
  return out;
}

function targetsFor(name: string, all: Edge[]) {
  return all.filter((e) => e.to === name).map((e) => e.from);
}

function strokeWidth(sent: number): number {
  return 1 + Math.min(4, Math.log10(sent + 1) * 1.6);
}

export function VariantMap({ now }: { now: number }) {
  const [split, setSplit] = useState(DESTINATION.split);
  const [focus, setFocus] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState<Drawn[]>([]);

  const srcs = sources(split);
  const links = edges(split);
  const targets = [...CHANNELS.map((c) => c.name), MISSING_CHANNEL];

  // Measure the anchors after layout and redraw when the container resizes.
  // The edges are derived from the DOM, so this is the one place the DOM is
  // the source of truth rather than the state.
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const anchor = (sel: string, side: "right" | "left"): Point | null => {
        const el = root.querySelector<HTMLElement>(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: (side === "right" ? r.right : r.left) - box.left,
          y: r.top + r.height / 2 - box.top,
        };
      };
      const next: Drawn[] = [];
      for (const e of links) {
        const a = anchor(`[data-source="${CSS.escape(e.from)}"]`, "right");
        const b = anchor(`[data-target="${CSS.escape(e.to)}"]`, "left");
        if (a && b) next.push({ ...e, a, b });
      }
      setDrawn(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
    // `links` is rebuilt every render; `split` is the only input that changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [split]);

  const lit = (id: string) =>
    focus === null ||
    focus === id ||
    links.some(
      (e) =>
        (e.from === focus && e.to === id) || (e.to === focus && e.from === id),
    );

  const lastSourceTier = split ? `tier:info` : "tier:all";

  return (
    <div className="@container/map">
      <h1 className="sr-only">Notifications</h1>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
        <p className="max-w-prose text-sm text-muted-foreground">
          Every alert delivers to the default destination unless its rule names
          channels of its own. Counts are deliveries in the selected range.
        </p>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-xs">
            <Switch
              aria-label="Split by severity"
              checked={split}
              onCheckedChange={setSplit}
            />
            Split by severity
          </span>
          <Button size="sm">
            <Plus className="size-4" />
            New channel
          </Button>
        </div>
      </div>

      <div
        ref={container}
        className="relative grid grid-cols-1 gap-x-16 gap-y-6 px-3 py-4 @[46rem]/map:grid-cols-[minmax(14rem,1fr)_minmax(16rem,1.2fr)] @[60rem]/map:gap-x-28"
      >
        {/* Edges, only where the two columns sit beside each other. */}
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden h-full w-full @[46rem]/map:block"
        >
          <title>Delivery routes</title>
          {drawn.map((e) => {
            const mx = (e.a.x + e.b.x) / 2;
            const active = focus === null || focus === e.from || focus === e.to;
            return (
              <path
                key={`${e.from}->${e.to}`}
                d={`M ${e.a.x} ${e.a.y} C ${mx} ${e.a.y}, ${mx} ${e.b.y}, ${e.b.x} ${e.b.y}`}
                fill="none"
                strokeWidth={strokeWidth(e.sent)}
                strokeLinecap="round"
                className={cn(
                  "transition-[opacity,stroke] duration-200",
                  e.failed > 0 ? "stroke-destructive" : "stroke-foreground",
                  active
                    ? e.failed > 0
                      ? "opacity-70"
                      : "opacity-45"
                    : "opacity-[0.07]",
                )}
              />
            );
          })}
        </svg>

        {/* Sources */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className={cn(kickerClass, "px-1")}>Alerts</div>
          {srcs.map((s) => {
            const out = links.filter((e) => e.from === s.id);
            const gap = out.length === 0;
            const missing = out.some(
              (e) => channelByNameOrMissing(e.to).missing,
            );
            const active = lit(s.id);
            const undelivered =
              s.id === "tier:info" && gap
                ? (UNDELIVERED.tiers.info ?? 0)
                : missing
                  ? (UNDELIVERED.rules["platform/k8s-node-not-ready"] ?? 0)
                  : 0;
            return (
              <div key={s.id} className="contents">
                {s.kind === "rule" && s.id === `rule:${OVERRIDES[0]?.path}` && (
                  <div className={cn(kickerClass, "mt-4 px-1")}>
                    Rules with their own channels
                  </div>
                )}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: hover lights the edges; the link inside is the control */}
                <div
                  data-source={s.id}
                  onMouseEnter={() => setFocus(s.id)}
                  onMouseLeave={() => setFocus(null)}
                  onFocus={() => setFocus(s.id)}
                  onBlur={() => setFocus(null)}
                  className={cn(
                    "relative rounded-md border bg-card px-3 py-2 transition-opacity duration-200",
                    !active && "opacity-40",
                    gap || missing ? "border-chart-2/50" : "border-border",
                    s.id === lastSourceTier && "mb-0",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {s.severity && (
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          SEVERITY_DOT[s.severity],
                        )}
                      />
                    )}
                    {s.kind === "rule" ? (
                      <Link
                        to="/alerts"
                        search={(prev) => ({ ...prev, alert: s.path })}
                        title={s.path}
                        className={cn(ROW_TARGET, "text-sm font-medium")}
                      >
                        {s.label}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">{s.label}</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-xs text-muted-foreground">
                    {s.kind === "tier" && !gap && (
                      <span className="tabular-nums">
                        {out.reduce((n, e) => n + e.sent, 0)} sent
                      </span>
                    )}
                    {gap && <span className="text-chart-2">no channel</span>}
                    {undelivered > 0 && (
                      <span className="text-chart-2 tabular-nums">
                        {undelivered} not delivered
                      </span>
                    )}
                    {/* Where it goes, in words, for the stacked layout. */}
                    <span className="@[46rem]/map:hidden">
                      {out.length > 0 && `→ ${out.map((e) => e.to).join(", ")}`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Targets */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className={cn(kickerClass, "px-1")}>Channels</div>
          {targets.map((name) => {
            const channel = channelByNameOrMissing(name);
            const record: DeliveryRecord | undefined = DELIVERIES[name];
            const inbound = targetsFor(name, links);
            const idle = inbound.length === 0;
            const active = lit(name);
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover lights the edges; the button inside is the control
              <div
                key={name}
                data-target={name}
                onMouseEnter={() => setFocus(name)}
                onMouseLeave={() => setFocus(null)}
                onFocus={() => setFocus(name)}
                onBlur={() => setFocus(null)}
                className={cn(
                  "flex items-center gap-3 rounded-md border bg-card px-3 py-2 transition-opacity duration-200",
                  !active && "opacity-40",
                  channel.missing &&
                    "border-dashed border-chart-2/60 bg-transparent",
                  !channel.missing && idle && "border-border/60",
                )}
              >
                {channel.missing ? (
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-md border border-dashed border-chart-2/60 font-mono text-xs text-chart-2"
                  >
                    ?
                  </span>
                ) : (
                  <ChannelMark type={channel.config.type} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <button
                      type="button"
                      className={cn(ROW_TARGET, "text-sm font-medium")}
                    >
                      {name}
                    </button>
                    {channel.missing && (
                      <span className="font-mono text-xs text-chart-2">
                        does not exist
                      </span>
                    )}
                    {!channel.missing && idle && (
                      <span className="font-mono text-xs text-muted-foreground">
                        nothing points here
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {channel.missing
                      ? `named by ${inbound.length} rule · ${UNDELIVERED.rules["platform/k8s-node-not-ready"] ?? 0} undelivered`
                      : channelDetail(channel)}
                  </div>
                  {record?.lastError && (
                    <div className="truncate font-mono text-xs text-destructive">
                      {record.lastError}
                    </div>
                  )}
                </div>
                {!channel.missing && (
                  <DeliveryPhrase
                    record={record}
                    now={now}
                    className="shrink-0 justify-end text-right font-mono text-xs"
                  />
                )}
              </div>
            );
          })}
          {/* The one action a map cannot draw: making the missing channel. */}
          <Button variant="outline" size="sm" className="self-start">
            <Plus className="size-3.5" />
            Create {MISSING_CHANNEL}
          </Button>
        </div>
      </div>
    </div>
  );
}
