import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Bug,
  ChevronRight,
  Database,
  Eye,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers,
  Radio,
  Search,
  Timer,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: Home,
});

function useReveal(threshold = 0.1) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(32px)",
        transition: `opacity 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}s, transform 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  delay = 0,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay}>
      <div className="group relative h-full rounded-2xl border border-fd-border bg-fd-card p-6 transition-all duration-300 hover:border-citric-deep/40 hover:shadow-lg hover:shadow-citric/5 hover:-translate-y-1">
        <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-citric/10 text-citric-deep transition-colors duration-300 group-hover:bg-citric/20">
          {icon}
        </div>
        <h3 className="mb-2 font-bold text-lg">{title}</h3>
        <p className="text-sm leading-relaxed text-fd-muted-foreground">
          {description}
        </p>
      </div>
    </Reveal>
  );
}

function StepCard({
  number,
  title,
  description,
  delay = 0,
}: {
  number: number;
  title: string;
  description: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className="flex flex-col items-center text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-citric-deep font-bold text-xl text-white">
        {number}
      </div>
      <h3 className="mb-2 font-bold text-lg">{title}</h3>
      <p className="max-w-xs text-sm leading-relaxed text-fd-muted-foreground">
        {description}
      </p>
    </Reveal>
  );
}

function TechBadge({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 rounded-full border border-fd-border bg-fd-card px-5 py-2.5 text-sm font-medium transition-colors hover:border-citric-deep/30">
      {icon}
      {label}
    </span>
  );
}

function Home() {
  return (
    <div className="flex flex-col overflow-x-hidden">
      {/* ── Hero ── */}
      <section className="relative flex flex-col items-center px-4 pb-24 pt-24 text-center sm:pt-32">
        <div className="pointer-events-none absolute -top-32 left-1/2 size-[800px] -translate-x-1/2 rounded-full bg-citric/8 blur-3xl animate-pulse-glow" />
        <div className="pointer-events-none absolute -top-20 left-1/4 size-[400px] -translate-x-1/2 rounded-full bg-citric-muted/10 blur-3xl animate-float" />

        <span
          className="relative mb-8 inline-flex items-center gap-2 rounded-full border border-citric-deep/20 bg-citric/10 px-4 py-1.5 text-sm font-medium text-citric-deep opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.1s" }}
        >
          <Radio className="size-4" />
          Powered by OpenTelemetry
        </span>

        <h1
          className="relative max-w-4xl text-4xl font-extrabold tracking-tight opacity-0 animate-fade-in-up sm:text-5xl md:text-6xl lg:text-7xl"
          style={{ animationDelay: "0.2s" }}
        >
          Stop Guessing Why Your{" "}
          <span className="bg-gradient-to-r from-citric-deep to-citric bg-clip-text text-transparent">
            Pipelines Fail
          </span>
        </h1>

        <p
          className="relative mt-6 max-w-2xl text-lg leading-relaxed text-fd-muted-foreground opacity-0 animate-fade-in-up sm:text-xl"
          style={{ animationDelay: "0.35s" }}
        >
          Citric brings full observability to your GitHub Actions workflows.
          Trace every job, track every test, catch every failure — all powered
          by OpenTelemetry and stored in ClickHouse.
        </p>

        <div
          className="relative mt-10 flex flex-wrap items-center justify-center gap-4 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.5s" }}
        >
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className="inline-flex items-center gap-2 rounded-xl bg-citric-deep px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-citric-deep/20 transition-all hover:shadow-xl hover:shadow-citric-deep/30 hover:-translate-y-0.5"
          >
            Get Started
            <ArrowRight className="size-4" />
          </Link>
          <a
            href="https://github.com/citric-app/citric"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-fd-border bg-fd-card px-6 py-3 text-sm font-semibold transition-all hover:bg-fd-accent hover:-translate-y-0.5"
          >
            View on GitHub
            <ChevronRight className="size-4" />
          </a>
        </div>
      </section>

      {/* ── Value Props ── */}
      <section className="mx-auto w-full max-w-5xl px-4 py-16">
        <div className="grid gap-8 sm:grid-cols-3">
          <Reveal delay={0} className="text-center">
            <div className="mb-3 flex justify-center">
              <div className="flex size-10 items-center justify-center rounded-lg bg-citric/10 text-citric-deep">
                <Eye className="size-5" />
              </div>
            </div>
            <h3 className="font-bold">Total Visibility</h3>
            <p className="mt-1 text-sm text-fd-muted-foreground">
              Every workflow, job, and step — traced and timed.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="text-center">
            <div className="mb-3 flex justify-center">
              <div className="flex size-10 items-center justify-center rounded-lg bg-citric/10 text-citric-deep">
                <Zap className="size-5" />
              </div>
            </div>
            <h3 className="font-bold">Instant Insights</h3>
            <p className="mt-1 text-sm text-fd-muted-foreground">
              Failure patterns, flaky tests, and regressions — surfaced
              automatically.
            </p>
          </Reveal>
          <Reveal delay={0.2} className="text-center">
            <div className="mb-3 flex justify-center">
              <div className="flex size-10 items-center justify-center rounded-lg bg-citric/10 text-citric-deep">
                <Timer className="size-5" />
              </div>
            </div>
            <h3 className="font-bold">Minutes to Set Up</h3>
            <p className="mt-1 text-sm text-fd-muted-foreground">
              Add the collector to your workflow. That&apos;s it.
            </p>
          </Reveal>
        </div>
      </section>

      <div className="mx-auto h-px w-full max-w-3xl bg-fd-border" />

      {/* ── Features Grid ── */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20">
        <Reveal>
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Everything You Need to{" "}
              <span className="text-citric-deep">Own Your Pipelines</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-fd-muted-foreground">
              From trace waterfalls to flaky test detection, Citric gives your
              team the tools to debug faster, ship with confidence, and
              eliminate CI/CD blind spots.
            </p>
          </div>
        </Reveal>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<Layers className="size-5" />}
            title="Trace Waterfall"
            description="Visualize your entire workflow as an interactive waterfall. See parent-child relationships between jobs and steps with precise timing."
            delay={0}
          />
          <FeatureCard
            icon={<FlaskConical className="size-5" />}
            title="Test Analytics"
            description="Track pass rates, duration trends, and identify your slowest tests. Know exactly which tests cost you the most time."
            delay={0.08}
          />
          <FeatureCard
            icon={<Bug className="size-5" />}
            title="Flaky Test Detection"
            description="Automatically identify tests that pass sometimes and fail others. Quantify flakiness rates and track improvements over time."
            delay={0.16}
          />
          <FeatureCard
            icon={<Search className="size-5" />}
            title="Failure Clustering"
            description="Stop sifting through logs. Recurring failures are automatically grouped into patterns so you fix root causes, not symptoms."
            delay={0.24}
          />
          <FeatureCard
            icon={<Gauge className="size-5" />}
            title="Performance Monitoring"
            description="Track P50, P95, and average durations across all pipelines. Catch regressions before they compound into major slowdowns."
            delay={0.32}
          />
          <FeatureCard
            icon={<BarChart3 className="size-5" />}
            title="Queue Time Analytics"
            description="Understand how long jobs wait before running. Identify runner bottlenecks and optimize your infrastructure allocation."
            delay={0.4}
          />
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="bg-fd-secondary/30 py-20">
        <div className="mx-auto max-w-4xl px-4">
          <Reveal>
            <h2 className="mb-16 text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
              Up and Running in{" "}
              <span className="text-citric-deep">Three Steps</span>
            </h2>
          </Reveal>
          <div className="grid gap-12 sm:grid-cols-3 sm:gap-8">
            <StepCard
              number={1}
              title="Install the Collector"
              description="Add the Citric OpenTelemetry collector to your infrastructure. It receives webhooks and fetches detailed pipeline data from GitHub."
              delay={0}
            />
            <StepCard
              number={2}
              title="Run Your Workflows"
              description="Every GitHub Actions run is automatically captured as OpenTelemetry traces and stored in ClickHouse. Zero code changes required."
              delay={0.12}
            />
            <StepCard
              number={3}
              title="See Everything"
              description="Open the dashboard and explore traces, test results, failure patterns, and performance trends across all your repositories."
              delay={0.24}
            />
          </div>
        </div>
      </section>

      {/* ── Deep Dive: Trace Waterfall ── */}
      <section className="mx-auto w-full max-w-5xl px-4 py-20">
        <Reveal>
          <div className="flex flex-col gap-8 md:flex-row md:items-center">
            <div className="flex-1">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-citric/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-citric-deep">
                <Layers className="size-3.5" />
                Tracing
              </div>
              <h3 className="text-2xl font-extrabold sm:text-3xl">
                Trace Waterfall Visualization
              </h3>
              <p className="mt-4 leading-relaxed text-fd-muted-foreground">
                Every workflow run becomes an interactive waterfall chart. Drill
                from a high-level overview down to individual command output.
                See which steps are slow, which are failing, and how they relate
                to each other — all in one view.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-fd-muted-foreground">
                <li className="flex items-center gap-2">
                  <ChevronRight className="size-4 shrink-0 text-citric-deep" />
                  Interactive span exploration with timing data
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="size-4 shrink-0 text-citric-deep" />
                  Expandable job steps with full log output
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="size-4 shrink-0 text-citric-deep" />
                  Visual parent-child span relationships
                </li>
              </ul>
            </div>
            <div className="flex-1 rounded-2xl border border-fd-border bg-fd-card p-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="w-16 font-mono text-xs text-fd-muted-foreground">
                    0.0s
                  </span>
                  <div className="relative h-7 flex-1 overflow-hidden rounded bg-citric/20">
                    <div className="absolute inset-y-0 left-0 w-full rounded bg-citric-deep/30" />
                    <span className="absolute inset-y-0 left-2 flex items-center text-xs font-medium">
                      build
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-16 font-mono text-xs text-fd-muted-foreground">
                    0.4s
                  </span>
                  <div className="relative ml-4 h-7 flex-1 overflow-hidden rounded bg-citric/15">
                    <div className="absolute inset-y-0 left-0 w-3/4 rounded bg-citric-dark/25" />
                    <span className="absolute inset-y-0 left-2 flex items-center text-xs font-medium">
                      checkout
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-16 font-mono text-xs text-fd-muted-foreground">
                    1.2s
                  </span>
                  <div className="relative ml-4 h-7 flex-1 overflow-hidden rounded bg-citric/15">
                    <div className="absolute inset-y-0 left-0 w-5/6 rounded bg-citric-dark/25" />
                    <span className="absolute inset-y-0 left-2 flex items-center text-xs font-medium">
                      install deps
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-16 font-mono text-xs text-fd-muted-foreground">
                    3.8s
                  </span>
                  <div className="relative ml-4 h-7 flex-1 overflow-hidden rounded bg-red-500/15">
                    <div className="absolute inset-y-0 left-0 w-1/2 rounded bg-red-500/25" />
                    <span className="absolute inset-y-0 left-2 flex items-center text-xs font-medium text-red-600 dark:text-red-400">
                      test
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Deep Dive: Test Analytics ── */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-20">
        <Reveal>
          <div className="flex flex-col gap-8 md:flex-row-reverse md:items-center">
            <div className="flex-1">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-citric/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-citric-deep">
                <FlaskConical className="size-3.5" />
                Testing
              </div>
              <h3 className="text-2xl font-extrabold sm:text-3xl">
                Intelligent Test Analytics
              </h3>
              <p className="mt-4 leading-relaxed text-fd-muted-foreground">
                Go beyond pass/fail. Citric tracks test execution across every
                run, identifies your slowest tests, detects flaky behavior
                automatically, and shows you exactly where reliability is
                trending.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-fd-muted-foreground">
                <li className="flex items-center gap-2">
                  <ChevronRight className="size-4 shrink-0 text-citric-deep" />
                  Pass rate and duration trends per test suite
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="size-4 shrink-0 text-citric-deep" />
                  Automatic flaky test detection and ranking
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="size-4 shrink-0 text-citric-deep" />
                  Slowest tests table for optimization targets
                </li>
              </ul>
            </div>
            <div className="flex-1 rounded-2xl border border-fd-border bg-fd-card p-6">
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-fd-secondary/50 p-3 text-center">
                    <div className="text-2xl font-bold text-citric-deep">
                      247
                    </div>
                    <div className="text-xs text-fd-muted-foreground">
                      Tests
                    </div>
                  </div>
                  <div className="rounded-lg bg-fd-secondary/50 p-3 text-center">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      98.4%
                    </div>
                    <div className="text-xs text-fd-muted-foreground">
                      Pass Rate
                    </div>
                  </div>
                  <div className="rounded-lg bg-fd-secondary/50 p-3 text-center">
                    <div className="text-2xl font-bold text-orange-500">3</div>
                    <div className="text-xs text-fd-muted-foreground">
                      Flaky
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono">auth.test.ts</span>
                    <span className="font-medium text-green-600 dark:text-green-400">
                      100%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-fd-secondary">
                    <div className="h-full w-full rounded-full bg-green-500/60" />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono">api.test.ts</span>
                    <span className="font-medium text-orange-500">94.2%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-fd-secondary">
                    <div className="h-full w-[94%] rounded-full bg-orange-400/60" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Deep Dive: Failure Analysis ── */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-20">
        <Reveal>
          <div className="flex flex-col gap-8 md:flex-row md:items-center">
            <div className="flex-1">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-citric/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-citric-deep">
                <Bug className="size-3.5" />
                Debugging
              </div>
              <h3 className="text-2xl font-extrabold sm:text-3xl">
                Smart Failure Analysis
              </h3>
              <p className="mt-4 leading-relaxed text-fd-muted-foreground">
                Stop reading log files line by line. Citric automatically
                clusters recurring failures, identifies patterns across
                repositories, and surfaces the most impactful issues — so your
                team fixes root causes, not symptoms.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-fd-muted-foreground">
                <li className="flex items-center gap-2">
                  <ChevronRight className="size-4 shrink-0 text-citric-deep" />
                  Automatic failure pattern clustering
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="size-4 shrink-0 text-citric-deep" />
                  Cross-repository failure correlation
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="size-4 shrink-0 text-citric-deep" />
                  Trend tracking for failure frequency
                </li>
              </ul>
            </div>
            <div className="flex-1 rounded-2xl border border-fd-border bg-fd-card p-6">
              <div className="space-y-3">
                {[
                  {
                    pattern: "ECONNREFUSED 127.0.0.1:5432",
                    count: 12,
                    repo: "api",
                  },
                  {
                    pattern: "timeout waiting for element",
                    count: 8,
                    repo: "web",
                  },
                  { pattern: "OOM killed", count: 5, repo: "worker" },
                ].map((f) => (
                  <div
                    key={f.pattern}
                    className="flex items-start gap-3 rounded-lg bg-fd-secondary/50 p-3"
                  >
                    <div className="mt-0.5 size-2 shrink-0 rounded-full bg-red-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs">
                        {f.pattern}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-fd-muted-foreground">
                        <span>{f.count} occurrences</span>
                        <span className="text-fd-border">&middot;</span>
                        <span>{f.repo}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Tech Stack ── */}
      <section className="bg-fd-secondary/30 py-20">
        <div className="mx-auto max-w-4xl px-4">
          <Reveal>
            <div className="text-center">
              <h2 className="mb-3 text-2xl font-extrabold sm:text-3xl">
                Built on Standards You Trust
              </h2>
              <p className="mx-auto mb-10 max-w-xl text-fd-muted-foreground">
                No proprietary agents, no vendor lock-in. Citric uses the
                open-source tools the industry relies on.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <TechBadge
                  icon={<Radio className="size-4 text-citric-deep" />}
                  label="OpenTelemetry"
                />
                <TechBadge
                  icon={<Database className="size-4 text-citric-deep" />}
                  label="ClickHouse"
                />
                <TechBadge
                  icon={<GitBranch className="size-4 text-citric-deep" />}
                  label="GitHub Actions"
                />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative overflow-hidden py-24">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-citric/5 to-transparent" />
        <Reveal className="relative mx-auto max-w-2xl px-4 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Ready to see your pipelines{" "}
            <span className="text-citric-deep">clearly</span>?
          </h2>
          <p className="mt-4 text-fd-muted-foreground">
            Set up Citric in minutes and never fly blind again.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/docs/$"
              params={{ _splat: "" }}
              className="inline-flex items-center gap-2 rounded-xl bg-citric-deep px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-citric-deep/20 transition-all hover:shadow-xl hover:shadow-citric-deep/30 hover:-translate-y-0.5"
            >
              Read the Docs
              <ArrowRight className="size-4" />
            </Link>
            <a
              href="https://github.com/citric-app/citric"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-fd-border bg-fd-card px-7 py-3.5 text-sm font-semibold transition-all hover:bg-fd-accent hover:-translate-y-0.5"
            >
              Star on GitHub
            </a>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
