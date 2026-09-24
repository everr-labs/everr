import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
import { cn } from "@everr/ui/lib/utils";
import {
  Activity,
  ChartNoAxesCombined,
  ChevronDown,
  Fingerprint,
  Workflow,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
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
    body: "A GitHub App turns every Actions run into structured, queryable data: workflows, jobs, and steps. Every run is a trace and every job carries its cost, so you can optimize for performance, cost, or both.",
    points: [
      "Workflows, jobs, and steps as queryable traces",
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

const demoClassName =
  "min-h-[388px] overflow-hidden bg-card max-[1100px]:min-h-[430px] max-[700px]:min-h-[425px]";
const demoBarClassName =
  "flex flex-wrap justify-between gap-2 border-b border-[var(--color-fd-border)] px-7 py-4 text-xs text-muted-foreground max-[700px]:p-4";
const demoBodyClassName = "px-7 py-6 max-[700px]:p-4";
const requestClassName =
  "flex flex-wrap items-center justify-between gap-3 text-sm";
const traceRowClassName =
  "grid grid-cols-[130px_minmax(0,1fr)_82px] items-center gap-5 p-3 font-mono text-[0.8125rem] max-[700px]:grid-cols-[88px_minmax(0,1fr)_52px] max-[700px]:gap-2 max-[700px]:px-0 max-[700px]:text-xs";

const examples = [
  {
    id: "performance",
    label: "How your application performs",
    icon: Workflow,
    view: TraceExample,
    description:
      "A successful request can still be too slow. Follow its trace to see where time goes, from application code to database queries and external services.",
  },
  {
    id: "traffic",
    label: "How it handles traffic spikes",
    icon: ChartNoAxesCombined,
    view: TrafficExample,
    description:
      "More traffic is only part of the picture. Read request volume alongside response times and error rates to see how your application behaves under load.",
  },
  {
    id: "failures",
    label: "Why requests fail",
    icon: Fingerprint,
    view: ErrorExample,
    description:
      "An error message is a starting point. Read the stack trace and related logs in the context of the failed request to understand what happened and where to investigate.",
  },
];

function TraceExample() {
  return (
    <div className={demoClassName}>
      <div className={demoBarClassName}>
        <span className="text-foreground">Trace detail</span>
        <span>Illustrative example</span>
      </div>
      <div className={demoBodyClassName}>
        <div className={requestClassName}>
          <div>
            <span className="mr-2 text-[#32c8cc]">GET</span>{" "}
            <code>/projects</code>
          </div>
          <span className="text-muted-foreground">
            200 OK <strong className="ml-3 text-foreground">2.10 s</strong>
          </span>
        </div>
        <div className="mt-7 mb-[22px]">
          <div
            className={cn(
              traceRowClassName,
              "pt-0 text-xs text-muted-foreground",
            )}
          >
            <span>Operation</span>
            <div className="flex justify-between">
              <span>0 s</span>
              <span className="max-[700px]:hidden">1 s</span>
              <span>2.1 s</span>
            </div>
            <span className="text-right">Duration</span>
          </div>
          {[
            { label: "Request", duration: "2.10 s", start: 0, width: 100 },
            { label: "Authenticate", duration: "20 ms", start: 0, width: 0.95 },
            {
              label: "Database",
              duration: "2.04 s",
              start: 0.95,
              width: 97.14,
            },
            { label: "Response", duration: "40 ms", start: 98.09, width: 1.91 },
          ].map((row) => (
            <div
              className={cn(
                traceRowClassName,
                row.label === "Database" &&
                  "rounded-md bg-[color-mix(in_srgb,#32c8cc_7%,transparent)]",
              )}
              key={row.label}
            >
              <span>{row.label}</span>
              <div className="h-2.5 bg-[var(--color-fd-border)]">
                <span
                  className="block h-full rounded-sm bg-[#32c8cc]"
                  style={{
                    marginLeft: `${row.start}%`,
                    width: `${row.width}%`,
                  }}
                />
              </div>
              <span className="text-right">{row.duration}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2.5 text-[0.8125rem] text-[#32c8cc] max-[700px]:items-start">
          <Activity className="shrink-0" size={16} aria-hidden="true" /> The
          database accounts for 97% of request time.
        </div>
      </div>
    </div>
  );
}

function TrafficExample() {
  const chartTitle = useId();
  return (
    <div className={demoClassName}>
      <div className={demoBarClassName}>
        <span className="text-foreground">Traffic overview</span>
        <span>Illustrative example</span>
      </div>
      <div className={demoBodyClassName}>
        <div className={requestClassName}>
          <strong className="text-foreground">
            Request rate{" "}
            <small className="ml-1.5 font-normal text-muted-foreground">
              req/s
            </small>
          </strong>
          <span className="text-muted-foreground">10:00 - 10:15</span>
        </div>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_160px] items-center gap-6 max-[1100px]:grid-cols-1 max-[1100px]:gap-4">
          <svg
            className="h-auto w-full fill-muted-foreground font-mono text-[20px] max-[1100px]:text-[24px] max-[700px]:text-[28px]"
            viewBox="0 0 600 230"
            role="img"
            aria-labelledby={chartTitle}
          >
            <title id={chartTitle}>
              Request rate from 10:00 to 10:15, with two spikes reaching
              approximately 400 and 800 requests per second.
            </title>
            {[30, 110, 190].map((y) => (
              <line
                key={y}
                x1="45"
                y1={y}
                x2="580"
                y2={y}
                className="stroke-[var(--color-fd-border)] [stroke-dasharray:4_4]"
              />
            ))}
            <text x="0" y="35">
              800
            </text>
            <text x="0" y="115">
              400
            </text>
            <text x="20" y="195">
              0
            </text>
            <path
              d="M45 187 L80 185 L110 184 L145 185 L175 180 L195 112 L215 172 L240 182 L275 174 L300 30 L325 86 L345 178 L380 183 L415 179 L450 184 L490 181 L535 185 L580 182 L580 190 L45 190 Z"
              className="fill-[color-mix(in_srgb,#32c8cc_10%,transparent)]"
            />
            <path
              d="M45 187 L80 185 L110 184 L145 185 L175 180 L195 112 L215 172 L240 182 L275 174 L300 30 L325 86 L345 178 L380 183 L415 179 L450 184 L490 181 L535 185 L580 182"
              className="fill-none stroke-[#32c8cc] stroke-[2.5] [stroke-linejoin:round]"
            />
            <text x="45" y="220">
              10:00
            </text>
            <text x="310" y="220" textAnchor="middle">
              10:07
            </text>
            <text x="580" y="220" textAnchor="end">
              10:15
            </text>
          </svg>
          <div className="grid gap-6 max-[1100px]:grid-cols-2 max-[700px]:gap-5">
            <div>
              <p className="text-[0.8125rem]">P95 response time</p>
              <strong className="text-[2rem] font-medium">
                420 <span className="text-base text-muted-foreground">ms</span>
              </strong>
              <meter
                className="mt-2 block h-3 w-full [&::-moz-meter-bar]:bg-primary [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-[var(--color-fd-border)] [&::-webkit-meter-optimum-value]:bg-primary"
                min={0}
                max={1000}
                value={420}
                aria-label="P95 response time: 420 milliseconds on a 0 to 1000 millisecond scale"
              />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>0 ms</span>
                <span>1,000 ms</span>
              </div>
            </div>
            <div>
              <p className="text-[0.8125rem]">Error rate</p>
              <strong className="text-[2rem] font-medium">
                0.7<span className="text-base text-muted-foreground">%</span>
              </strong>
              <meter
                className="mt-2 block h-3 w-full [&::-moz-meter-bar]:bg-primary [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-[var(--color-fd-border)] [&::-webkit-meter-optimum-value]:bg-primary"
                min={0}
                max={10}
                value={0.7}
                aria-label="Error rate: 0.7 percent on a 0 to 10 percent scale"
              />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span>10%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorExample() {
  return (
    <div className={demoClassName}>
      <div className={demoBarClassName}>
        <span className="text-foreground">Error detail</span>
        <span>Illustrative example</span>
      </div>
      <div className={demoBodyClassName}>
        <div className={requestClassName}>
          <div>
            <span className="mr-2 text-[#fb978b]">ERROR</span>{" "}
            <code>POST /checkout</code>
          </div>
          <span className="text-muted-foreground">10:12:08</span>
        </div>
        <div className="mt-6 border-l-2 border-[#fb978b] bg-[color-mix(in_srgb,#fb978b_5%,transparent)] px-5 py-[18px] max-[700px]:p-3">
          <strong className="font-mono text-sm leading-[1.6] text-[#fb978b] [overflow-wrap:anywhere]">
            PaymentProviderError: upstream returned 503
          </strong>
          <pre className="mt-2.5 whitespace-pre-wrap font-mono text-[0.8125rem] leading-[1.8] [overflow-wrap:anywhere]">
            <code>
              {
                "at chargeCustomer (payments.ts:84)\nat checkout       (checkout.ts:37)"
              }
            </code>
          </pre>
        </div>
        <div className="mt-5 mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>Related logs</span>
          <code>req_demo_42</code>
        </div>
        <div className="flex gap-6 border-t border-[var(--color-fd-border)] py-2 font-mono text-[0.8125rem] leading-[1.6] max-[700px]:gap-3">
          <time className="text-muted-foreground">10:12:07</time>
          <span>Payment request started</span>
        </div>
        <div className="flex gap-6 border-t border-[var(--color-fd-border)] py-2 font-mono text-[0.8125rem] leading-[1.6] max-[700px]:gap-3">
          <time className="text-muted-foreground">10:12:08</time>
          <span>Payment provider returned 503</span>
        </div>
      </div>
    </div>
  );
}

function ConnectedMonitoringExamples() {
  const [selection, setSelection] = useState("performance");
  const selected =
    examples.find((example) => example.id === selection) ?? examples[0];

  return (
    <div className="monitoring-connected">
      <section
        className="monitoring-controls"
        aria-label="Explore monitoring examples"
      >
        {examples.map(({ id, label, description, icon: Icon }) => (
          <Collapsible
            key={id}
            className="monitoring-item"
            open={selection === id}
            onOpenChange={(expanded) => {
              if (expanded) setSelection(id);
            }}
          >
            <h3>
              <CollapsibleTrigger
                className="monitoring-toggle"
                aria-disabled={selection === id}
              >
                <Icon className="monitoring-icon" aria-hidden="true" />
                <span>{label}</span>
                <ChevronDown
                  className="monitoring-chevron"
                  aria-hidden="true"
                />
              </CollapsibleTrigger>
            </h3>
            <CollapsibleContent className="monitoring-explanation" keepMounted>
              <p>{description}</p>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </section>
      <figure className="monitoring-canvas" aria-label={selected.label}>
        {examples.map(({ id, view: View }) => (
          <div
            className="monitoring-example"
            key={id}
            data-active={selection === id ? "" : undefined}
            aria-hidden={selection !== id}
            inert={selection !== id}
          >
            <View />
          </div>
        ))}
      </figure>
    </div>
  );
}

export function FeaturesZigzag() {
  return (
    <section className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background">
      <div className="everr-monitoring">
        <div className="workbench-heading">
          <h2>An app can be up and still let users down</h2>
          <p>
            Monitoring goes beyond error reporting. See where your app slows
            down, how it responds to demand, and what led to a failure.
          </p>
        </div>
        <ConnectedMonitoringExamples />
      </div>
    </section>
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

/** A run rendered as a trace waterfall, mirroring what the GitHub App
 *  ingests: workflows, jobs, and steps as spans. */
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

  return (
    <div className="relative">
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
