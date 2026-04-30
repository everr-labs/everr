import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { SiDiscord } from "@icons-pack/react-simple-icons";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { Footer } from "@/components/footer";

export const Route = createFileRoute("/")({
  component: Home,
});

const APP_URL = "https://app.everr.dev";
const DISCORD_URL = "https://discord.gg/hd6yYDjAuw";

/* ------------------------------------------------------------------ */
/*  Hero                                                               */
/* ------------------------------------------------------------------ */

function HeroSection() {
  return (
    <section className="flex min-h-[85vh] flex-col items-center justify-center text-center">
      <Link
        to="/waitlist"
        className="mb-6 flex animate-fade-up items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-4 py-1.5 font-heading text-xs font-bold uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary/10 md:mb-8"
      >
        <ChevronRightIcon className="size-4" />
        Join the waitlist
      </Link>

      <h1 className="font-heading text-4xl uppercase leading-[0.88] sm:text-6xl md:text-[80px] lg:text-[120px]">
        <span
          className="block animate-fade-up"
          style={{ animationDelay: "0.05s" }}
        >
          Software
        </span>
        <span
          className="block animate-fade-up"
          style={{ animationDelay: "0.1s" }}
        >
          delivery
        </span>
        <span
          className="block animate-fade-up"
          style={{ animationDelay: "0.15s" }}
        >
          <span className="relative inline-block px-2 sm:px-4">
            <span className="absolute inset-x-0 bottom-0 top-0 bg-primary" />
            <span className="relative text-primary-foreground everr-decoration">
              intelligence
            </span>
          </span>
        </span>
      </h1>

      <p
        className="animate-fade-up mx-auto mt-6 max-w-2xl text-lg text-fd-muted-foreground sm:text-xl md:mt-10"
        style={{ animationDelay: "0.3s" }}
      >
        Everr transforms CI/CD pipelines into{" "}
        <strong className="text-fd-foreground">observable systems</strong>.
        Detect failures, explain root causes, and resolve issues - for{" "}
        <strong className="text-fd-foreground">developers</strong> and{" "}
        <strong className="text-fd-foreground">AI agents</strong>.
      </p>

      <div
        className="animate-fade-up mt-10 flex flex-col items-center gap-4 sm:flex-row md:mt-14"
        style={{ animationDelay: "0.4s" }}
      >
        <Button
          variant="cta"
          size="xl"
          nativeButton={false}
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
          nativeButton={false}
          render={<Link to="/docs/$" params={{ _splat: "" }} />}
        >
          Documentation
        </Button>
      </div>

      <p
        className="animate-fade-up mt-8 font-heading text-[11px] uppercase tracking-[0.25em] text-fd-muted-foreground/40"
        style={{ animationDelay: "0.5s" }}
      >
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
    <div className="mx-auto w-full max-w-5xl pb-8 md:pb-16 hidden sm:block">
      <div className="product-perspective">
        <div className="product-tilt">
          <div className="flex h-10 items-center border-b-2 border-fd-border bg-fd-secondary/50 px-4">
            <span className="font-heading text-xs font-bold uppercase tracking-wider text-fd-muted-foreground">
              everr / traces
            </span>
          </div>

          <div className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="bg-primary/15 px-2 py-1 font-heading text-xs font-bold uppercase text-primary">
                run #29184
              </span>
              <span className="font-heading text-xs text-fd-muted-foreground">
                ci / build-and-test
              </span>
            </div>

            <div className="space-y-2.5">
              {TRACE_STEPS.map((span) => (
                <div
                  key={span.step}
                  className="grid grid-cols-[100px_1fr_56px] items-center gap-3"
                >
                  <span className="truncate font-heading text-xs text-fd-muted-foreground">
                    {span.step}
                  </span>
                  <div className="h-6 bg-fd-secondary/60">
                    <div
                      className={cn(
                        "h-full",
                        span.ok ? "bg-primary/45" : "bg-red-500/45",
                      )}
                      style={{ width: span.pct }}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-right font-heading text-xs",
                      span.ok
                        ? "text-fd-muted-foreground"
                        : "font-bold text-red-500",
                    )}
                  >
                    {span.duration}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between rounded-md border-2 border-fd-border bg-fd-secondary/30 px-3 py-2 text-xs">
              <span className="font-bold uppercase tracking-wider">
                p95 duration
              </span>
              <span className="font-heading font-bold text-red-500">
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
/*  The Problem                                                        */
/* ------------------------------------------------------------------ */

const PROBLEMS = [
  {
    num: "01",
    title: "Black box pipelines",
    description:
      "Pipeline data is fragmented across systems, unstructured, and impossible for AI agents to reason about.",
  },
  {
    num: "02",
    title: "Hours lost debugging",
    description:
      "When pipelines fail, developers context-switch between dashboards, logs, and code. Teams lose hours every week.",
  },
  {
    num: "03",
    title: "Raw data, no understanding",
    description:
      "Existing tools expose raw logs and metrics but don't derive actionable signals or provide real understanding.",
  },
];

function ProblemSection() {
  return (
    <section>
      <div className="mx-auto max-w-7xl">
        <p className="mb-3 font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
          The problem
        </p>
        <h2 className="font-heading text-3xl uppercase leading-[0.95] sm:text-4xl md:text-5xl lg:text-6xl everr-decoration everr-decoration-primary">
          CI/CD is critical infrastructure with zero visibility
        </h2>
        <p className="mt-4 max-w-3xl text-lg text-fd-muted-foreground">
          AI coding tools are accelerating code production dramatically.
          Validation and delivery pipelines are becoming the{" "}
          <strong className="text-fd-foreground">new bottleneck</strong>.
        </p>

        <div className="mt-16 grid grid-cols-1 gap-10 md:mt-20 md:grid-cols-3 md:gap-0">
          {PROBLEMS.map((item, i) => {
            const isLast = i === PROBLEMS.length - 1;
            return (
              <div
                key={item.num}
                className={cn(
                  !isLast &&
                    "border-b-2 border-fd-border pb-10 md:border-b-0 md:border-r-2 md:pb-0 md:pr-10",
                  i > 0 && "md:pl-10",
                )}
              >
                <span className="font-heading text-[11px] font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/40">
                  {item.num}
                </span>
                <h3 className="mt-2 text-xl font-bold font-heading everr-decoration everr-decoration-primary">
                  {item.title}
                </h3>
                <p className="mt-2 leading-relaxed text-fd-muted-foreground">
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
/*  The Missing Layer                                                  */
/* ------------------------------------------------------------------ */

function MissingLayerSection() {
  return (
    <section>
      <div className="mx-auto max-w-7xl">
        <p className="mb-3 font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
          The approach
        </p>
        <h2 className="font-heading text-3xl uppercase leading-[0.95] sm:text-4xl md:text-5xl lg:text-6xl">
          The missing{" "}
          <span className="relative inline-block px-2 sm:px-3">
            <span className="absolute inset-x-0 top-0 bottom-0 bg-primary" />
            <span className="relative text-primary-foreground everr-decoration">
              layer
            </span>
          </span>
        </h2>
        <p className="mt-4 max-w-3xl text-lg text-fd-muted-foreground">
          Everr turns your CI/CD pipelines into{" "}
          <strong className="text-fd-foreground">
            fully observable systems
          </strong>
          . Structured data, actionable signals, and deep context - available to
          your team and your AI tools.
        </p>

        {/* What Everr does - four pillars */}
        <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-md border-2 border-primary/60 bg-fd-border sm:grid-cols-2 md:mt-20">
          {[
            {
              label: "Structured telemetry",
              heading: "Every run, fully traced",
              body: "Workflow runs become OpenTelemetry traces. Steps, jobs, durations, and outcomes - all in a structured, queryable format.",
            },
            {
              label: "Enriched context",
              heading: "From telemetry to context",
              body: "Data is automatically enriched with commit info, branch context, and environment metadata.",
            },
            {
              label: "Derived signals",
              heading: "Not just another dashboard",
              body: "Flakiness scores, performance trends, failure patterns, and cost anomalies - derived automatically from your pipeline history.",
            },
            {
              label: "Human + AI native",
              heading: "Built for both audiences",
              body: "A web dashboard for your team. A CLI and structured APIs for your AI coding assistants. Same data, every interface.",
            },
          ].map((item) => (
            <div key={item.label} className="bg-fd-background p-6 md:p-8">
              <span className="font-heading text-[10px] font-bold uppercase tracking-wider text-primary">
                {item.label}
              </span>
              <h3 className="mt-3 font-heading text-xl font-bold everr-decoration everr-decoration-primary">
                {item.heading}
              </h3>
              <p className="mt-2 leading-relaxed text-fd-muted-foreground">
                {item.body}
              </p>
            </div>
          ))}
        </div>

        {/* Detect · Explain · Resolve */}
        <div className="mt-20">
          <h3 className="font-heading text-2xl uppercase sm:text-3xl md:text-4xl everr-decoration everr-decoration-primary">
            <span className="">Detect</span>
            <span className="text-fd-muted-foreground/40"> · </span>
            <span className="">Explain</span>
            <span className="text-fd-muted-foreground/40"> · </span>
            <span className="">Resolve</span>
          </h3>

          <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-0">
            {[
              {
                title: "Automatic detection",
                description:
                  "Failure patterns, flakiness, performance regressions, and cost anomalies - surfaced automatically from your pipeline data.",
              },
              {
                title: "Root cause analysis",
                description:
                  "Structured signals enriched with historical context. Know exactly what broke, when it started, and why.",
              },
              {
                title: "AI-native resolution",
                description:
                  "Engineers fix pipeline issues in minutes instead of hours. AI agents resolve them autonomously before they become problems.",
              },
            ].map((item, i) => {
              const isLast = i === 2;
              return (
                <div
                  key={item.title}
                  className={cn(
                    !isLast &&
                      "border-b-2 border-fd-border pb-10 md:border-b-0 md:border-r-2 md:pb-0 md:pr-10",
                    i > 0 && "md:pl-10",
                  )}
                >
                  <h4 className="font-heading text-lg font-bold everr-decoration everr-decoration-primary">
                    {item.title}
                  </h4>
                  <p className="mt-2 leading-relaxed text-fd-muted-foreground">
                    {item.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  How It Works                                                       */
/* ------------------------------------------------------------------ */

function HowItWorksSection() {
  return (
    <section>
      <div className="mx-auto max-w-7xl">
        <p className="mb-3 font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
          Get started
        </p>

        <h2 className="font-heading text-3xl uppercase leading-[0.95] sm:text-4xl md:text-5xl lg:text-6xl everr-decoration everr-decoration-primary">
          <span className="relative inline-block">
            <span className="absolute inset-x-0 top-0 bottom-0 bg-primary" />
            <span className="relative text-primary-foreground">
              Zero-config
            </span>
          </span>{" "}
          setup
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-fd-muted-foreground">
          From zero to full pipeline observability in under five minutes.
        </p>

        <div className="mt-16 flex flex-col gap-6 md:mt-20 md:gap-8">
          {/* Step 01 - Connect */}
          <div className="overflow-hidden rounded-md border-2 border-fd-border">
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="flex flex-col justify-center border-b-2 border-fd-border p-8 md:border-r-2 md:border-b-0 md:p-12">
                <span className="font-heading text-[64px] leading-none text-primary/20 md:text-[80px]">
                  01
                </span>
                <h3 className="mt-4 text-2xl font-bold font-heading sm:text-3xl">
                  Connect your CI
                </h3>
                <p className="mt-3 text-lg leading-relaxed text-fd-muted-foreground">
                  One click. No YAML. No config files. Connect GitHub Actions
                  and start collecting structured telemetry from every workflow
                  run.
                </p>
              </div>
              <div className="p-6 md:p-8">
                <ConnectProvidersViz />
              </div>
            </div>
          </div>

          {/* Step 02 - See (reversed layout) */}
          <div className="overflow-hidden rounded-md border-2 border-fd-border">
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="order-2 p-6 md:order-1 md:p-8">
                <RunsAndTestsViz />
              </div>
              <div className="order-1 flex flex-col justify-center border-b-2 border-fd-border p-8 md:order-2 md:border-l-2 md:border-b-0 md:p-12">
                <span className="font-heading text-[64px] leading-none text-primary/20 md:text-[80px]">
                  02
                </span>
                <h3 className="mt-4 text-2xl font-bold font-heading sm:text-3xl">
                  Trigger your workflow
                </h3>
                <p className="mt-3 text-lg leading-relaxed text-fd-muted-foreground">
                  Push code and Everr traces every workflow run automatically.
                  Test results, durations, and failure patterns collected and
                  structured without any extra configuration.
                </p>
              </div>
            </div>
          </div>

          {/* Step 03 - Fix */}
          <div className="overflow-hidden rounded-md border-2 border-fd-border">
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="flex flex-col justify-center border-b-2 border-fd-border p-8 md:border-r-2 md:border-b-0 md:p-12">
                <span className="font-heading text-[64px] leading-none text-primary/20 md:text-[80px]">
                  03
                </span>
                <h3 className="mt-4 text-2xl font-bold font-heading sm:text-3xl">
                  Fix from where your work happens
                </h3>
                <p className="mt-3 text-lg leading-relaxed text-fd-muted-foreground">
                  Wait for CI without context switching. When failure hit, your
                  assistant pinpoints the root cause and can fix it.
                </p>
              </div>
              <div className="p-6 md:p-8">
                <CodeAssistantViz />
              </div>
            </div>
          </div>
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
      <div className="flex h-120 flex-col overflow-hidden rounded-md border-2 border-fd-border bg-fd-card">
        <div className="flex h-12 shrink-0 items-center border-b-2 border-fd-border bg-fd-secondary/50 pl-4">
          <span className="font-heading text-xs font-bold uppercase tracking-wider text-fd-muted-foreground">
            Integrations
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 p-5">
          {CI_PROVIDERS.map((provider) => (
            <div
              key={provider.name}
              className={cn(
                "flex flex-col gap-2 rounded-md border-2 p-4",
                provider.status === "connected"
                  ? "border-primary/30 bg-primary/5"
                  : "border-fd-border bg-fd-secondary/30",
              )}
            >
              <span className="font-heading text-[13px] font-bold">
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
      <div className="flex flex-col overflow-hidden rounded-md border-2 border-fd-border bg-fd-card">
        <div className="border-b-2 border-fd-border bg-fd-secondary/50 px-5 py-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-fd-muted-foreground">
            Recent runs
          </span>
        </div>

        {/* Expanded run with test results */}
        <div className="border-b border-fd-border/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold">ci / build-and-test</span>
            <span className="inline-flex items-center gap-0.75 border border-red-500/15 bg-red-500/5 px-1.5 py-px text-[10px] font-bold uppercase text-red-500">
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
          <div className="mt-1.5 flex items-center gap-1.5 font-heading text-[11px] text-fd-muted-foreground">
            <span className="border border-fd-border bg-fd-card px-1.5 py-px text-[10px] font-bold">
              b68df0d
            </span>
            <span className="text-fd-border">&middot;</span>
            <span>2m ago</span>
            <span className="text-fd-border">&middot;</span>
            <span>main</span>
          </div>

          <div className="mt-3 overflow-hidden rounded-md border-2 border-fd-border bg-fd-secondary/20">
            <div className="grid grid-cols-[1fr_52px_44px_44px] gap-1 border-b border-fd-border/50 px-3 py-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-fd-muted-foreground">
                Test results - 3212 passed · 1 failed · 1 flaky
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
                    className={cn(
                      "inline-block size-1.5 shrink-0",
                      test.status === "passed"
                        ? "bg-green-500"
                        : test.status === "failed"
                          ? "bg-red-500"
                          : "bg-yellow-500",
                    )}
                  />
                  <span className="truncate font-heading text-[11px]">
                    {test.name}
                  </span>
                </div>
                <span className="text-right font-heading text-[11px] text-fd-muted-foreground">
                  {test.success}
                </span>
                <span className="text-right font-heading text-[11px] text-fd-muted-foreground">
                  {test.p50}
                </span>
                <span className="text-right font-heading text-[11px] text-fd-muted-foreground">
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
              <span className="inline-flex items-center gap-0.75 border border-green-500/15 bg-green-500/5 px-1.5 py-px text-[10px] font-bold uppercase text-green-400">
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
            <div className="mt-1.5 flex items-center gap-1.5 font-heading text-[11px] text-fd-muted-foreground">
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
      <div className="relative flex h-[430px] w-[580px] shrink-0 flex-col gap-2 overflow-hidden rounded-md border-2 border-fd-border bg-fd-card px-5 pb-4 pt-14 font-heading text-[10px] leading-4 text-fd-foreground sm:text-[11px]">
        <div className="absolute left-4 top-3 z-10 lg:right-4 lg:left-auto">
          <span className="inline-flex items-center rounded-md border-2 border-fd-border bg-fd-secondary/70 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-fd-foreground">
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
      "Every workflow run traced as OpenTelemetry spans. Navigate the waterfall, see which step failed, and jump to logs in milliseconds.",
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
      "Monitor p50/p95 durations over time. Catch performance regressions before they become 20-minute build queues.",
  },
];

function WhySection() {
  return (
    <section>
      <div className="mx-auto max-w-7xl">
        <p className="mb-3 font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
          Why Everr
        </p>
        <h2 className="font-heading text-3xl uppercase leading-[0.95] sm:text-4xl md:text-5xl lg:text-6xl everr-decoration everr-decoration-primary">
          Questions you shouldn't have to ask
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-fd-muted-foreground">
          AI-assisted development compresses release cycles, but broken
          pipelines still break your flow. Everr gives you the signals to fix
          them fast.
        </p>

        <div className="mt-16 grid gap-10 md:mt-20 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:gap-12">
          {WHY_ITEMS.map((item, i) => (
            <div key={item.num} className="contents">
              <div>
                <span className="font-heading text-[11px] font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/40">
                  {item.num}
                </span>
                <h3 className="mt-2 mb-3 text-lg font-heading italic font-bold">
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
/*  Pricing                                                            */
/* ------------------------------------------------------------------ */

const PRICING_TIERS = [
  {
    name: "Free",
    tagline: "For individuals and small projects getting started.",
    price: "$0",
    priceSuffix: "/ forever",
    cta: "Join the waitlist",
    featured: false,
    features: [
      "Unlimited repositories",
      "Unlimited local telemetry",
      "AI-native CLI and structured APIs",
      "Community support on Discord",
    ],
  },
  {
    name: "Pro",
    tagline: "For teams who ship continuously and need deep signal.",
    price: "$49",
    priceSuffix: "/ month",
    cta: "Join the waitlist",
    featured: true,
    features: [
      "Everything in Free",
      "Premium support",
      "White-glove onboarding",
    ],
  },
];

function PricingSection() {
  return (
    <section>
      <div className="mx-auto max-w-7xl">
        <p className="mb-3 font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
          Pricing
        </p>
        <h2 className="font-heading text-3xl uppercase leading-[0.95] sm:text-4xl md:text-5xl lg:text-6xl">
          Simple,{" "}
          <span className="relative inline-block px-2 sm:px-3">
            <span className="absolute inset-x-0 bottom-0 top-0 bg-primary" />
            <span className="relative text-primary-foreground everr-decoration">
              honest
            </span>
          </span>{" "}
          pricing
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-fd-muted-foreground">
          Start free. Upgrade when your team needs premium support and hands-on
          onboarding.
        </p>

        <div className="mt-16 grid grid-cols-1 gap-6 md:mt-20 md:grid-cols-2 md:gap-8">
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-md border-2 border-fd-border bg-fd-background",
                tier.featured && "border-primary",
              )}
            >
              {tier.featured && (
                <span className="absolute right-6 top-6 rounded-sm bg-primary px-3 py-1 font-heading text-[10px] font-bold uppercase tracking-[0.25em] text-primary-foreground">
                  Recommended
                </span>
              )}

              <div className="border-b-2 border-fd-border p-8 md:p-10">
                <h3 className="font-heading text-2xl font-bold uppercase tracking-wider">
                  {tier.name}
                </h3>
                <p className="mt-3 leading-relaxed text-fd-muted-foreground">
                  {tier.tagline}
                </p>
                <div className="mt-8 flex items-baseline gap-2">
                  <span className="font-heading text-5xl font-bold leading-none md:text-6xl">
                    {tier.price}
                  </span>
                  <span className="font-heading text-xs font-bold uppercase tracking-wider text-fd-muted-foreground">
                    {tier.priceSuffix}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-8 md:p-10">
                <ul className="space-y-3">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-3 text-[15px] leading-relaxed"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          `mt-0.75 inline-flex size-4 shrink-0 items-center justify-center font-heading text-[11px] font-bold`,
                          tier.featured
                            ? "bg-primary text-primary-foreground"
                            : "bg-fd-secondary text-fd-foreground",
                        )}
                      >
                        &#10003;
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="grow" />
                <div className="mt-10 pt-2">
                  <Button
                    variant={tier.featured ? "cta" : "outline"}
                    size="xl"
                    nativeButton={false}
                    className="w-full"
                    render={
                      <Link
                        to="/waitlist"
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                  >
                    {tier.cta}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-10 font-heading text-[11px] uppercase tracking-[0.25em] text-fd-muted-foreground/40">
          Need something custom?{" "}
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fd-foreground underline-offset-4 hover:underline"
          >
            Talk to us on Discord
          </a>
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Community                                                          */
/* ------------------------------------------------------------------ */

function CommunitySection() {
  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground selection:bg-primary-foreground selection:text-primary">
      {/* Oversized decorative Discord icon */}
      <SiDiscord
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-16 size-85 text-primary-foreground/10 sm:-right-8 sm:size-105 md:-right-4 md:size-130"
      />

      <div className="relative mx-auto max-w-7xl px-6 py-16 sm:py-20 md:py-28">
        <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-primary-foreground/60">
          Community
        </p>

        <h2 className="mt-4 max-w-3xl font-heading text-4xl uppercase leading-[0.9] sm:text-5xl md:text-6xl lg:text-7xl">
          Talk to the team.
          <br />
          Shape what ships next.
        </h2>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-primary-foreground/80 md:text-xl">
          It's where we talk with the people using Everr. Drop feature requests,
          share feedback, and weigh in on what we build next.
        </p>

        <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center md:mt-12">
          <Button
            variant="outline"
            size="xl"
            nativeButton={false}
            className="border-2 border-primary-foreground bg-primary-foreground text-primary hover:bg-primary-foreground/90 hover:text-primary focus-visible:ring-primary-foreground ring-offset-primary focus-visible:border-primary-foreground"
            render={
              // biome-ignore lint/a11y/useAnchorContent: content is injected
              <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            <SiDiscord className="size-5" />
            Join Us on Discord
          </Button>
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
        <h2 className="font-heading text-4xl uppercase leading-[0.9] sm:text-5xl md:text-7xl">
          Stop guessing
          <br />
          <span className="relative inline-block px-4">
            <span className="absolute inset-x-0 top-0 bottom-0 bg-primary" />
            <span className="relative text-primary-foreground everr-decoration">
              Start observing
            </span>
          </span>
        </h2>
        <p className="mt-6 max-w-xl text-lg text-fd-muted-foreground">
          Connect your GitHub Actions and get structured pipeline intelligence
          in minutes. Free to get started.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <Button
            variant="cta"
            size="xl"
            nativeButton={false}
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
            nativeButton={false}
            render={<Link to="/docs/$" params={{ _splat: "" }} />}
          >
            Documentation
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
        <div className="mx-auto w-full max-w-7xl px-6">
          <HeroSection />
          <ProductVisualization />
        </div>

        <div className="mx-auto w-full max-w-7xl px-6 bt-4 pb-16 sm:py-16 md:py-32">
          <div className="flex flex-col gap-16 md:gap-32">
            <ProblemSection />

            <div className="h-0.5 w-full bg-fd-border" />

            <MissingLayerSection />

            <div className="h-0.5 w-full bg-fd-border" />

            <HowItWorksSection />

            <div className="h-0.5 w-full bg-fd-border" />

            <WhySection />

            <div className="h-0.5 w-full bg-fd-border" />

            <PricingSection />
          </div>
        </div>

        <CommunitySection />

        <div className="mx-auto w-full max-w-7xl px-6 py-16 md:py-32">
          <BottomCTA />
        </div>
      </main>

      <Footer />
    </>
  );
}
