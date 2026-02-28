import {
  SiGithubactions,
  SiGitlab,
  SiJenkins,
} from "@icons-pack/react-simple-icons";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Citrus } from "lucide-react";
import { forwardRef, type ReactNode, useRef } from "react";
import { AnimatedBeam } from "@/components/animated-beam";
import { Footer } from "@/components/footer";
import OtelLogo from "@/components/otel-logo.svg?react";

export const Route = createFileRoute("/")({
  component: Home,
});

const APP_URL = "https://app.everr.dev";

/* ------------------------------------------------------------------ */
/*  Hero Section                                                      */
/* ------------------------------------------------------------------ */

function HeroSection() {
  return (
    <section className="flex flex-col items-center">
      <div className="flex w-full flex-col items-center">
        {/* Headline */}
        <h1 className="font-headline mb-8 text-center text-4xl leading-none sm:text-5xl md:text-7xl">
          Every pipeline tells a story.
          <br />
          Now you can trace it.
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mb-8 max-w-3xl text-center text-lg text-fd-muted-foreground sm:text-xl">
          Everr collects telemetry from your CI/CD pipelines and turns workflow
          runs into OpenTelemetry traces. Debug failures, spot regressions, and
          track flaky tests — all from one dashboard.
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <a
            href={APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center rounded-lg bg-everr-deep px-6 text-sm font-medium text-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-everr-deep/30"
          >
            Get started
          </a>
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className="inline-flex h-12 items-center rounded-lg border border-fd-border bg-fd-card px-6 text-sm font-medium transition-colors hover:bg-fd-accent"
          >
            Read the docs
          </Link>
        </div>

        {/* Badge line */}
        <p className="mt-4 text-sm text-fd-muted-foreground">
          Open source &middot; Built on OpenTelemetry
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  3D Product Visualization                                          */
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
    <div className="mx-auto mt-12 w-full max-w-5xl">
      <div className="product-perspective">
        <div className="product-tilt">
          {/* Terminal chrome bar */}
          <div className="flex h-10 items-center gap-[6px] border-b border-fd-border bg-fd-secondary/50 px-[14px]">
            <div className="mr-2 flex gap-[6px]">
              <div className="size-2 rounded-full bg-fd-border" />
              <div className="size-2 rounded-full bg-fd-border" />
              <div className="size-2 rounded-full bg-fd-border" />
            </div>
            <span className="font-mono text-xs text-fd-muted-foreground/50">
              everr
            </span>
            <span className="font-mono text-[11px] text-fd-muted-foreground/50">
              /
            </span>
            <span className="font-mono text-xs text-fd-muted-foreground">
              traces
            </span>
          </div>

          {/* Trace waterfall content */}
          <div className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-md bg-everr/10 px-2 py-1 font-mono text-xs text-everr-deep">
                workflow run #29184
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
                  <div className="h-6 rounded bg-fd-secondary/60">
                    <div
                      className={`h-full rounded ${span.ok ? "bg-everr/45" : "bg-red-500/45"}`}
                      style={{ width: span.pct }}
                    />
                  </div>
                  <span
                    className={`text-right font-mono text-xs ${
                      span.ok
                        ? "text-fd-muted-foreground"
                        : "font-semibold text-red-500"
                    }`}
                  >
                    {span.duration}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between rounded-lg border border-fd-border bg-fd-secondary/30 px-3 py-2 text-xs">
              <span className="font-medium">p95 duration</span>
              <span className="font-mono text-red-500">+18.7% vs baseline</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  "How It Works" Feature Grid                                       */
/* ------------------------------------------------------------------ */

function HowItWorksSection() {
  return (
    <section>
      <div className="mx-auto max-w-7xl">
        <span className="mb-3 block font-mono text-sm uppercase text-fd-muted-foreground">
          How it works
        </span>
        <h2 className="font-headline mb-3 text-3xl sm:text-4xl">
          From pipeline to insight in seconds
        </h2>
        <p className="mb-12 max-w-2xl text-lg text-fd-muted-foreground">
          Everr hooks into your existing CI/CD systems. No code changes, no new
          configs — just connect and start tracing.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Card 1: Connect */}
          <div className="border-b border-fd-border pb-8 md:border-r md:pr-8">
            <div className="mb-4 flex items-center justify-center">
              <div
                className="relative h-96 w-full overflow-hidden rounded-[10px] bg-fd-background"
                style={{
                  maskImage:
                    "linear-gradient(black 50%, rgba(0,0,0,0.5) 75%, transparent 100%)",
                }}
              >
                <div className="flex h-[480px] flex-col overflow-hidden rounded-[10px] border border-fd-border bg-fd-card">
                  <div className="flex h-12 shrink-0 items-center gap-[7px] border-b border-fd-border bg-fd-secondary/50 pl-4 pr-2">
                    <div className="size-[11px] rounded-full bg-fd-border" />
                    <div className="size-[11px] rounded-full bg-fd-border" />
                    <div className="size-[11px] rounded-full bg-fd-border" />
                    <span className="ml-2 font-mono text-xs text-fd-muted-foreground">
                      Terminal
                    </span>
                  </div>
                  <div className="p-5 font-mono text-[13px] leading-[1.8]">
                    <span className="block whitespace-nowrap">
                      <span className="text-fd-muted-foreground">
                        my-project
                      </span>{" "}
                      <span className="mr-0.5 text-everr-deep">%</span>{" "}
                      <span>everr connect</span>
                    </span>
                    <span className="block whitespace-nowrap">&nbsp;</span>
                    <span className="block whitespace-nowrap">
                      <span className="text-fd-muted-foreground">
                        Connecting to GitHub Actions...
                      </span>
                    </span>
                    <span className="block whitespace-nowrap">&nbsp;</span>
                    <span className="block whitespace-nowrap">
                      <span className="text-everr-deep">&#10003;</span>{" "}
                      <span className="text-fd-muted-foreground">
                        Webhook configured
                      </span>
                    </span>
                    <span className="block whitespace-nowrap">
                      <span className="text-everr-deep">&#10003;</span>{" "}
                      <span className="text-fd-muted-foreground">
                        Traces streaming
                      </span>{" "}
                      <span className="text-fd-muted-foreground/50">
                        (3 workflows detected)
                      </span>
                    </span>
                    <span className="block whitespace-nowrap">&nbsp;</span>
                    <span className="block whitespace-nowrap">
                      <span className="text-everr-deep">Ready.</span>
                    </span>
                    <span className="block whitespace-nowrap">&nbsp;</span>
                    <span className="block whitespace-nowrap">
                      <span className="text-fd-muted-foreground">
                        my-project
                      </span>{" "}
                      <span className="mr-0.5 text-everr-deep">%</span>{" "}
                      <span
                        className="ml-0.5 inline-block h-[16px] w-[8px] bg-fd-muted-foreground align-text-bottom"
                        style={{
                          animation:
                            "1.1s step-end 0s infinite normal none running terminal-blink",
                        }}
                      />
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <h3 className="font-headline mb-1 text-xl">
              Connect your CI provider
            </h3>
            <p className="leading-relaxed text-fd-muted-foreground">
              Point your GitHub Actions webhooks at Everr. One URL, zero
              workflow changes.
            </p>
          </div>

          {/* Card 2: CI systems */}
          <div className="border-b border-fd-border pb-8 pt-8 md:pl-8 md:pt-0">
            <div className="mb-4 flex items-center justify-center">
              <div className="relative h-96 w-full overflow-hidden rounded-[10px] bg-fd-background">
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1/2"
                  style={{
                    background:
                      "linear-gradient(to bottom, transparent 0%, var(--color-fd-background) 100%)",
                  }}
                />
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 z-10 w-1/2"
                  style={{
                    background:
                      "linear-gradient(to right, transparent 0%, var(--color-fd-background) 100%)",
                  }}
                />
                <div className="flex flex-col overflow-hidden rounded-[10px] border border-fd-border bg-fd-card">
                  <div className="grid grid-cols-[3fr_2fr] border-b border-fd-border bg-fd-secondary/50 px-5 py-2.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-fd-muted-foreground">
                      CI System
                    </span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-fd-muted-foreground">
                      Status
                    </span>
                  </div>
                  {[
                    { name: "GitHub Actions", supported: true },
                    { name: "GitLab CI", supported: false },
                    { name: "Jenkins", supported: false },
                    { name: "CircleCI", supported: false },
                    { name: "Buildkite", supported: false },
                  ].map((ci) => (
                    <div
                      key={ci.name}
                      className="grid grid-cols-[3fr_2fr] items-center border-b border-fd-border/50 px-5 py-3.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`size-2 shrink-0 rounded-full ${ci.supported ? "bg-everr-deep" : "bg-fd-border"}`}
                        />
                        <span className="text-[13px] font-medium">
                          {ci.name}
                        </span>
                      </div>
                      <div>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                            ci.supported
                              ? "bg-green-500/10 text-green-600 dark:text-green-400"
                              : "bg-fd-secondary/50 text-fd-muted-foreground"
                          }`}
                        >
                          {ci.supported ? "Supported" : "Planned"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <h3 className="font-headline mb-1 text-xl">
              Works with any CI system
            </h3>
            <p className="leading-relaxed text-fd-muted-foreground">
              GitHub Actions fully supported. GitLab CI, Jenkins, and more
              coming soon.
            </p>
          </div>

          {/* Card 3: OTel native */}
          <div className="border-b border-fd-border pb-8 pt-8 md:border-b-0 md:border-r md:pb-0 md:pr-8">
            <div className="mb-4">
              <OTelTopologyViz />
            </div>
            <h3 className="font-headline mb-1 text-xl">OpenTelemetry native</h3>
            <p className="leading-relaxed text-fd-muted-foreground">
              Pipeline telemetry normalized into OTel traces stored in
              ClickHouse. Query with standard tooling.
            </p>
          </div>

          {/* Card 4: History */}
          <div className="pt-8 md:pl-8">
            <div className="mb-4 flex items-center justify-center">
              <div className="relative h-96 w-full overflow-hidden rounded-[10px] bg-fd-background">
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 z-10 w-1/2"
                  style={{
                    background:
                      "linear-gradient(to right, transparent 0%, var(--color-fd-background) 100%)",
                  }}
                />
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1/2"
                  style={{
                    background:
                      "linear-gradient(to bottom, transparent 0%, var(--color-fd-background) 100%)",
                  }}
                />
                <div className="flex w-[580px] shrink-0 flex-col overflow-hidden rounded-[10px] border border-fd-border bg-fd-card">
                  {[
                    {
                      title: "ci / build-and-test",
                      hash: "b68df0d",
                      time: "2m ago",
                      status: "failed",
                      branch: "main",
                    },
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
                    {
                      title: "ci / build-and-test",
                      hash: "c4d82f6",
                      time: "2h ago",
                      status: "flaky",
                      branch: "main",
                    },
                    {
                      title: "ci / deploy-production",
                      hash: "d59f1a4",
                      time: "3h ago",
                      status: "passed",
                      branch: "main",
                    },
                  ].map((run, i) => (
                    <div
                      key={run.hash}
                      className={`cursor-pointer px-4 py-3 transition-colors ${i > 0 ? "border-t border-fd-border/50" : ""}`}
                    >
                      <div className="whitespace-nowrap text-[13px] font-medium">
                        {run.title}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-fd-muted-foreground">
                        <span className="inline-flex items-center rounded-[5px] border border-fd-border bg-fd-card px-1.5 py-px text-[10px] text-fd-muted-foreground">
                          {run.hash}
                        </span>
                        <span className="text-fd-border">&middot;</span>
                        <span>{run.time}</span>
                        <span className="text-fd-border">&middot;</span>
                        <span>{run.branch}</span>
                        <span className="text-fd-border">&middot;</span>
                        <span
                          className={`inline-flex items-center gap-[3px] rounded-[5px] border px-1.5 py-px text-[10px] ${
                            run.status === "failed"
                              ? "border-red-500/15 bg-red-500/5 text-red-500"
                              : run.status === "flaky"
                                ? "border-yellow-500/15 bg-yellow-500/5 text-yellow-500"
                                : "border-green-500/15 bg-green-500/5 text-green-500 dark:text-green-400"
                          }`}
                        >
                          {/** biome-ignore lint/a11y/noSvgWithoutTitle: just a decorative SVG */}
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
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <h3 className="font-headline mb-1 text-xl">
              See your entire CI history
            </h3>
            <p className="leading-relaxed text-fd-muted-foreground">
              Every workflow run traced end-to-end. Search, filter, and
              understand failures.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated Beam Topology                                            */
/* ------------------------------------------------------------------ */

const BeamCircle = forwardRef<
  HTMLDivElement,
  { className?: string; children?: ReactNode }
>(({ className, children }, ref) => (
  <div
    ref={ref}
    className={`z-10 flex size-12 items-center justify-center rounded-full border-2 border-fd-border bg-fd-card p-3 shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] ${className ?? ""}`}
  >
    {children}
  </div>
));
BeamCircle.displayName = "BeamCircle";

function OTelTopologyViz() {
  const containerRef = useRef<HTMLDivElement>(null);
  const ghaRef = useRef<HTMLDivElement>(null);
  const gitlabRef = useRef<HTMLDivElement>(null);
  const jenkinsRef = useRef<HTMLDivElement>(null);
  const otelRef = useRef<HTMLDivElement>(null);
  const everrRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="relative flex h-[250px] w-full items-center justify-center overflow-hidden px-4 sm:px-8"
    >
      <div className="flex size-full max-w-2xl flex-row items-stretch justify-between gap-10">
        <div className="flex flex-col justify-center gap-3">
          <BeamCircle ref={ghaRef}>
            <SiGithubactions className="size-5" />
          </BeamCircle>
          <BeamCircle ref={gitlabRef}>
            <SiGitlab className="size-5" />
          </BeamCircle>
          <BeamCircle ref={jenkinsRef}>
            <SiJenkins className="size-5" />
          </BeamCircle>
        </div>

        <div className="flex flex-col justify-center">
          <BeamCircle ref={otelRef} className="size-16">
            <div className="flex flex-col items-center gap-1">
              <OtelLogo className="size-6" />
              <span className="text-[9px] font-semibold leading-none">
                OTel
              </span>
            </div>
          </BeamCircle>
        </div>

        <div className="flex flex-col justify-center">
          <BeamCircle ref={everrRef}>
            <div className="flex flex-col items-center gap-1">
              <Citrus className="size-4 text-everr-deep" />
              <span className="text-[9px] font-semibold leading-none">
                Everr
              </span>
            </div>
          </BeamCircle>
        </div>
      </div>

      <AnimatedBeam
        containerRef={containerRef}
        fromRef={ghaRef}
        toRef={otelRef}
        pathColor="#f97316"
        gradientStartColor="#f97316"
        gradientStopColor="#fb923c"
        duration={5}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={gitlabRef}
        toRef={otelRef}
        pathColor="#f97316"
        gradientStartColor="#f97316"
        gradientStopColor="#fb923c"
        duration={5.2}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={jenkinsRef}
        toRef={otelRef}
        pathColor="#f97316"
        gradientStartColor="#f97316"
        gradientStopColor="#fb923c"
        duration={5.6}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={otelRef}
        toRef={everrRef}
        pathColor="#ea580c"
        gradientStartColor="#ea580c"
        gradientStopColor="#fb923c"
        duration={5.5}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  "Why Everr" Section                                               */
/* ------------------------------------------------------------------ */

const WHY_ITEMS = [
  {
    num: "01",
    question: '"Why did this pipeline break?"',
    answer:
      "Every workflow run traced as OTel spans. Navigate the waterfall, see which step failed, and jump to logs in seconds.",
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
        <span className="mb-3 block font-mono text-sm uppercase text-fd-muted-foreground">
          Why Everr
        </span>
        <h2 className="font-headline mb-3 max-w-[768px] text-3xl sm:text-4xl">
          Stop guessing, start tracing
        </h2>
        <p className="mb-12 max-w-[768px] text-lg text-fd-muted-foreground">
          AI-assisted development compresses release cycles, but broken
          pipelines still break your flow. Everr gives you the signals to fix
          them fast.
        </p>

        <div className="grid gap-8 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:gap-12">
          {WHY_ITEMS.map((item, i) => (
            <div key={item.num} className="contents">
              <div>
                <span className="mb-6 block font-mono text-5xl font-bold text-fd-muted-foreground/30">
                  {item.num}
                </span>
                <h3 className="font-headline mb-2 text-lg italic">
                  {item.question}
                </h3>
                <p className="leading-relaxed text-fd-muted-foreground">
                  {item.answer}
                </p>
              </div>
              {i < WHY_ITEMS.length - 1 && (
                <div className="hidden w-px border-l border-fd-border md:block" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Bottom CTA Section                                                */
/* ------------------------------------------------------------------ */

function BottomCTA() {
  return (
    <section>
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <h2 className="font-headline mb-3 text-3xl sm:text-4xl">
          Everry second counts.{" "}
          <span className="whitespace-nowrap">See where yours go.</span>
        </h2>
        <p className="mb-8 max-w-xl text-lg text-fd-muted-foreground">
          Connect your GitHub Actions and get OpenTelemetry traces in minutes.
          Free to get started.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <a
            href={APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center rounded-lg bg-everr-deep px-6 text-sm font-medium text-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-everr-deep/30"
          >
            Get started
          </a>
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className="inline-flex h-12 items-center rounded-lg border border-fd-border bg-fd-card px-6 text-sm font-medium transition-colors hover:bg-fd-accent"
          >
            Read the docs
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Home Page                                                         */
/* ------------------------------------------------------------------ */

function Home() {
  return (
    <>
      <main className="relative z-0 flex flex-1 flex-col overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 py-12 md:py-[120px]">
          <div className="flex flex-col gap-12 md:gap-24">
            <div>
              <HeroSection />
              <ProductVisualization />
            </div>

            <HowItWorksSection />

            <div className="mx-auto w-full max-w-7xl border-t border-fd-border" />

            <WhySection />

            <div className="mx-auto w-full max-w-7xl border-t border-fd-border" />

            <BottomCTA />
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
