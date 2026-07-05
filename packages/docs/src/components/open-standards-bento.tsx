import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from "@everr/ui/components/avatar";
import { cn } from "@everr/ui/lib/utils";
import { SiClickhouse } from "@icons-pack/react-simple-icons";
import {
  ArrowRight,
  GitCommitVertical,
  LineChart,
  type LucideIcon,
  Network,
  Tags,
  Terminal,
} from "lucide-react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import otelLogo from "../assets/logos/otel.svg?url";
import persesLogo from "../assets/logos/perses.svg?url";
import space3 from "../assets/space/3.webp?url";
import space4 from "../assets/space/4.webp?url";
import space6 from "../assets/space/6.webp?url";
import space9 from "../assets/space/9.webp?url";
import space11 from "../assets/space/11.webp?url";
import claudeMark from "./icons/claudecode.svg";
import codexMark from "./icons/codex.svg";
import knoticMark from "./icons/knotic.svg";
import opencodeMark from "./icons/opencode.svg";
import piMark from "./icons/pi.svg";
import { WindowChrome } from "./ui/window-chrome";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/*  Section                                                            */
/* ------------------------------------------------------------------ */

export function OpenStandardsBento() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background">
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* Header */}
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Built on open standards
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Open standards, top to bottom.{" "}
            <span className="text-primary">No lock-in by design.</span>
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Everr doesn&apos;t invent a private model. Your telemetry is OpenTelemetry, your
            dashboards and alerts are plain files, and you query all of it with SQL.
          </p>
        </motion.div>

        {/* Bento */}
        <div className="mt-14 grid grid-cols-1 gap-4 md:mt-20 md:auto-rows-[22rem] md:grid-cols-12">
          {ITEMS.map((item, i) => (
            <BentoItem key={item.title} item={item} index={i} inView={inView} />
          ))}
        </div>

        {/* Footer link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : undefined}
          transition={{ duration: 0.6, delay: 0.5, ease: EASE }}
          className="mt-10 flex justify-center"
        >
          <a
            href="/docs"
            className="group inline-flex items-center gap-1.5 font-heading text-sm font-bold text-fd-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
          >
            See how it fits together
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Bento item                                                        */
/* ------------------------------------------------------------------ */

type Item = {
  title: string;
  description: string;
  /** Artifact fills the whole card edge-to-edge; the text floats over it. */
  header: ReactNode;
  icon: LucideIcon;
  className?: string;
};

function BentoItem({ item, index, inView }: { item: Item; index: number; inView: boolean }) {
  const Icon = item.icon;
  const text = (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-primary" strokeWidth={2} aria-hidden />
        <h3 className="font-heading text-base font-bold tracking-tight text-fd-foreground">
          {item.title}
        </h3>
      </div>
      <p className="mt-1.5 text-sm leading-snug text-fd-muted-foreground">{item.description}</p>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.7, delay: 0.1 + index * 0.08, ease: EASE }}
      className={cn(
        "group/bento relative row-span-1 flex min-h-[18rem] flex-col justify-start overflow-hidden rounded-xl border border-fd-border bg-fd-card/40 p-5 md:min-h-0",
        item.className,
      )}
    >
      {/* artifact fills the whole card; text floats over it, kept legible by a
          scrim sized to the heading rather than the full height */}
      <div className="absolute inset-0">{item.header}</div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-fd-card/85 via-fd-card/30 to-transparent" />
      <div className="relative z-10">{text}</div>
    </motion.div>
  );
}

/** Full-bleed tile: a space backdrop with a single brand mark centered on top,
 *  matching the Perses hero so every card in the grid shares one language. */
function LogoShowcase({ src, children }: { src: string; children: ReactNode }) {
  return (
    <div className="relative size-full overflow-hidden">
      <img
        src={src}
        alt=""
        aria-hidden
        loading="lazy"
        className="absolute inset-0 size-full scale-110 object-cover transition-transform duration-500 ease-out group-hover/bento:scale-100 motion-reduce:scale-100 motion-reduce:transition-none"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-fd-background/40 via-fd-background/10 to-fd-background/70" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 58% 50% at 50% 56%, rgba(0,0,0,0.5), transparent 72%)",
          }}
        />
        {children}
      </div>
    </div>
  );
}

