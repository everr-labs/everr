import { cn } from "@everr/ui/lib/utils";
import { motion, useInView } from "motion/react";
import { type ReactNode, useRef } from "react";
import agentsBackdrop from "../assets/agents-backdrop.webp?url";
import asCodeBackdrop from "../assets/as-code-backdrop.webp?url";
import ciBackdrop from "../assets/ci-backdrop.webp?url";
import cliBackdrop from "../assets/cli-backdrop.webp?url";
import dashboardShot from "../assets/dashboard.webp?url";
import desktopApp from "../assets/desktop-app.webp?url";
import errorShot from "../assets/error.webp?url";
import runbookShot from "../assets/runbook.webp?url";
import telemetryBackdrop from "../assets/telemetry-backdrop.webp?url";
import traceShot from "../assets/trace.webp?url";
import { Code } from "./ui/code";
import { WindowChrome } from "./ui/window-chrome";

type Feature = {
  index: string;
  title: string;
  body: ReactNode;
  points: string[];
  /** The illustration shown beside this row's copy. */
  visual: ReactNode;
};

const FEATURES: Feature[] = [
  {
    index: "01",
    title: "Logs, traces, metrics, and errors. All OpenTelemetry.",
    body: "Every signal is standard OpenTelemetry, so one model covers your laptop, CI, and production.",
    points: [
      "Dashboards, Alerts, Error tracking; All you expect from a modern observability platform.",
      "Runbooks for incident response, automated remediation, and root cause analysis",
      "Correlation all the way from logs to traces to metrics",
    ],
    visual: (
      <Backdrop src={telemetryBackdrop}>
        <TelemetryShot />
      </Backdrop>
    ),
  },
  {
    index: "02",
    title: "Plain SQL from the CLI, local or cloud",
    body: (
      <>
        Read what actually ran without learning a query language. Run{" "}
        <Code>everr local query</Code> against your own machine or{" "}
        <Code>everr cloud query</Code> against the shared workspace, the same
        SQL and the same tables whether the data is on your laptop or in
        production.
      </>
    ),
    points: [
      "Plain SQL over ClickHouse, local and cloud",
      "The same query your coding agent runs",
    ],
    visual: (
      <Backdrop src={cliBackdrop}>
        <QueryShot />
      </Backdrop>
    ),
  },
  {
    index: "03",
    title: "Your telemetry right where the work happens",
    body: "A desktop companion app runs a local OpenTelemetry collector and allows you to explore, query, and verify your telemetry locally, without the need for tedious deployment loops.",
    points: [
      "Runs an embedded OpenTelemetry collector on launch, no cloud account needed",
      "Available for macOS and Linux",
    ],
    visual: (
      <img
        src={desktopApp}
        alt="The Everr desktop app exploring local telemetry"
        loading="lazy"
        className="w-full rounded-xl border border-fd-border shadow-2xl shadow-black/30"
      />
    ),
  },
  {
    index: "04",
    title: "Dashboards, alerts, and runbooks as code",
    body: (
      <>
        Define your dashboards, alerts, and runbooks as files in your repo, so
        you and your coding agent know where to look before you even open Everr.
        The config doubles as documentation &mdash; and as memory your agent
        reads to find what matters.
      </>
    ),
    points: [
      "Perses-format dashboards and query-driven alerts",
      "Runbooks are Markdown, living next to the alert they belong to, so configuration becomes your knowledge base",
    ],
    visual: (
      <Backdrop src={asCodeBackdrop}>
        <RunbookShot />
      </Backdrop>
    ),
  },
  {
    index: "05",
    title: "CI you can query",
    body: "A GitHub App turns every Actions run into structured, queryable data: workflows, jobs, steps, and per-test spans. Every run is a trace and every job carries its cost, so you can optimize for performance, cost, or both.",
    points: [
      "Workflows, jobs, and steps as queryable traces",
      "Per-test spans for slow and flaky tests",
      "Estimated cost attributed by job, workflow, and runner",
      "Get notified when a workflow run fails",
    ],
    visual: (
      <Backdrop src={ciBackdrop}>
        <CiShot />
      </Backdrop>
    ),
  },
  {
    index: "06",
    title: "Built for coding assistants",
    body: "Everr is built for your coding assistant as much as for you. Bundled skills teach it when to reach for telemetry and how to query it, working from your repo so it ties a failing trace or log back to the code that caused it.",
    points: [
      "Crafted skills to help your assistant work with telemetry",
      "One install, available in every assistant you use",
      "Fixes grounded in real traces and logs, not guesses",
    ],
    visual: (
      <Backdrop src={agentsBackdrop}>
        <SkillPreview />
      </Backdrop>
    ),
  },
];

