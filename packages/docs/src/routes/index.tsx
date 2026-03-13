import { createFileRoute, Link } from "@tanstack/react-router";
import type React from "react";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Home,
});

const APP_URL = "https://app.everr.dev";

/* ------------------------------------------------------------------ */
/*  Hero                                                               */
/* ------------------------------------------------------------------ */

function HeroSection() {
  return (
    <section className="flex flex-col items-center">
      <h1 className="font-heading text-center text-5xl uppercase leading-[0.9] sm:text-7xl md:text-[100px] lg:text-[128px] everr-decoration everr-decoration-primary">
        Every second
        <br />
        counts
      </h1>

      <p className="mt-6 text-center text-xl sm:text-2xl md:mt-10">
        <span
          className="inline bg-primary px-3 py-1 font-semibold font-heading text-primary-foreground leading-relaxed"
          style={{
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          Know what your CI is doing.
        </span>
      </p>

      <p className="mx-auto mt-4 max-w-2xl text-center text-fd-muted-foreground">
        Everr collects telemetry from your CI/CD pipelines and turns workflow
        runs into OpenTelemetry traces. Debug failures, identify optimization
        opportunites, and track flaky jobs — all from your terminal.
      </p>

      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row md:mt-14">
        <Button
          variant="cta"
          size="xl"
          render={
            // biome-ignore lint/a11y/useAnchorContent: content is injected
            <a href={APP_URL} target="_blank" rel="noopener noreferrer" />
          }
        >
          Get started
        </Button>

        <Button
          variant="outline"
          size="xl"
          render={<Link to="/docs/$" params={{ _splat: "" }} />}
        >
          Docs
        </Button>
      </div>

      <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.25em] text-fd-muted-foreground/60">
        Open source · Built on OpenTelemetry
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Product Visualization                                              */
/* ------------------------------------------------------------------ */

const TRACE_STEPS = [
  { step: "checkout", duration: "0.9s", pct: "18%", ok: true },
  { step: "install deps", duration: "4.2s", pct: "52%", ok: true },
  { step: "lint", duration: "1.8s", pct: "22%", ok: true },
  { step: "test", duration: "11.4s", pct: "100%", ok: false },
  { step: "deploy", duration: "1.1s", pct: "14%", ok: true },
];

function ProductVisualization() {
  return (
    <div className="mx-auto mt-16 w-full max-w-5xl md:mt-20">
      <div className="product-perspective">
        <div className="product-tilt">
          <div className="flex h-10 items-center border-b-2 border-fd-border bg-fd-secondary/50 px-4">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-fd-muted-foreground">
              everr / traces
            </span>
          </div>

          <div className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="bg-primary/15 px-2 py-1 font-mono text-xs font-bold uppercase text-primary">
                run #29184
              </span>
              <span className="font-mono text-xs text-fd-muted-foreground">
                ci / build-and-test
              </span>
            </div>

            <div className="space-y-2.5">
              {TRACE_STEPS.map((span) => (
                <div
                  key={span.step}
                  className="grid grid-cols-[100px_1fr_56px] items-center gap-3"
                >
                  <span className="truncate font-mono text-xs text-fd-muted-foreground">
                    {span.step}
                  </span>
                  <div className="h-6 bg-fd-secondary/60">
                    <div
                      className={`h-full ${span.ok ? "bg-primary/45" : "bg-red-500/45"}`}
                      style={{ width: span.pct }}
                    />
                  </div>
                  <span
                    className={`text-right font-mono text-xs ${
                      span.ok
                        ? "text-fd-muted-foreground"
                        : "font-bold text-red-500"
                    }`}
                  >
                    {span.duration}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between border-2 border-fd-border bg-fd-secondary/30 px-3 py-2 text-xs">
              <span className="font-bold uppercase tracking-wider">
                p95 duration
              </span>
              <span className="font-mono font-bold text-red-500">
                +18.7% vs baseline
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Value Props                                                        */
/* ------------------------------------------------------------------ */

const VALUE_PROPS = [
  {
    title: "Built on open standards",
    description:
      "Everr is built on OpenTelemetry — the industry standard for observability. No vendor lock-in, no proprietary agents.",
  },
  {
    title: "AI-native debugging",
    description:
      "Designed for workflows shared by humans and AI agents. From detecting failures to pushing fixes.",
  },
  {
    title: "Designed for speed",
    description:
      "Reduces noise and restores momentum to help teams ship with high velocity and focus.",
  },
];

function OpenStandardsIllustration() {
  const sources = [
    { y: 44, label: "CI" },
    { y: 92, label: "TESTS" },
    { y: 140, label: "LOGS" },
  ];

  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      className="h-full w-full"
      aria-hidden="true"
    >
      <rect
        x="18"
        y="24"
        width="164"
        height="152"
        rx="20"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-fd-border/40"
      />

      {sources.map((source) => (
        <g key={source.label}>
          <rect
            x="28"
            y={source.y}
            width="48"
            height="28"
            rx="10"
            stroke="currentColor"
            strokeWidth="2"
            className="text-fd-muted-foreground/45"
          />
          <circle
            cx="40"
            cy={source.y + 14}
            r="3.5"
            fill="currentColor"
            className="text-primary/80"
          />
          <text
            x="48"
            y={source.y + 17}
            fontSize="7"
            fontWeight="700"
            letterSpacing="0.12em"
            fill="currentColor"
            className="text-fd-muted-foreground"
          >
            {source.label}
          </text>
          <path
            d={`M76 ${source.y + 14} H86`}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-fd-muted-foreground/45"
          />
        </g>
      ))}

      <path
        d="M86 58 C95 58 95 82 106 82"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-fd-muted-foreground/45"
      />
      <path
        d="M86 106 H106"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-fd-muted-foreground/45"
      />
      <path
        d="M86 154 C95 154 95 130 106 130"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-fd-muted-foreground/45"
      />

      <rect
        x="86"
        y="78"
        width="40"
        height="52"
        rx="14"
        fill="currentColor"
        className="text-primary/10"
      />
      <rect
        x="86"
        y="78"
        width="40"
        height="52"
        rx="14"
        stroke="currentColor"
        strokeWidth="2"
        className="text-primary/70"
      />
      <path
        d="M98 90 H114"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-primary/80"
      />
      <path
        d="M98 104 H114"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-primary/80"
      />
      <path
        d="M98 118 H106"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-primary/80"
      />
      <text
        x="106"
        y="126"
        fontSize="7"
        fontWeight="700"
        textAnchor="middle"
        letterSpacing="0.12em"
        fill="currentColor"
        className="text-primary"
      >
        OTEL
      </text>

      <path
        d="M126 104 H138"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-primary/70"
      />

      <rect
        x="138"
        y="60"
        width="32"
        height="88"
        rx="12"
        stroke="currentColor"
        strokeWidth="2"
        className="text-fd-muted-foreground/45"
      />
      <text
        x="154"
        y="76"
        fontSize="6.5"
        fontWeight="700"
        textAnchor="middle"
        letterSpacing="0.1em"
        fill="currentColor"
        className="text-fd-muted-foreground"
      >
        EVERR
      </text>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect
            x="146"
            y={88 + i * 16}
            width={16 - i * 2}
            height="6"
            rx="3"
            fill="currentColor"
            className={
              i === 1 ? "text-primary/80" : "text-fd-muted-foreground/35"
            }
          />
          <circle
            cx="144"
            cy={91 + i * 16}
            r="2"
            fill="currentColor"
            className="text-fd-muted-foreground/45"
          />
        </g>
      ))}
    </svg>
  );
}

function AIDebuggingIllustration() {
  const pipelineRows = [
    { y: 64, status: "ok" },
    { y: 88, status: "ok" },
    { y: 112, status: "failed" },
  ] as const;

  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      className="h-full w-full"
      aria-hidden="true"
    >
      <rect
        x="20"
        y="28"
        width="120"
        height="118"
        rx="18"
        stroke="currentColor"
        strokeWidth="2"
        className="text-fd-muted-foreground/45"
      />
      <rect
        x="20"
        y="28"
        width="120"
        height="18"
        rx="18"
        fill="currentColor"
        className="text-fd-secondary/70"
      />
      <path
        d="M20 46 H140"
        stroke="currentColor"
        strokeWidth="2"
        className="text-fd-muted-foreground/35"
      />
      <text
        x="32"
        y="40"
        fontSize="7"
        fontWeight="700"
        letterSpacing="0.12em"
        fill="currentColor"
        className="text-fd-muted-foreground"
      >
        PIPELINE
      </text>

      {pipelineRows.map((row, index) => (
        <g key={row.y}>
          <rect
            x="30"
            y={row.y - 8}
            width="100"
            height="16"
            rx="8"
            fill="currentColor"
            className={
              row.status === "failed"
                ? "text-red-500/8"
                : "text-fd-secondary/45"
            }
          />
          <circle
            cx="40"
            cy={row.y}
            r="4"
            fill="currentColor"
            className={
              row.status === "failed" ? "text-red-500" : "text-primary/80"
            }
          />
          <rect
            x="50"
            y={row.y - 3}
            width={row.status === "failed" ? 34 : 42 - index * 4}
            height="6"
            rx="3"
            fill="currentColor"
            className="text-fd-foreground/80"
          />
          <rect
            x="90"
            y={row.y - 3}
            width={row.status === "failed" ? 24 : 18}
            height="6"
            rx="3"
            fill="currentColor"
            className={
              row.status === "failed"
                ? "text-red-500/80"
                : "text-fd-muted-foreground/30"
            }
          />
        </g>
      ))}

      <path
        d="M130 112 C146 112 150 120 150 132"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-primary/70"
      />

      <rect
        x="116"
        y="118"
        width="62"
        height="50"
        rx="14"
        fill="currentColor"
        className="text-primary/8"
      />
      <rect
        x="116"
        y="118"
        width="62"
        height="50"
        rx="14"
        stroke="currentColor"
        strokeWidth="2"
        className="text-primary/60"
      />
      <circle
        cx="130"
        cy="134"
        r="8"
        fill="currentColor"
        className="text-primary/18"
      />
      <path
        d="M130 128 L132 132 L136 133 L132 136 L131 141 L128 137 L124 136 L127 132 Z"
        fill="currentColor"
        className="text-primary"
      />
      <text
        x="145"
        y="133"
        fontSize="6.5"
        fontWeight="700"
        letterSpacing="0.1em"
        fill="currentColor"
        className="text-primary"
      >
        AI FIX
      </text>
      <path
        d="M144 144 H166"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-red-500/70"
      />
      <path
        d="M144 154 H160"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-green-500/80"
      />
      <path
        d="M144 149 H170"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 3"
        className="text-fd-muted-foreground/35"
      />
    </svg>
  );
}

function SpeedIllustration() {
  const beforeBars = [
    { id: "checkout", width: 34 },
    { id: "install", width: 44 },
    { id: "tests", width: 40 },
    { id: "deploy", width: 44 },
  ];
  const afterBars = [
    { id: "checkout", width: 20 },
    { id: "install", width: 28 },
    { id: "tests", width: 24 },
    { id: "deploy", width: 30 },
  ];

  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      className="h-full w-full"
      aria-hidden="true"
    >
      <rect
        x="20"
        y="42"
        width="64"
        height="112"
        rx="16"
        stroke="currentColor"
        strokeWidth="2"
        className="text-fd-muted-foreground/35"
      />
      <text
        x="32"
        y="58"
        fontSize="7"
        fontWeight="700"
        letterSpacing="0.12em"
        fill="currentColor"
        className="text-fd-muted-foreground"
      >
        BEFORE
      </text>
      {beforeBars.map((bar, index) => (
        <g key={bar.id}>
          <rect
            x="30"
            y={74 + index * 17}
            width="44"
            height="10"
            rx="5"
            fill="currentColor"
            className="text-fd-secondary/55"
          />
          <rect
            x="30"
            y={74 + index * 17}
            width={bar.width}
            height="10"
            rx="5"
            fill="currentColor"
            className={
              index === 2 ? "text-red-500/55" : "text-fd-muted-foreground/35"
            }
          />
        </g>
      ))}

      <path
        d="M84 108 C102 108 106 92 122 84"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="text-primary/80"
      />
      <path
        d="M114 80 L122 84 L117 92"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary/80"
      />

      <rect
        x="118"
        y="28"
        width="62"
        height="126"
        rx="16"
        fill="currentColor"
        className="text-primary/8"
      />
      <rect
        x="118"
        y="28"
        width="62"
        height="126"
        rx="16"
        stroke="currentColor"
        strokeWidth="2"
        className="text-primary/55"
      />
      <text
        x="130"
        y="44"
        fontSize="7"
        fontWeight="700"
        letterSpacing="0.12em"
        fill="currentColor"
        className="text-primary"
      >
        FASTER
      </text>
      <rect
        x="130"
        y="52"
        width="38"
        height="18"
        rx="9"
        fill="currentColor"
        className="text-primary/16"
      />
      <text
        x="149"
        y="64"
        fontSize="9"
        fontWeight="700"
        textAnchor="middle"
        fill="currentColor"
        className="text-primary"
      >
        -18%
      </text>
      {afterBars.map((bar, index) => (
        <g key={bar.id}>
          <rect
            x="128"
            y={82 + index * 17}
            width="42"
            height="10"
            rx="5"
            fill="currentColor"
            className="text-primary/14"
          />
          <rect
            x="128"
            y={82 + index * 17}
            width={bar.width}
            height="10"
            rx="5"
            fill="currentColor"
            className="text-primary/85"
          />
        </g>
      ))}
    </svg>
  );
}

function ValuePropsSection() {
  const illustrations = [
    OpenStandardsIllustration,
    AIDebuggingIllustration,
    SpeedIllustration,
  ];
  return (
    <section>
      <div className="mx-auto max-w-7xl">
        <h2 className="font-heading text-4xl uppercase leading-[0.95] sm:text-5xl md:text-6xl everr-decoration everr-decoration-primary">
          Look your pipelines with new eyes
        </h2>
        <p className="mt-4 max-w-3xl text-lg text-fd-muted-foreground">
          Purpose-built for modern teams with AI workflows at its core, Everr
          sets a new standard for understanding your pipelines.
        </p>

        <div className="mt-16 grid grid-cols-1 gap-10 md:mt-20 md:grid-cols-3 md:gap-0">
          {VALUE_PROPS.map((item, i) => {
            const Illustration = illustrations[i];
            const isLast = i === VALUE_PROPS.length - 1;
            return (
              <div
                key={item.title}
                className={`${!isLast ? "border-b-2 border-fd-border pb-10 md:border-b-0 md:border-r-2 md:pb-0 md:pr-10" : ""} ${i > 0 ? "md:pl-10" : ""}`}
              >
                <div className="flex aspect-square max-h-[220px] items-center justify-center border-2 border-fd-border bg-fd-secondary/20">
                  <Illustration />
                </div>
                <h3 className="mt-6 text-xl font-bold font-heading everr-decoration everr-decoration-primary">
                  {item.title}
                </h3>
                <p className="mt-1 leading-relaxed text-fd-muted-foreground">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  How It Works                                                       */
/* ------------------------------------------------------------------ */

const SETUP_STEPS = [
  {
    num: "01",
    title: "One-click connect",
    description:
      "Connect your CI/CD systems in seconds. GitHub Actions, GitLab CI, Jenkins, and more — one integration to trace them all.",
    viz: "connect",
  },
  {
    num: "02",
    title: "Trigger a run",
    description:
      "Push your code and watch every workflow run traced in full detail. See test executions, durations, and failure patterns as they happen.",
    viz: "runs",
  },
  {
    num: "03",
    title: "Fix from your assistant",
    description:
      "Wait for CI results without leaving your editor. When failures hit, your assistant pinpoints the root cause and can fix it.",
    viz: "assistant",
  },
] as const;

const VIZ_COMPONENTS: Record<
  (typeof SETUP_STEPS)[number]["viz"],
  () => React.ReactNode
> = {
  connect: ConnectProvidersViz,
  runs: RunsAndTestsViz,
  assistant: CodeAssistantViz,
};

function ZeroConfigSection() {
  return (
    <section>
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-3 text-4xl sm:text-5xl md:text-6xl font-heading uppercase leading-[0.95] everr-decoration everr-decoration-primary">
          Zero-config setup
        </h2>
        <p className="mb-16 max-w-2xl text-lg text-fd-muted-foreground">
          Link your CI and CD tools to Everr and bring their data directly to
          your hands.
        </p>

        <div className="flex flex-col">
          {SETUP_STEPS.map((step, i) => {
            const Viz = VIZ_COMPONENTS[step.viz];
            const isLast = i === SETUP_STEPS.length - 1;
            return (
              <div
                key={step.num}
                className={`grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-16 ${!isLast ? "border-b-2 border-fd-border pb-12 mb-12" : ""}`}
              >
                <div className="flex flex-col justify-center">
                  <span className="mb-4 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/50">
                    Step {step.num}
                  </span>
                  <h3 className="mb-2 text-2xl font-heading font-bold everr-decoration everr-decoration-primary">
                    {step.title}
                  </h3>
                  <p className="leading-relaxed text-fd-muted-foreground">
                    {step.description}
                  </p>
                </div>
                <div>
                  <Viz />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Card Visualizations                                                */
/* ------------------------------------------------------------------ */

const CI_PROVIDERS: {
  name: string;
  status: "connected" | "planned";
}[] = [
  { name: "GitHub Actions", status: "connected" },
  { name: "GitLab CI", status: "planned" },
  { name: "Jenkins", status: "planned" },
  { name: "Tekton", status: "planned" },
  { name: "ArgoCD", status: "planned" },
  { name: "Azure Pipelines", status: "planned" },
];

function ConnectProvidersViz() {
  return (
    <div
      className="h-96 w-full overflow-hidden bg-fd-background"
      style={{
        maskImage:
          "linear-gradient(black 85%, rgba(0,0,0,0.4) 95%, transparent 100%)",
      }}
    >
      <div className="flex h-[480px] flex-col overflow-hidden border-2 border-fd-border bg-fd-card">
        <div className="flex h-12 shrink-0 items-center border-b-2 border-fd-border bg-fd-secondary/50 pl-4">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-fd-muted-foreground">
            Integrations
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 p-5">
          {CI_PROVIDERS.map((provider) => (
            <div
              key={provider.name}
              className={`flex flex-col gap-2 border-2 p-4 ${
                provider.status === "connected"
                  ? "border-primary/30 bg-primary/5"
                  : "border-fd-border bg-fd-secondary/30"
              }`}
            >
              <span className="font-mono text-[13px] font-bold">
                {provider.name}
              </span>
              {provider.status === "connected" ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                  <span>&#10003;</span> Connected
                </span>
              ) : (
                <span className="text-[11px] font-bold uppercase tracking-wider text-fd-muted-foreground/50">
                  Planned
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TEST_RESULTS = [
  {
    name: "auth.login",
    status: "passed",
    success: "100%",
    p50: "1.1s",
    p95: "1.4s",
  },
  {
    name: "auth.signup",
    status: "passed",
    success: "100%",
    p50: "0.7s",
    p95: "0.9s",
  },
  {
    name: "cart.checkout",
    status: "failed",
    success: "92%",
    p50: "2.8s",
    p95: "4.1s",
  },
  {
    name: "cart.add-item",
    status: "flaky",
    success: "87%",
    p50: "2.1s",
    p95: "3.6s",
  },
  {
    name: "user.profile",
    status: "passed",
    success: "99%",
    p50: "0.4s",
    p95: "0.6s",
  },
];

const COLLAPSED_RUNS = [
  {
    title: "ci / build-and-test",
    hash: "f92e4d1",
    time: "14m ago",
    status: "passed",
    branch: "feat/webhooks",
  },
  {
    title: "ci / deploy-preview",
    hash: "a3c17e8",
    time: "28m ago",
    status: "passed",
    branch: "feat/webhooks",
  },
  {
    title: "ci / build-and-test",
    hash: "e71a0b3",
    time: "1h ago",
    status: "passed",
    branch: "fix/flaky-test",
  },
];

function RunsAndTestsViz() {
  return (
    <div className="relative h-96 w-full overflow-hidden bg-fd-background">
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1/5"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, var(--color-fd-background) 100%)",
        }}
      />
      <div className="flex flex-col overflow-hidden border-2 border-fd-border bg-fd-card">
        <div className="border-b-2 border-fd-border bg-fd-secondary/50 px-5 py-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-fd-muted-foreground">
            Recent runs
          </span>
        </div>

        {/* Expanded run with test results */}
        <div className="border-b border-fd-border/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold">ci / build-and-test</span>
            <span className="inline-flex items-center gap-[3px] border border-red-500/15 bg-red-500/5 px-1.5 py-px text-[10px] font-bold uppercase text-red-500">
              {/** biome-ignore lint/a11y/noSvgWithoutTitle: decorative */}
              <svg
                width="8"
                height="8"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="shrink-0"
              >
                <circle cx="8" cy="8" r="5" />
              </svg>
              failed
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-fd-muted-foreground">
            <span className="border border-fd-border bg-fd-card px-1.5 py-px text-[10px] font-bold">
              b68df0d
            </span>
            <span className="text-fd-border">&middot;</span>
            <span>2m ago</span>
            <span className="text-fd-border">&middot;</span>
            <span>main</span>
          </div>

          <div className="mt-3 border-2 border-fd-border bg-fd-secondary/20">
            <div className="grid grid-cols-[1fr_52px_44px_44px] gap-1 border-b border-fd-border/50 px-3 py-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-fd-muted-foreground">
                Test results — 3212 passed · 1 failed · 1 flaky
              </span>
              <span className="text-right text-[9px] font-bold uppercase tracking-wider text-fd-muted-foreground">
                Success
              </span>
              <span className="text-right text-[9px] font-bold uppercase tracking-wider text-fd-muted-foreground">
                p50
              </span>
              <span className="text-right text-[9px] font-bold uppercase tracking-wider text-fd-muted-foreground">
                p95
              </span>
            </div>
            {TEST_RESULTS.map((test) => (
              <div
                key={test.name}
                className="grid grid-cols-[1fr_52px_44px_44px] items-center gap-1 border-b border-fd-border/30 px-3 py-1.5 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block size-1.5 shrink-0 ${
                      test.status === "passed"
                        ? "bg-green-500"
                        : test.status === "failed"
                          ? "bg-red-500"
                          : "bg-yellow-500"
                    }`}
                  />
                  <span className="truncate font-mono text-[11px]">
                    {test.name}
                  </span>
                </div>
                <span className="text-right font-mono text-[11px] text-fd-muted-foreground">
                  {test.success}
                </span>
                <span className="text-right font-mono text-[11px] text-fd-muted-foreground">
                  {test.p50}
                </span>
                <span className="text-right font-mono text-[11px] text-fd-muted-foreground">
                  {test.p95}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Collapsed runs */}
        {COLLAPSED_RUNS.map((run) => (
          <div
            key={run.hash}
            className="border-b border-fd-border/50 px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold">{run.title}</span>
              <span className="inline-flex items-center gap-[3px] border border-green-500/15 bg-green-500/5 px-1.5 py-px text-[10px] font-bold uppercase text-green-500 dark:text-green-400">
                {/** biome-ignore lint/a11y/noSvgWithoutTitle: decorative */}
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="shrink-0"
                >
                  <circle cx="8" cy="8" r="5" />
                </svg>
                {run.status}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-fd-muted-foreground">
              <span className="border border-fd-border bg-fd-card px-1.5 py-px text-[10px] font-bold">
                {run.hash}
              </span>
              <span className="text-fd-border">&middot;</span>
              <span>{run.time}</span>
              <span className="text-fd-border">&middot;</span>
              <span>{run.branch}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CodeAssistantViz() {
  return (
    <div className="relative h-96 w-full overflow-hidden bg-fd-background">
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-1/5"
        style={{
          background:
            "linear-gradient(to right, transparent 0%, var(--color-fd-background) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1/5"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, var(--color-fd-background) 100%)",
        }}
      />
      <div className="relative flex h-[430px] w-[580px] shrink-0 flex-col gap-2 overflow-hidden border-2 border-fd-border bg-fd-card px-5 pb-4 pt-14 font-mono text-[10px] leading-4 text-fd-foreground sm:text-[11px]">
        <div className="absolute left-4 top-3 z-10 lg:right-4 lg:left-auto">
          <span className="inline-flex items-center border-2 border-fd-border bg-fd-secondary/70 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-fd-foreground">
            Has the CI pipeline failed?
          </span>
        </div>
        <p>
          I&apos;ll check your latest CI status with Everr from this repo and
          report any failing workflow/job details.
        </p>
        <p className="text-fd-muted-foreground">
          Background terminal finished with everr status
        </p>
        <p>
          CI is currently failing. `everr status` already returned the failing
          step and log arguments, so I&apos;m pulling that step&apos;s logs
          directly.
        </p>
        <p className="truncate text-fd-muted-foreground">
          Background terminal finished with everr runs logs --trace-id
          c929f40ec0632c976134b35d0b87699a --job-name "E2E tests" --step-number
          12
        </p>
        <p>
          Found failing step{" "}
          <span className="border border-fd-border/80 bg-fd-secondary px-1.5 py-0.5 font-bold text-fd-foreground">
            E2E tests
          </span>{" "}
          and fetching logs to extract the concrete failure reason.
        </p>
        <div className="flex items-center gap-2 text-fd-muted-foreground">
          <div className="h-px flex-1 bg-fd-border" />
          <span className="text-[9px] font-bold uppercase tracking-wider">
            Worked for 23s
          </span>
          <div className="h-px flex-1 bg-fd-border" />
        </div>
        <p className="font-bold text-fd-foreground">
          Your CI is currently failing.
        </p>
        <ul className="list-disc space-y-1 pl-4 text-fd-foreground/95">
          <li>
            Repo/branch{" "}
            <span className="border border-fd-border/80 bg-fd-secondary px-1.5 py-0.5 font-bold text-fd-foreground">
              everr-labs/everr on main
            </span>
          </li>
          <li>
            Reason{" "}
            <span className="border border-fd-border/80 bg-fd-secondary px-1.5 py-0.5 font-bold text-fd-foreground">
              Timed out waiting 300000ms for config.webServer
            </span>
          </li>
        </ul>
        <p className="text-fd-muted-foreground">
          There are signs of <b>CI flakiness</b> starting from commit{" "}
          <span className="border border-fd-border/80 bg-fd-secondary px-1.5 py-0.5 font-bold text-fd-foreground">
            f92e4d1
          </span>
          . Do you want me to fix it?
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Why Everr                                                          */
/* ------------------------------------------------------------------ */

const WHY_ITEMS = [
  {
    num: "01",
    question: '"Why did this pipeline break?"',
    answer:
      "Every workflow run traced as OTel spans. Navigate the waterfall, see which step failed, and jump to logs in milliseconds.",
  },
  {
    num: "02",
    question: '"Is this test actually flaky, or is it my code?"',
    answer:
      "Track test results across runs. Identify genuinely flaky tests, separate signal from noise.",
  },
  {
    num: "03",
    question: '"Why is our CI getting slower?"',
    answer:
      "Monitor p50/p95 durations. Catch regressions before they become 20-minute build queues.",
  },
];

function WhySection() {
  return (
    <section>
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-3 text-4xl font-heading uppercase leading-[0.95] sm:text-5xl md:text-6xl everr-decoration everr-decoration-primary">
          Why Everr
        </h2>
        <p className="mb-16 max-w-2xl text-lg text-fd-muted-foreground">
          AI-assisted development compresses release cycles, but broken
          pipelines still break your flow. Everr gives you the signals to fix
          them fast.
        </p>

        <div className="grid gap-10 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:gap-12">
          {WHY_ITEMS.map((item, i) => (
            <div key={item.num} className="contents">
              <div>
                <h3 className="mb-3 text-lg font-heading italic">
                  {item.question}
                </h3>
                <p className="leading-relaxed text-fd-muted-foreground">
                  {item.answer}
                </p>
              </div>
              {i < WHY_ITEMS.length - 1 && (
                <div className="hidden w-px bg-fd-border md:block" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Bottom CTA                                                         */
/* ------------------------------------------------------------------ */

function BottomCTA() {
  return (
    <section>
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <h2 className="text-4xl uppercase leading-[0.9] sm:text-5xl md:text-7xl font-heading">
          Stop guessing
          <br />
          <span
            className="inline bg-primary px-4 py-1 text-primary-foreground leading-relaxed everr-decoration everr-decoration-primary-foreground"
            style={{
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
            }}
          >
            Start tracing
          </span>
        </h2>
        <p className="mt-6 max-w-xl text-lg text-fd-muted-foreground">
          Connect your GitHub Actions and get OpenTelemetry traces in minutes.
          Free to get started.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <Button
            variant="cta"
            size="xl"
            render={
              // biome-ignore lint/a11y/useAnchorContent: content is injected
              <a href={APP_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            Get started
          </Button>

          <Button variant="outline" size="xl" render={<Link to="/docs/$" />}>
            Docs
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Home                                                               */
/* ------------------------------------------------------------------ */

function Home() {
  return (
    <>
      <main className="relative z-0 flex flex-1 flex-col overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-[140px]">
          <div className="flex flex-col gap-16 md:gap-32">
            <div>
              <HeroSection />
              <ProductVisualization />
            </div>

            <ValuePropsSection />

            <div className="h-[2px] w-full bg-fd-border" />

            <ZeroConfigSection />

            <div className="h-[2px] w-full bg-fd-border" />

            <WhySection />

            <div className="h-[2px] w-full bg-fd-border" />

            <BottomCTA />
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