/** Space wallpaper for the busier illustration cards, muted by a dark scrim so
 *  the foreground (tag cloud / commit feed) stays legible on top. */
function SpaceBackdrop({ src, dim }: { src: string; dim: string }) {
  return (
    <>
      <img
        src={src}
        alt=""
        aria-hidden
        loading="lazy"
        className="absolute inset-0 size-full scale-110 object-cover transition-transform duration-500 ease-out group-hover/bento:scale-100 motion-reduce:scale-100 motion-reduce:transition-none"
      />
      <div className={cn("absolute inset-0", dim)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Semantic conventions — a live cloud of shared attribute tags       */
/* ------------------------------------------------------------------ */

type Tag = {
  ns: string;
  rest: string;
  /** Example values; the chip cycles to the next one each time it reappears. */
  vals: string[];
  /** Home position in the cloud, as a percentage of the panel. */
  x: number;
  y: number;
  /** Shared correlation key — marked with a dot. */
  hub?: boolean;
  /** Kept in the static fallback (mobile / reduced motion). */
  mobile?: boolean;
};

/**
 * Standard OpenTelemetry attributes the code already emits, each with a few
 * short example values from one coherent scenario (a checkout app in prod).
 * Home positions are pre-spaced; a chip only hops to a nearby spot while it's
 * hidden, so the cloud stays legible.
 */
const TAGS: Record<string, Tag> = {
  service: {
    ns: "service",
    rest: ".name",
    vals: ["checkout", "payments", "cart-api", "web"],
    x: 52,
    y: 54,
    hub: true,
    mobile: true,
  },
  trace: {
    ns: "trace",
    rest: "_id",
    vals: ["a3f9…c1", "b1e7…4d", "6c20…9f"],
    x: 30,
    y: 38,
    hub: true,
    mobile: true,
  },
  kind: {
    ns: "span",
    rest: ".kind",
    vals: ["server", "client", "internal"],
    x: 72,
    y: 34,
    mobile: true,
  },
  route: {
    ns: "http",
    rest: ".route",
    vals: ["/cart", "/checkout", "/pay"],
    x: 22,
    y: 72,
    mobile: true,
  },
  db: {
    ns: "db",
    rest: ".system",
    vals: ["postgres", "redis", "mysql"],
    x: 56,
    y: 84,
    mobile: true,
  },
  url: {
    ns: "url",
    rest: ".path",
    vals: ["/orders", "/cart/items", "/healthz"],
    x: 82,
    y: 66,
    mobile: true,
  },
  method: {
    ns: "http",
    rest: ".request.method",
    vals: ["GET", "POST", "PUT", "DELETE"],
    x: 38,
    y: 76,
  },
  status: {
    ns: "http",
    rest: ".response.status_code",
    vals: ["200", "201", "404", "500"],
    x: 50,
    y: 90,
  },
  dbop: {
    ns: "db",
    rest: ".operation",
    vals: ["SELECT", "INSERT", "UPDATE"],
    x: 88,
    y: 80,
  },
  env: {
    ns: "deployment",
    rest: ".environment",
    vals: ["prod", "staging", "dev"],
    x: 90,
    y: 46,
  },
  peer: {
    ns: "server",
    rest: ".address",
    vals: ["10.0.1.4", "db-primary", "cache-01"],
    x: 80,
    y: 26,
  },
  msg: {
    ns: "messaging",
    rest: ".system",
    vals: ["kafka", "rabbitmq", "sqs"],
    x: 60,
    y: 24,
  },
  rpc: {
    ns: "rpc",
    rest: ".method",
    vals: ["Charge", "GetCart", "ListOrders"],
    x: 42,
    y: 22,
  },
  err: {
    ns: "error",
    rest: ".type",
    vals: ["timeout", "ECONNRESET", "5xx"],
    x: 16,
    y: 52,
  },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Candidate offsets a chip can occupy; placement picks whichever overlaps the
 *  fewest visible neighbours, so chips move around without landing on top. */
const HOPS: [number, number][] = [
  [0, 0],
  [8, -5],
  [-8, 5],
  [6, 7],
  [-6, -7],
  [11, 3],
  [-11, -3],
  [3, -9],
  [-3, 9],
];

/** Distance (panel %) within which two nodes draw a connecting thread. */
const CONNECT_DIST = 34;

type NodeRuntime = { visible: boolean; valIdx: number; posIdx: number };

// Rough chip box (estimated against the desktop tile) used only to keep tags
// from landing on top of one another. Bump SEP if they still crowd.
const CLOUD_W = 820; // active-area width, px
const CLOUD_H = 224; // active-area height (14rem), px
const CHIP_H = 26; // chip height, px
const SEP = 1.5; // extra breathing room between chips, in %

function chipExtent(t: Tag) {
  const chars = t.ns.length + t.rest.length + 1 + Math.max(...t.vals.map((v) => v.length));
  return {
    hw: ((chars * 6.6 + 26) / CLOUD_W) * 50, // half-width, % of width
    hh: (CHIP_H / CLOUD_H) * 50, // half-height, % of height
  };
}

function chipPos(t: Tag, i: number, posIdx: number) {
  const [dx, dy] = HOPS[(posIdx + i) % HOPS.length];
  return { x: clamp(t.x + dx, 6, 94), y: clamp(t.y + dy, 8, 92) };
}

function chipsOverlap(ti: Tag, i: number, pi: number, tj: Tag, j: number, pj: number) {
  const a = chipPos(ti, i, pi);
  const b = chipPos(tj, j, pj);
  const ea = chipExtent(ti);
  const eb = chipExtent(tj);
  return Math.abs(a.x - b.x) < ea.hw + eb.hw + SEP && Math.abs(a.y - b.y) < ea.hh + eb.hh + SEP;
}

/** Pick the hop (from startIdx onward) overlapping the fewest visible neighbours.
 *  `maxIndex` bounds which neighbours count, so the initial pass can place chips
 *  one at a time against the ones already settled. */
function bestPosIdx(
  ids: string[],
  k: number,
  startIdx: number,
  states: NodeRuntime[],
  maxIndex: number,
) {
  const tk = TAGS[ids[k]];
  let best = startIdx;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let h = 0; h < HOPS.length; h++) {
    const cand = startIdx + h;
    let score = 0;
    for (let m = 0; m < maxIndex; m++) {
      if (m === k || !states[m].visible) continue;
      if (chipsOverlap(tk, k, cand, TAGS[ids[m]], m, states[m].posIdx)) score++;
    }
    if (score < bestScore) {
      bestScore = score;
      best = cand;
      if (score === 0) break;
    }
  }
  return best;
}

function initialNodes(ids: string[]): NodeRuntime[] {
  const placed: NodeRuntime[] = ids.map(() => ({
    visible: true,
    valIdx: 0,
    posIdx: 0,
  }));
  for (let k = 0; k < ids.length; k++) {
    placed[k].posIdx = bestPosIdx(ids, k, 0, placed, k);
  }
  return placed;
}

function SemanticConventions() {
  const reduce = useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);
  // Run the live cloud only where there's room and motion is welcome; otherwise
  // the home layout stands in as a calm, static graph.
  const live = !reduce && !isMobile;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const ids = useMemo(() => Object.keys(TAGS), []);
  const [nodes, setNodes] = useState<NodeRuntime[]>(() => initialNodes(ids));

  // Threads only between nodes that start near each other — a sparse, local mesh.
  const pairs = useMemo(() => {
    const out: [number, number][] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = TAGS[ids[i]];
        const b = TAGS[ids[j]];
        if (Math.hypot(a.x - b.x, a.y - b.y) <= CONNECT_DIST) out.push([i, j]);
      }
    }
    return out;
  }, [ids]);

  // One chip at a time pops out, hops + cycles its value, then springs back in.
  useEffect(() => {
    if (!live) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let tick = 0;
    const advance = setInterval(() => {
      const k = tick % ids.length;
      tick += 1;
      setNodes((prev) => {
        const next = prev.slice();
        next[k] = { ...next[k], visible: false };
        return next;
      });
      const back = setTimeout(() => {
        setNodes((prev) => {
          const next = prev.slice();
          const cur = next[k];
          next[k] = {
            visible: true,
            valIdx: (cur.valIdx + 1) % TAGS[ids[k]].vals.length,
            posIdx: bestPosIdx(ids, k, cur.posIdx + 1, prev, ids.length),
          };
          return next;
        });
        timers.delete(back);
      }, 2300);
      timers.add(back);
    }, 1700);
    return () => {
      clearInterval(advance);
      for (const t of timers) clearTimeout(t);
    };
  }, [live, ids]);

  // Going static (resize / reduced motion) must never strand a hidden chip.
  useEffect(() => {
    if (live) return;
    setNodes((prev) => prev.map((n) => (n.visible ? n : { ...n, visible: true })));
  }, [live]);

  const posOf = (i: number) => chipPos(TAGS[ids[i]], i, nodes[i].posIdx);

  return (
    <div
      className="pointer-events-none relative size-full select-none overflow-hidden"
      style={{
        maskImage: "radial-gradient(108% 108% at 50% 45%, #000 60%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(108% 108% at 50% 45%, #000 60%, transparent 100%)",
      }}
    >
      <SpaceBackdrop src={space3} dim="bg-fd-background/72" />
      <div className="absolute inset-x-0 bottom-0 top-24">
        {/* threads — light up between attributes that are both present */}
        <svg
          className="absolute inset-0 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <title>Connections between shared attributes</title>
          {pairs.map(([i, j]) => {
            const a = posOf(i);
            const b = posOf(j);
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const target =
              nodes[i].visible && nodes[j].visible && d <= CONNECT_DIST
                ? (1 - d / CONNECT_DIST) * 0.45
                : 0;
            const bothMobile = TAGS[ids[i]].mobile && TAGS[ids[j]].mobile;
            return (
              <motion.line
                key={`${ids[i]}-${ids[j]}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={cn(
                  "stroke-white",
                  bothMobile ? undefined : reduce ? "hidden" : "hidden sm:block",
                )}
                strokeWidth={1}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                initial={false}
                animate={{ opacity: target }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            );
          })}
        </svg>

        {/* attribute chips — each pops in and out on its own */}
        {ids.map((id, i) => {
          const t = TAGS[id];
          const n = nodes[i];
          const p = posOf(i);
          return (
            <motion.div
              key={id}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2",
                t.mobile ? "block" : reduce ? "hidden" : "hidden sm:block",
              )}
              initial={false}
              animate={{
                opacity: n.visible ? 1 : 0,
                scale: n.visible ? 1 : 0.4,
              }}
              transition={
                n.visible
                  ? { type: "spring", stiffness: 460, damping: 17, mass: 0.8 }
                  : { duration: 0.18, ease: "easeIn" }
              }
            >
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-fd-border px-2.5 py-1 font-mono text-[11px] leading-none shadow-sm shadow-black/20",
                  t.hub ? "bg-fd-card text-fd-foreground" : "bg-fd-card/80",
                )}
              >
                {t.hub && (
                  <span className="size-1.5 shrink-0 rounded-full bg-primary/80" aria-hidden />
                )}
                <span>
                  <span className={t.hub ? "text-fd-foreground" : "text-fd-foreground/70"}>
                    {t.ns}
                  </span>
                  <span className="text-fd-muted-foreground">{t.rest}</span>
                  <span className="text-fd-muted-foreground/40">=</span>
                  <span className="text-fd-foreground/80">{t.vals[n.valIdx]}</span>
                </span>
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Perses editor — a fake editor showing a dashboard-as-code spec    */
/* ------------------------------------------------------------------ */

type YamlLine = {
  indent: number;
  list?: boolean;
  k?: string;
  v?: string;
  /** Render the value in the accent colour (Perses `kind:` discriminators). */
  kind?: boolean;
  /** A raw line of SQL (no key/value), rendered as plain text. */
  raw?: string;
};

const PERSES_LINES: YamlLine[] = [
  { indent: 0, k: "kind", v: "Dashboard", kind: true },
  { indent: 0, k: "metadata" },
  { indent: 1, k: "name", v: "overview" },
  { indent: 1, k: "project", v: "demo" },
  { indent: 0, k: "spec" },
  { indent: 1, k: "panels" },
  { indent: 2, k: "requests" },
  { indent: 3, k: "kind", v: "Panel", kind: true },
  { indent: 3, k: "spec" },
  { indent: 4, k: "display" },
  { indent: 5, k: "name", v: "Requests / sec" },
  { indent: 4, k: "plugin" },
  { indent: 5, k: "kind", v: "TimeSeriesChart", kind: true },
  { indent: 4, k: "queries" },
  { indent: 4, list: true, k: "kind", v: "ClickHouseSQL", kind: true },
  { indent: 5, k: "spec" },
  { indent: 6, k: "plugin" },
  { indent: 7, k: "kind", v: "ClickHouseSQL", kind: true },
  { indent: 7, k: "spec" },
  { indent: 8, k: "query", v: "|" },
  { indent: 9, raw: "SELECT" },
  { indent: 10, raw: "toStartOfInterval(Timestamp," },
  { indent: 11, raw: "INTERVAL {step:UInt32} SECOND) AS ts," },
  { indent: 10, raw: "count() AS value" },
  { indent: 9, raw: "FROM traces" },
  { indent: 9, raw: "WHERE Timestamp >= {from:String}" },
  { indent: 10, raw: "AND Timestamp <= {to:String}" },
  { indent: 9, raw: "GROUP BY ts" },
  { indent: 9, raw: "ORDER BY ts" },
  { indent: 1, k: "layouts" },
  { indent: 1, list: true, k: "kind", v: "Grid", kind: true },
  { indent: 2, k: "spec" },
  { indent: 3, k: "items" },
  { indent: 3, list: true, k: "width", v: "24" },
  { indent: 4, k: "height", v: "8" },
  { indent: 4, k: "content" },
  { indent: 5, k: "$ref", v: '"#/spec/panels/requests"' },
];

function PersesEditor() {
  return (
    <div className="overflow-hidden rounded-t-lg border border-fd-border bg-fd-background shadow-2xl shadow-black/40">
      <WindowChrome title="overview.dashboard.yaml" className="bg-fd-card/60" />
      {/* the spec */}
      <div className="px-3 py-3 font-mono text-[12.5px] leading-relaxed">
        {PERSES_LINES.map((line, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- PERSES_LINES is a static const array that never reorders and has no unique field (keys can repeat)
          <div key={i} className="flex">
            <span className="w-7 shrink-0 select-none pr-3 text-right text-fd-muted-foreground/25">
              {i + 1}
            </span>
            <span className="min-w-0" style={{ paddingLeft: `${line.indent * 0.7}rem` }}>
              {line.raw ? (
                <span className="text-fd-foreground/75">{line.raw}</span>
              ) : (
                <>
                  {line.list && <span className="text-fd-muted-foreground/40">- </span>}
                  <span className="text-fd-muted-foreground">{line.k}</span>
                  {line.v ? (
                    <>
                      <span className="text-fd-muted-foreground/70">: </span>
                      <span className={line.kind ? "text-primary" : "text-fd-foreground/75"}>
                        {line.v}
                      </span>
                    </>
                  ) : (
                    <span className="text-fd-muted-foreground/70">:</span>
                  )}
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Full-bleed Perses artifact: nebula wallpaper, the spec editor, big logo. */
function PersesShowcase() {
  return (
    <div className="relative size-full overflow-hidden">
      <img
        src={space4}
        alt=""
        aria-hidden
        className="absolute inset-0 size-full scale-110 object-cover transition-transform duration-500 ease-out group-hover/bento:scale-100 motion-reduce:scale-100 motion-reduce:transition-none"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-fd-background/20 via-transparent to-fd-background/80" />
      {/* the dashboard-as-code editor, bleeding off the bottom + right */}
      <div className="pointer-events-none absolute left-5 right-[-1.25rem] top-32">
        <PersesEditor />
      </div>
      {/* big Perses logo, centered on top */}
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 50% 52%, rgba(0,0,0,0.45), transparent 72%)",
          }}
        />
        <img
          src={persesLogo}
          alt="Perses"
          className="relative h-24 w-auto drop-shadow-2xl sm:h-32"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  As code — a live commit feed of dashboards, alerts & runbooks      */
/* ------------------------------------------------------------------ */

/** A real teammate — avatar pulled live from their GitHub profile, initials as
 *  the fallback while it loads (and for SSR). */
type Human = {
  login: string;
  name: string;
  initials: string;
  tone: string;
};
/** A coding agent — its brand mark sits in the avatar. */
type Agent = { name: string; mark: string };

type Author =
  | { kind: "agent"; agent: Agent }
  | { kind: "human"; human: Human }
  | { kind: "pair"; human: Human; agent: Agent };

// Muted, cool fallback tones for the initials, distinct from one another.
const ELFO: Human = {
  login: "Elfo404",
  name: "Gio",
  initials: "GR",
  tone: "bg-sky-500/20 text-sky-200",
};
const GDORSI: Human = {
  login: "gdorsi",
  name: "Guido",
  initials: "GD",
  tone: "bg-violet-500/20 text-violet-200",
};

const CLAUDE: Agent = { name: "Claude", mark: claudeMark };
const CODEX: Agent = { name: "Codex", mark: codexMark };
const PI: Agent = { name: "Pi", mark: piMark };
const OPENCODE: Agent = { name: "opencode", mark: opencodeMark };
const KNOTIC: Agent = { name: "Knotic", mark: knoticMark };

type Commit = { hash: string; msg: string; file: string; author: Author };

/**
 * A plausible history of the as-code artifacts: dashboards, alerts, and
 * runbooks, edited by a mix of people, agents, and the two together. The
 * messages lean on the narrative — files that adapt with the codebase
 * (renames, post-incident tuning) and travel between projects.
 */
const COMMITS: Commit[] = [
  {
    hash: "3f9a2c1",
    msg: "Add p99 latency panel to checkout",
    file: "overview.dashboard.yaml",
    author: { kind: "agent", agent: CLAUDE },
  },
  {
    hash: "b7e10d4",
    msg: "Lower checkout error-rate alert to 2%",
    file: "checkout-errors.alert.yaml",
    author: { kind: "pair", human: ELFO, agent: CLAUDE },
  },
  {
    hash: "5c81a9f",
    msg: "Write payments-timeout runbook",
    file: "payments-timeout.runbook.md",
    author: { kind: "human", human: ELFO },
  },
  {
    hash: "a204e6b",
    msg: "Rename cart-api panels after refactor",
    file: "cart-api.dashboard.yaml",
    author: { kind: "agent", agent: CODEX },
  },
  {
    hash: "6d4e8b2",
    msg: "Add SLO burn-rate alert for payments",
    file: "payments-slo.alert.yaml",
    author: { kind: "agent", agent: KNOTIC },
  },
  {
    hash: "e96f3d2",
    msg: "Add Postgres saturation row",
    file: "postgres.dashboard.yaml",
    author: { kind: "human", human: GDORSI },
  },
  {
    hash: "1d7b8c0",
    msg: "Tune latency alert after incident 482",
    file: "latency.alert.yaml",
    author: { kind: "pair", human: GDORSI, agent: CODEX },
  },
  {
    hash: "c40a17e",
    msg: "Link runbooks from alert annotations",
    file: "payments.alert.yaml",
    author: { kind: "agent", agent: OPENCODE },
  },
  {
    hash: "8b3e5a9",
    msg: "Port dashboards to staging project",
    file: "staging/overview.dashboard.yaml",
    author: { kind: "agent", agent: PI },
  },
];

function AgentAvatar({ agent }: { agent: Agent }) {
  return (
    <Avatar size="sm">
      <AvatarFallback className="bg-fd-card p-1">
        <img src={agent.mark} alt="" aria-hidden className="size-full object-contain" />
      </AvatarFallback>
    </Avatar>
  );
}

function HumanAvatar({ human }: { human: Human }) {
  return (
    <Avatar size="sm">
      <AvatarImage src={`https://github.com/${human.login}.png?size=48`} alt={human.name} />
      <AvatarFallback className={cn("font-heading text-[10px] font-bold", human.tone)}>
        {human.initials}
      </AvatarFallback>
    </Avatar>
  );
}

/** Avatar(s) for a commit — a pair stacks the human and agent to read as
 *  "edited together", the whole point of an open, inspectable format. */
function CommitAvatar({ author }: { author: Author }) {
  if (author.kind === "agent") return <AgentAvatar agent={author.agent} />;
  if (author.kind === "human") return <HumanAvatar human={author.human} />;
  return (
    <AvatarGroup>
      <HumanAvatar human={author.human} />
      <AgentAvatar agent={author.agent} />
    </AvatarGroup>
  );
}

function authorLabel(author: Author) {
  if (author.kind === "agent") return author.agent.name;
  if (author.kind === "human") return author.human.name;
  return `${author.agent.name} + ${author.human.name}`;
}

const FEED_VISIBLE = 4;
const FEED_INTERVAL = 2600;

/** Full-bleed commit feed: a fixed window of commits that rises one row at a
 *  time, newest entering at the bottom, oldest leaving under the heading. */
function AsCodeFeed() {
  const reduce = useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);
  // The feed advances only where there's room and motion is welcome; otherwise
  // the opening window stands in as a calm, static history.
  const live = !reduce && !isMobile;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Each row carries a monotonic seq so React keeps identity stable as the
  // window slides and the underlying commit pool loops.
  const [rows, setRows] = useState(() =>
    Array.from({ length: FEED_VISIBLE }, (_, i) => ({ seq: i, idx: i })),
  );

  useEffect(() => {
    if (!live) return;
    let seq = FEED_VISIBLE;
    let idx = FEED_VISIBLE % COMMITS.length;
    const id = setInterval(() => {
      const entry = { seq, idx };
      setRows((prev) => [...prev.slice(1), entry]);
      seq += 1;
      idx = (idx + 1) % COMMITS.length;
    }, FEED_INTERVAL);
    return () => clearInterval(id);
  }, [live]);

  return (
    <div className="pointer-events-none relative size-full select-none overflow-hidden">
      <SpaceBackdrop src={space11} dim="bg-fd-background/78" />
      <div className="absolute inset-x-0 bottom-0 top-24 px-5">
        <div className="flex h-full flex-col justify-center gap-2.5">
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((row) => {
              const c = COMMITS[row.idx];
              return (
                <motion.div
                  key={row.seq}
                  layout
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{
                    type: "spring",
                    stiffness: 520,
                    damping: 40,
                    mass: 0.9,
                  }}
                  className="flex items-center gap-3 rounded-lg border border-fd-border bg-fd-card px-3 py-2.5 shadow-sm shadow-black/20"
                >
                  <CommitAvatar author={c.author} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium leading-tight text-fd-foreground">
                      {c.msg}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-[10.5px] leading-none">
                      <span className="shrink-0 text-fd-foreground/65">
                        {authorLabel(c.author)}
                      </span>
                      <span className="text-fd-muted-foreground/35">·</span>
                      <span className="truncate text-fd-muted-foreground/80">{c.file}</span>
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[10.5px] text-fd-muted-foreground/45">
                    {c.hash}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Content                                                           */
/* ------------------------------------------------------------------ */

const ITEMS: Item[] = [
  {
    title: "Standard OpenTelemetry",
    description:
      "Traces, logs and metrics in one open model — the same signal from your laptop to CI to production.",
    header: (
      <LogoShowcase src={space6}>
        <img
          src={otelLogo}
          alt="OpenTelemetry"
          loading="lazy"
          className="relative h-16 w-auto drop-shadow-2xl sm:h-20"
        />
      </LogoShowcase>
    ),
    icon: Network,
    className: "md:col-span-3",
  },
  {
    title: "Perses dashboards",
    description: "The open CNCF dashboard spec, versioned as plain files — not locked in a UI.",
    header: <PersesShowcase />,
    icon: LineChart,
    className: "md:col-span-9 md:row-span-2",
  },
  {
    title: "Query with SQL",
    description:
      "One read-only SQL surface over every signal — no query language to learn, the same locally and in the cloud.",
    header: (
      <LogoShowcase src={space9}>
        <SiClickhouse className="relative size-16 drop-shadow-2xl sm:size-20" color="default" />
      </LogoShowcase>
    ),
    icon: Terminal,
    className: "md:col-span-3",
  },
  {
    title: "Semantic conventions",
    description:
      "Everr reads the OpenTelemetry attributes your code already emits, so traces, logs, and metrics correlate on their own.",
    header: <SemanticConventions />,
    icon: Tags,
    className: "md:col-span-6",
  },
  {
    title: "Dashboards, alerts & runbooks as code",
    description:
      "Open, inspectable files in Git — people and agents edit them side by side, reviewed and versioned like the rest of your code.",
    header: <AsCodeFeed />,
    icon: GitCommitVertical,
    className: "md:col-span-6",
  },
];