const EASE = [0.22, 1, 0.36, 1] as const;

export function FeaturesZigzag() {
  const headRef = useRef<HTMLDivElement>(null);
  const headInView = useInView(headRef, { once: true, margin: "-15% 0px" });

  return (
    <section className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background">
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        <motion.div
          ref={headRef}
          initial={{ opacity: 0, y: 24 }}
          animate={headInView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Capabilities
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            See what your code actually does.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Everything you need to go from a fast local feedback loop to
            production observability &mdash; one OpenTelemetry pipeline, end to
            end.
          </p>
        </motion.div>

        <div className="mt-20 flex flex-col gap-24 md:mt-32 md:gap-36">
          {FEATURES.map((feature, i) => (
            <FeatureRow
              key={feature.index}
              feature={feature}
              flip={i % 2 === 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureRow({ feature, flip }: { feature: Feature; flip: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });

  // Slide direction matches the side the text sits on: default rows have text
  // on the left (slide in from left → x:-32); flipped rows have text on the
  // right (slide in from right → x:32). The visual mirrors the opposite side.
  const textFrom = flip ? 32 : -32;
  const visualFrom = flip ? -32 : 32;

  return (
    <div
      ref={ref}
      className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16 lg:gap-20"
    >
      {/* TEXT — order-1 on mobile (reading order), positioned by flip on desktop */}
      <motion.div
        initial={{ opacity: 0, y: 24, x: textFrom }}
        animate={inView ? { opacity: 1, y: 0, x: 0 } : undefined}
        transition={{ duration: 0.8, ease: EASE }}
        className={cn(
          "order-1",
          flip ? "md:order-2 md:col-start-2" : "md:order-1 md:col-start-1",
        )}
      >
        <div className="flex items-baseline gap-4">
          <span className="font-heading text-5xl font-bold leading-none tracking-tight text-fd-muted-foreground/15 tabular-nums sm:text-6xl md:text-7xl">
            {feature.index}
          </span>
        </div>

        <h3 className="mt-6 text-balance font-heading text-2xl leading-[1.15] tracking-tight text-fd-foreground sm:text-3xl md:text-4xl">
          {feature.title}
        </h3>

        <p className="mt-5 max-w-md text-base leading-relaxed text-fd-muted-foreground">
          {feature.body}
        </p>

        <ul className="mt-7 flex flex-col gap-3">
          {feature.points.map((point) => (
            <li
              key={point}
              className="flex items-center gap-3 text-sm text-fd-muted-foreground"
            >
              <span
                className="size-1.5 shrink-0 rounded-full bg-primary"
                aria-hidden
              />
              <span className="font-heading tracking-tight text-fd-foreground/90">
                {point}
              </span>
            </li>
          ))}
        </ul>
      </motion.div>

      {/* VISUAL — order-2 on mobile (after text), positioned by flip on desktop */}
      <motion.div
        initial={{ opacity: 0, y: 24, x: visualFrom }}
        animate={inView ? { opacity: 1, y: 0, x: 0 } : undefined}
        transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
        className={cn(
          "order-2",
          flip ? "md:order-1 md:col-start-1" : "md:order-2 md:col-start-2",
        )}
      >
        {feature.visual}
      </motion.div>
    </div>
  );
}

function Backdrop({ src, children }: { src: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl">
      <img
        src={src}
        alt=""
        aria-hidden
        loading="lazy"
        className="absolute inset-0 size-full object-cover object-center"
      />
      <div className="relative pb-9 px-9 pt-4">{children}</div>
    </div>
  );
}

/** Three product screenshots cascaded as overlapping windows: an error detail
 *  (back), a metrics dashboard (middle), and a trace waterfall (front). One
 *  illustration covering the OpenTelemetry signals this section names. */
function TelemetryShot() {
  return (
    <div className="relative aspect-3/2">
      <img
        src={errorShot}
        alt="An uncaught exception grouped into an issue and linked to its trace"
        loading="lazy"
        className="absolute left-0 top-0 w-[75%] rounded-xl border border-fd-border shadow-xl shadow-black/40"
      />
      <img
        src={traceShot}
        alt="A request rendered as a trace waterfall of spans"
        loading="lazy"
        className="absolute -right-16 -bottom-24 w-[75%] rounded-xl border border-fd-border shadow-2xl shadow-black/60"
      />
      <img
        src={dashboardShot}
        alt="A metrics dashboard built from OpenTelemetry data"
        loading="lazy"
        className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 w-[75%] rounded-xl border border-fd-border shadow-2xl shadow-black/50"
      />
    </div>
  );
}

/** A faux terminal session for the CLI card: an `everr cloud query` and the
 *  ClickHouse Pretty table it prints back, so the SQL story shows, not tells.
 *  The result frame is generated so the columns can't drift out of alignment. */
function QueryShot() {
  const kw = "text-primary";
  const fg = "text-fd-foreground/90";

  const cols = [
    { name: "service", w: 8, align: "l" as const },
    { name: "p50", w: 3, align: "r" as const },
    { name: "p95", w: 3, align: "r" as const },
  ];
  const data = [
    ["payments", "120", "610"],
    ["checkout", "84", "470"],
    ["search", "22", "90"],
    ["auth", "9", "38"],
  ];
  const cell = (s: string, c: (typeof cols)[number]) =>
    c.align === "l" ? s.padEnd(c.w) : s.padStart(c.w);
  const top = `┌${cols
    .map((c) => `─${c.name}${"─".repeat(c.w + 1 - c.name.length)}`)
    .join("┬")}┐`;
  const bottom = `└${cols.map((c) => "─".repeat(c.w + 2)).join("┴")}┘`;
  const rows = data.map(
    (r) => `│ ${cols.map((c, i) => cell(r[i], c)).join(" │ ")} │`,
  );
  const table = [top, ...rows, bottom].join("\n");

  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl shadow-black/50">
      <WindowChrome size="sm" title="~/checkout-service · zsh" />
      <div className="overflow-x-auto px-4 py-3.5 font-mono text-[10px] leading-[1.75] sm:text-[11px]">
        <pre className="whitespace-pre text-fd-muted-foreground">
          <span className={kw}>$</span>{" "}
          <span className={fg}>everr cloud query</span>
          {' "\n'}
          {"  "}
          <span className={kw}>SELECT</span>
          {"\n    service,\n    "}
          <span className={kw}>round</span>(<span className={kw}>quantile</span>
          (0.5)(value)){"  "}
          <span className={kw}>AS</span> p50,
          {"\n    "}
          <span className={kw}>round</span>(<span className={kw}>quantile</span>
          (0.95)(value)) <span className={kw}>AS</span> p95
          {"\n  "}
          <span className={kw}>FROM</span> metrics
          {"\n  "}
          <span className={kw}>WHERE</span> name ={" "}
          <span className={fg}>'http.server.duration'</span>
          {"\n  "}
          <span className={kw}>GROUP BY</span> service
          {"\n  "}
          <span className={kw}>ORDER BY</span> p95{" "}
          <span className={kw}>DESC</span>
          {'"\n\n'}
          {table}
          {"\n\n"}
          <span className={kw}>$</span> <span className={kw}>▋</span>
        </pre>
      </div>
    </div>
  );
}

/** Runbook card for the as-code section: the Runbook YAML spec flows from the
 *  top-left and the same runbook rendered in the app fills the top-right, over
 *  the source along the diagonal. One artifact, shown as code and live. */
function RunbookShot() {
  const cKey = "text-fd-foreground/80";
  const cVal = "text-fd-muted-foreground";
  const cStr = "text-primary";
  const cPunct = "text-fd-muted-foreground/40";

  const yaml = `kind: Runbook
metadata:
  name: infra-health
  project: default
spec:
  display:
    name: "Infrastructure & Internal Collector Health"
    description: "Triage runbook for the internal kubelet-stats collector."
  duration: 1h
  refreshInterval: 30s
  panels:
    freshness:
      kind: Panel
      spec:
        display: { name: Metrics lag (seconds since last datapoint) }
        plugin:
          kind: StatChart
          spec:
            calculation: last
            unit: "s"
            colorMode: background
            thresholds:
              defaultColor: "#22c55e"
              steps:
                - { value: 120, color: "#f59e0b" }
                - { value: 300, color: "#ef4444" }
        queries:
          - kind: ClickHouseSQL
            spec:
              plugin:
                kind: ClickHouseSQL
                spec:
                  query: |
                    SELECT dateDiff('second', max(TimeUnix), now()) AS lag_seconds
                    FROM metrics_gauge
                    WHERE TimeUnix >= {from:String} AND TimeUnix <= {to:String}
                      AND MetricName = 'k8s.node.cpu.usage'`;

  const lines = yaml.split("\n").map((text, i) => ({ id: `y${i}`, text }));

  // Lightweight YAML highlight: brighten the key, dim the colon, and tint
  // quoted/hex values. Non key-value lines (SQL, list maps) stay muted.
  const render = (text: string): ReactNode => {
    const m = text.match(/^(\s*(?:- )?)([A-Za-z0-9_.-]+)(:)(.*)$/);
    if (!m) {
      return <span className={cVal}>{text || "\u00A0"}</span>;
    }
    const [, indent, key, colon, rest] = m;
    const valClass = /^\s*["'#]/.test(rest) ? cStr : cVal;
    return (
      <>
        {indent}
        <span className={cKey}>{key}</span>
        <span className={cPunct}>{colon}</span>
        {rest ? <span className={valClass}>{rest}</span> : null}
      </>
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl shadow-black/30">
      <WindowChrome size="sm" title="runbooks/infra-health.yaml" />
      <div className="relative aspect-[4/3]">
        {/* YAML source, flowing from the top */}
        <div className="absolute inset-0 overflow-hidden p-5 font-mono text-[10px] leading-[1.6] sm:text-[11px]">
          {lines.map((line) => (
            <div key={line.id} className="whitespace-pre">
              {render(line.text)}
            </div>
          ))}
        </div>
        {/* The rendered runbook, over the source, filling the top-right triangle */}
        <img
          src={runbookShot}
          alt="The runbook rendered from the spec"
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
          style={{
            clipPath: "polygon(0 0, 100% 0, 100% 100%)",
            // First shadow is a 0-blur border that hugs the diagonal edge; the
            // second lifts the window off the backdrop.
            filter:
              "drop-shadow(-1px 1px 0 var(--color-fd-border)) drop-shadow(-5px 5px 6px rgba(0, 0, 0, 0.45))",
          }}
        />
      </div>
    </div>
  );
}

/** Two staggered windows for the CI card: one run rendered as a trace waterfall
 *  (back) and a flaky-test history panel (front). The `test` span ties them
 *  together, mirroring what the GitHub App ingests, runs and per-test spans. */
function CiShot() {
  const spans = [
    {
      name: "build",
      depth: 0,
      start: 0,
      width: 50,
      dur: "2m04",
      accent: false,
    },
    {
      name: "checkout",
      depth: 1,
      start: 0,
      width: 6,
      dur: "14s",
      accent: false,
    },
    {
      name: "install",
      depth: 1,
      start: 6,
      width: 20,
      dur: "48s",
      accent: false,
    },
    { name: "test", depth: 1, start: 26, width: 24, dur: "1m02", accent: true },
    { name: "lint", depth: 0, start: 0, width: 16, dur: "38s", accent: false },
    {
      name: "deploy",
      depth: 0,
      start: 74,
      width: 26,
      dur: "1m00",
      accent: false,
    },
  ];

  const runs = [
    { name: "auth.login", passes: [1, 1, 0, 1, 1, 0, 1, 1], flakes: 2 },
    { name: "pool.acquire", passes: [1, 1, 1, 0, 1, 1, 1, 1], flakes: 1 },
    { name: "cart.checkout", passes: [1, 1, 1, 1, 1, 1, 1, 1], flakes: 0 },
    { name: "upload.large", passes: [1, 0, 1, 0, 1, 1, 0, 1], flakes: 3 },
  ].map((t) => ({
    ...t,
    cells: t.passes.map((p, i) => ({ id: `${t.name}-${i}`, pass: p === 1 })),
  }));

  return (
    <div className="relative pb-24">
      {/* Back window: one run as a trace waterfall */}
      <div className="w-[88%] overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-xl shadow-black/20">
        <WindowChrome size="sm" title="ci.yml · run #1842" trailing="4m 18s" />
        <div className="space-y-1.5 px-3 py-3">
          {spans.map((s) => (
            <div
              key={s.name}
              className="flex items-center gap-2 font-mono text-[10px] sm:text-[11px]"
            >
              <span
                className={cn(
                  "w-14 shrink-0 truncate text-fd-muted-foreground",
                  s.depth === 1 && "pl-2 text-fd-muted-foreground/70",
                )}
              >
                {s.name}
              </span>
              <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-fd-muted-foreground/10">
                <span
                  className={cn(
                    "absolute inset-y-0 rounded-full",
                    s.accent ? "bg-primary/80" : "bg-fd-muted-foreground/40",
                  )}
                  style={{ left: `${s.start}%`, width: `${s.width}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right tabular-nums text-fd-muted-foreground/55">
                {s.dur}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Front window: flaky-test history, staggered down and to the right */}
      <div className="absolute bottom-0 right-0 w-[74%] overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl shadow-black/40">
        <WindowChrome size="sm" title="flaky tests · 30d" />
        <div className="space-y-2 px-3 py-3">
          {runs.map((t) => (
            <div
              key={t.name}
              className="flex items-center gap-2 font-mono text-[10px] sm:text-[11px]"
            >
              <span className="w-[4.5rem] shrink-0 truncate text-fd-muted-foreground">
                {t.name}
              </span>
              <span className="flex flex-1 gap-0.5">
                {t.cells.map((c) => (
                  <span
                    key={c.id}
                    className={cn(
                      "h-2.5 flex-1 rounded-[1px]",
                      c.pass ? "bg-fd-muted-foreground/20" : "bg-primary",
                    )}
                  />
                ))}
              </span>
              <span className="w-12 shrink-0 text-right tabular-nums">
                {t.flakes > 0 ? (
                  <span className="text-fd-foreground">{t.flakes} flaky</span>
                ) : (
                  <span className="text-fd-muted-foreground/50">stable</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A faux editor window previewing a bundled skill as Markdown source. The
 *  content mirrors crates/everr-core/assets/skills/everr-use-telemetry/SKILL.md
 *  so the preview stays honest about what a skill looks like. */
function SkillPreview() {
  const cPunct = "text-fd-muted-foreground/40";
  const cKey = "text-fd-foreground/70";
  const cVal = "text-fd-muted-foreground";
  const cHead = "font-semibold text-fd-foreground";
  const cCmd = "text-primary";
  const tick = <span className={cPunct}>{"`"}</span>;

  const lines: { id: string; content: ReactNode }[] = [
    { id: "fm-open", content: <span className={cPunct}>---</span> },
    {
      id: "name",
      content: (
        <>
          <span className={cKey}>name:</span>{" "}
          <span className={cVal}>everr-use-telemetry</span>
        </>
      ),
    },
    {
      id: "desc",
      content: (
        <>
          <span className={cKey}>description:</span>{" "}
          <span className={cVal}>
            Use when investigating logs, traces, metrics, errors.
          </span>
        </>
      ),
    },
    { id: "fm-close", content: <span className={cPunct}>---</span> },
    { id: "gap-1", content: " " },
    {
      id: "h1",
      content: (
        <>
          <span className={cPunct}># </span>
          <span className={cHead}>Use Telemetry With Everr</span>
        </>
      ),
    },
    {
      id: "p1",
      content: (
        <span className={cVal}>
          Use Everr telemetry before guessing at runtime behavior.
        </span>
      ),
    },
    { id: "gap-3", content: " " },
    {
      id: "h2",
      content: (
        <>
          <span className={cPunct}>## </span>
          <span className={cHead}>Only Raw SQL</span>
        </>
      ),
    },
    {
      id: "p3",
      content: <span className={cVal}>The only query command is raw SQL:</span>,
    },
    {
      id: "cmd-cloud",
      content: (
        <>
          {tick}
          <span className={cCmd}>{'everr cloud query "<SQL>"'}</span>
          {tick}
          <span className={cVal}> or</span>
        </>
      ),
    },
    {
      id: "cmd-local",
      content: (
        <>
          {tick}
          <span className={cCmd}>{'everr local query "<SQL>"'}</span>
          {tick}
          <span className={cVal}>.</span>
        </>
      ),
    },
    { id: "gap-5", content: " " },
    {
      id: "h3",
      content: (
        <>
          <span className={cPunct}>## </span>
          <span className={cHead}>Choose The Source</span>
        </>
      ),
    },
    {
      id: "tbl-1",
      content: <span className={cVal}>| Question | Use |</span>,
    },
    {
      id: "tbl-2",
      content: (
        <span className={cVal}>| Production, customer reports | cloud |</span>
      ),
    },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl shadow-black/30">
      <WindowChrome title="everr-use-telemetry / SKILL.md" />

      {/* Editor body: line-number gutter + Markdown source. The bottom lines
          fade out to hint the file continues past the preview. */}
      <div
        className="overflow-hidden py-4 font-mono text-[11px] leading-[1.7] sm:text-xs"
        style={{
          maskImage:
            "linear-gradient(to bottom, black calc(100% - 64px), transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black calc(100% - 64px), transparent)",
        }}
      >
        {lines.map((line, i) => (
          <div key={line.id} className="flex">
            <span className="w-10 shrink-0 select-none border-r border-fd-border/60 pr-3 text-right text-fd-muted-foreground/25">
              {i + 1}
            </span>
            <span className="overflow-hidden whitespace-pre pl-4 pr-6">
              {line.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
