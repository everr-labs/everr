import {
  SiGithubactions,
  SiGitlab,
  SiJenkins,
} from "@icons-pack/react-simple-icons";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Binary,
  Citrus,
  Clock3,
  Cpu,
  Database,
  FlaskConical,
  GitPullRequest,
  Radar,
  Server,
  ShieldCheck,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { forwardRef, type ReactNode, useMemo, useRef } from "react";
import {
  siBun,
  siDart,
  siDeno,
  siDotnet,
  siElixir,
  siFlutter,
  siGithubactions,
  siGitlab,
  siGleam,
  siGo,
  siJenkins,
  siJest,
  siJunit5,
  siKotlin,
  siNodedotjs,
  siPhp,
  siPytest,
  siPython,
  siRuby,
  siRust,
  siScala,
  siSwift,
  siVitest,
  siZig,
} from "simple-icons";
import { AnimatedBeam } from "@/components/animated-beam";
import { SparklesText } from "@/components/animated-text";
import { type CICDSystem, CICDSystemTile } from "@/components/cicd-system-tile";
import OtelLogo from "@/components/otel-logo.svg?react";

export const Route = createFileRoute("/")({
  component: Home,
});

type BrandIconDef = {
  title: string;
  path: string;
  hex: string;
};

const brandIcons: Record<string, BrandIconDef> = {
  githubactions: {
    title: "GitHub Actions",
    path: siGithubactions.path,
    hex: siGithubactions.hex,
  },
  go: {
    title: "Go",
    path: siGo.path,
    hex: siGo.hex,
  },
  vitest: {
    title: "Vitest",
    path: siVitest.path,
    hex: siVitest.hex,
  },
  gitlab: {
    title: "GitLab CI",
    path: siGitlab.path,
    hex: siGitlab.hex,
  },
  jenkins: {
    title: "Jenkins",
    path: siJenkins.path,
    hex: siJenkins.hex,
  },
  python: {
    title: "Python",
    path: siPython.path,
    hex: siPython.hex,
  },
  rust: {
    title: "Rust",
    path: siRust.path,
    hex: siRust.hex,
  },
  elixir: {
    title: "Elixir",
    path: siElixir.path,
    hex: siElixir.hex,
  },
  pytest: {
    title: "Pytest",
    path: siPytest.path,
    hex: siPytest.hex,
  },
  junit5: {
    title: "JUnit 5",
    path: siJunit5.path,
    hex: siJunit5.hex,
  },
  nodejs: {
    title: "Node.js",
    path: siNodedotjs.path,
    hex: siNodedotjs.hex,
  },
  deno: {
    title: "Deno",
    path: siDeno.path,
    hex: siDeno.hex,
  },
  bun: {
    title: "Bun",
    path: siBun.path,
    hex: siBun.hex,
  },
  ruby: {
    title: "Ruby",
    path: siRuby.path,
    hex: siRuby.hex,
  },
  dotnet: {
    title: ".NET",
    path: siDotnet.path,
    hex: siDotnet.hex,
  },
  swift: {
    title: "Swift",
    path: siSwift.path,
    hex: siSwift.hex,
  },
  zig: {
    title: "Zig",
    path: siZig.path,
    hex: siZig.hex,
  },
  gleam: {
    title: "Gleam",
    path: siGleam.path,
    hex: siGleam.hex,
  },
  dart: {
    title: "Dart",
    path: siDart.path,
    hex: siDart.hex,
  },
  flutter: {
    title: "Flutter",
    path: siFlutter.path,
    hex: siFlutter.hex,
  },
  php: {
    title: "PHP",
    path: siPhp.path,
    hex: siPhp.hex,
  },
  kotlin: {
    title: "Kotlin",
    path: siKotlin.path,
    hex: siKotlin.hex,
  },
  scala: {
    title: "Scala",
    path: siScala.path,
    hex: siScala.hex,
  },
  jest: {
    title: "Jest",
    path: siJest.path,
    hex: siJest.hex,
  },
};

const sectionTransition = {
  duration: 0.55,
  ease: [0.16, 1, 0.3, 1] as const,
};

const staggerContainer = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.06,
    },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: sectionTransition,
  },
};

const matrixWave = {
  hidden: { opacity: 0, y: 16 },
  show: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      ...sectionTransition,
      delay: 0.05 * (index % 6),
    },
  }),
};

function BrandIcon({
  icon,
  className = "size-5",
}: {
  icon: BrandIconDef;
  className?: string;
}) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      fill={`#${icon.hex}`}
      className={className}
      aria-label={icon.title}
    >
      <title>{icon.title}</title>
      <path d={icon.path} />
    </svg>
  );
}

function SurfaceCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-fd-border bg-fd-card/80 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

type EcosystemItem = {
  iconKey?: string;
  label: string;
  meta?: string;
};

function SectionFrame({
  eyebrow,
  title,
  description,
  children,
  align = "left",
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
  align?: "left" | "right";
}) {
  const isRight = align === "right";
  return (
    <SurfaceCard className="section-terminal-shell relative overflow-hidden p-5 sm:p-6">
      <div className={`mb-4 ${isRight ? "text-right" : "text-left"}`}>
        {eyebrow && <p className="terminal-eyebrow">{eyebrow}</p>}
        <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
          {title}
        </h2>
        <p
          className={`mt-3 text-sm leading-relaxed text-fd-muted-foreground ${
            isRight ? "ml-auto max-w-xl" : "max-w-xl"
          }`}
        >
          {description}
        </p>
      </div>
      {children}
    </SurfaceCard>
  );
}

const BeamCircle = forwardRef<
  HTMLDivElement,
  { className?: string; children?: ReactNode }
>(({ className, children }, ref) => {
  return (
    <div
      ref={ref}
      className={`z-10 flex size-12 items-center justify-center rounded-full border-2 border-fd-border bg-fd-card p-3 shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)] ${className ?? ""}`}
    >
      {children}
    </div>
  );
});

BeamCircle.displayName = "BeamCircle";

function CICDTopologyViz({ reduceMotion }: { reduceMotion: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ghaRef = useRef<HTMLDivElement>(null);
  const gitlabRef = useRef<HTMLDivElement>(null);
  const jenkinsRef = useRef<HTMLDivElement>(null);
  const otelRef = useRef<HTMLDivElement>(null);
  const everrRef = useRef<HTMLDivElement>(null);
  const randomizedDelays = useMemo(
    () => ({
      gha: Math.random() * 1.8,
      gitlab: Math.random() * 1.8,
      jenkins: Math.random() * 1.8,
      otelToEverr: 0.4 + Math.random() * 1.6,
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex h-[250px] w-full items-center justify-center overflow-hidden px-4 sm:px-8"
    >
      <div className="flex size-full max-w-2xl flex-row items-stretch justify-between gap-10">
        <div className="flex flex-col justify-center gap-3">
          <BeamCircle ref={ghaRef}>
            <SiGithubactions />
          </BeamCircle>
          <BeamCircle ref={gitlabRef}>
            <SiGitlab />
          </BeamCircle>
          <BeamCircle ref={jenkinsRef}>
            <SiJenkins />
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
        duration={reduceMotion ? 7 : 5}
        delay={reduceMotion ? 0 : randomizedDelays.gha}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={gitlabRef}
        toRef={otelRef}
        pathColor="#f97316"
        gradientStartColor="#f97316"
        gradientStopColor="#fb923c"
        duration={reduceMotion ? 7 : 5.2}
        delay={reduceMotion ? 0 : randomizedDelays.gitlab}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={jenkinsRef}
        toRef={otelRef}
        pathColor="#f97316"
        gradientStartColor="#f97316"
        gradientStopColor="#fb923c"
        duration={reduceMotion ? 7 : 5.6}
        delay={reduceMotion ? 0 : randomizedDelays.jenkins}
      />

      <AnimatedBeam
        containerRef={containerRef}
        fromRef={otelRef}
        toRef={everrRef}
        pathColor="#ea580c"
        gradientStartColor="#ea580c"
        gradientStopColor="#fb923c"
        duration={reduceMotion ? 7 : 5.5}
        delay={reduceMotion ? 0 : randomizedDelays.otelToEverr}
      />
    </div>
  );
}

function RuntimeMatrixCard({
  item,
  idx,
  reduceMotion,
}: {
  item: EcosystemItem;
  idx: number;
  reduceMotion: boolean;
}) {
  const icon = item.iconKey ? brandIcons[item.iconKey] : undefined;

  return (
    <motion.div
      custom={idx}
      variants={matrixWave}
      whileHover={reduceMotion ? undefined : { y: -4, scale: 1.012 }}
      className="runtime-matrix-card"
    >
      <div className="flex items-center gap-2">
        <div className="rounded-md border border-fd-border bg-fd-secondary/30 p-1.5">
          {icon ? (
            <BrandIcon icon={icon} className="size-4.5" />
          ) : (
            <Cpu className="size-4.5 text-everr-deep" />
          )}
        </div>
        <p className="font-semibold text-sm">{item.label}</p>
      </div>
    </motion.div>
  );
}

function SignalPanelCard({
  item,
  reduceMotion,
}: {
  item: EcosystemItem;
  reduceMotion: boolean;
}) {
  const icon = item.iconKey ? brandIcons[item.iconKey] : undefined;

  return (
    <motion.div
      variants={fadeUp}
      whileHover={reduceMotion ? undefined : { y: -4, scale: 1.01 }}
      className="signal-panel-card rounded-xl border border-fd-border bg-fd-card p-3"
    >
      <div className="flex items-center gap-2">
        <div className="rounded-md border border-fd-border bg-fd-secondary/30 p-1.5">
          {icon ? (
            <BrandIcon icon={icon} className="size-4.5" />
          ) : (
            <FlaskConical className="size-4.5 text-everr-deep" />
          )}
        </div>
        <p className="text-sm font-semibold">{item.label}</p>
      </div>
    </motion.div>
  );
}

const ciSystems = [
  {
    Icon: SiGithubactions,
    name: "GitHub Actions",
    status: "beta",
  },
  {
    Icon: SiGitlab,
    name: "GitLab CI",
    status: "planned",
  },
  {
    Icon: SiJenkins,
    name: "Jenkins",
    status: "planned",
  },
] satisfies CICDSystem[];

function Home() {
  const reduceMotion = useReducedMotion();
  const shouldReduceMotion = Boolean(reduceMotion);

  const reveal = shouldReduceMotion
    ? {}
    : {
        initial: "hidden" as const,
        whileInView: "show" as const,
        viewport: { once: true, amount: 0.2 },
      };

  const languagesAndRuntimes = [
    {
      iconKey: "go",
      label: "Go",
    },
    {
      iconKey: "nodejs",
      label: "Node.js",
    },
    {
      iconKey: "deno",
      label: "Deno",
    },
    {
      iconKey: "bun",
      label: "Bun",
    },
    {
      iconKey: "python",
      label: "Python",
    },
    {
      iconKey: "ruby",
      label: "Ruby",
    },
    {
      iconKey: "dotnet",
      label: "C#/.NET",
    },
    {
      iconKey: "swift",
      label: "Swift",
    },
    {
      iconKey: "zig",
      label: "Zig",
    },
    {
      iconKey: "gleam",
      label: "Gleam",
    },
    {
      iconKey: "dart",
      label: "Dart",
    },
    {
      iconKey: "flutter",
      label: "Flutter",
    },
    {
      iconKey: "php",
      label: "PHP",
    },
    {
      iconKey: "kotlin",
      label: "Kotlin",
    },
    {
      iconKey: "scala",
      label: "Scala",
    },
    {
      iconKey: "rust",
      label: "Rust",
    },
    {
      iconKey: "elixir",
      label: "Elixir",
    },
  ];

  const testFrameworks = [
    {
      iconKey: "vitest",
      label: "Vitest",
    },
    {
      iconKey: "jest",
      label: "Jest",
    },
    {
      iconKey: "pytest",
      label: "Pytest",
    },
    {
      iconKey: "junit5",
      label: "JUnit 5",
    },
    {
      label: "Playwright",
    },
  ];

  return (
    <div className="relative overflow-x-hidden">
      <div
        className="pointer-events-none absolute inset-0 docs-grid-bg"
        aria-hidden
      />

      <main className="relative mx-auto flex max-w-6xl flex-col px-4 pb-24 pt-14 sm:pt-20">
        <motion.section
          variants={staggerContainer}
          {...reveal}
          className="mb-20 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center"
        >
          <motion.div variants={fadeUp}>
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-everr-deep/30 bg-everr/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-everr-deep">
              <Radar className="size-3.5" />
              CI/CD observability for humans and AI agents
            </span>
            <h1 className="max-w-2xl text-4xl font-black tracking-tight sm:text-5xl md:text-6xl">
              Every second counts
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-fd-muted-foreground sm:text-lg">
              AI-assisted development compresses release cycles, so slow
              feedback loops hurt faster.{" "}
              <span className="font-semibold text-fd-foreground">Everr</span>{" "}
              turns workflow runs into OpenTelemetry traces in ClickHouse so
              teams can spot regressions, flaky tests, and bottlenecks quickly
              across CI providers.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="https://app.everr.dev"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-everr-deep px-5 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-everr-deep/30"
              >
                Get started
              </a>
              <Link
                to="/docs/$"
                params={{ _splat: "" }}
                className="inline-flex items-center gap-2 rounded-xl border border-fd-border bg-fd-card px-5 py-3 text-sm font-semibold transition-all hover:-translate-y-0.5 hover:bg-fd-accent"
              >
                Read the docs
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </motion.div>

          <motion.div variants={fadeUp}>
            <SurfaceCard className="relative overflow-hidden p-6 shadow-xl shadow-everr-deep/10">
              <div className="mb-5 flex items-center justify-between">
                <span className="rounded-md bg-everr/10 px-2 py-1 font-mono text-xs text-everr-deep">
                  trace summary
                </span>
                <span className="font-mono text-xs text-fd-muted-foreground">
                  run #29184
                </span>
              </div>
              <div className="space-y-3">
                {[
                  { step: "checkout", value: "0.9s", width: "w-3/5", ok: true },
                  {
                    step: "install",
                    value: "4.2s",
                    width: "w-[82%]",
                    ok: true,
                  },
                  { step: "test", value: "11.4s", width: "w-full", ok: false },
                  { step: "publish", value: "1.1s", width: "w-1/4", ok: true },
                ].map((span) => (
                  <div
                    key={span.step}
                    className="grid grid-cols-[84px_1fr_60px] items-center gap-2"
                  >
                    <span className="font-mono text-xs text-fd-muted-foreground">
                      {span.step}
                    </span>
                    <div className="h-6 rounded bg-fd-secondary/60">
                      <div
                        className={`h-full rounded ${
                          span.ok ? "bg-everr/45" : "bg-red-500/45"
                        } ${span.width}`}
                      />
                    </div>
                    <span
                      className={`text-right font-mono text-xs ${
                        span.ok
                          ? "text-fd-muted-foreground"
                          : "font-semibold text-red-500"
                      }`}
                    >
                      {span.value}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between rounded-lg border border-fd-border bg-fd-secondary/30 px-3 py-2 text-xs">
                <span className="font-medium">p95 duration</span>
                <span className="font-mono">+18.7% vs baseline</span>
              </div>
            </SurfaceCard>
          </motion.div>
        </motion.section>

        <motion.section
          variants={staggerContainer}
          {...reveal}
          className="mb-20"
        >
          <motion.div variants={fadeUp} className="mb-8">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Trace every second from trigger to outcome
            </h2>
            <p className="mt-3 max-w-3xl text-fd-muted-foreground">
              Everr keeps the data model explicit so incident triage stays fast:
              provider events are ingested, normalized to traces, indexed in
              ClickHouse, and surfaced in dashboards built for rapid debugging.
            </p>
          </motion.div>
          <motion.div
            variants={staggerContainer}
            className="grid gap-4 md:grid-cols-4"
          >
            {[
              {
                title: "Ingest",
                text: "Provider-agnostic adapters ingest CI signals via APIs and webhooks.",
                icon: <GitPullRequest className="size-4" />,
              },
              {
                title: "Normalize",
                text: "Collector emits OTel spans, attributes, and events.",
                icon: <Binary className="size-4" />,
              },
              {
                title: "Store",
                text: "Columnar ClickHouse tables for fast aggregations.",
                icon: <Database className="size-4" />,
              },
              {
                title: "Analyze",
                text: "Trace waterfall, performance regressions, and flakiness analysis.",
                icon: <BarChart3 className="size-4" />,
              },
            ].map((item) => (
              <motion.div key={item.title} variants={fadeUp}>
                <SurfaceCard className="h-full p-5">
                  <div className="mb-3 inline-flex size-8 items-center justify-center rounded-md bg-everr/10 text-everr-deep">
                    {item.icon}
                  </div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                    {item.text}
                  </p>
                </SurfaceCard>
              </motion.div>
            ))}
          </motion.div>
        </motion.section>

        <motion.section
          variants={staggerContainer}
          {...reveal}
          className="mb-20"
        >
          <motion.div variants={fadeUp} className="mb-7">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Core features
            </h2>
            <p className="mt-3 max-w-3xl text-fd-muted-foreground">
              Start with the hosted dashboard, connect your assistant through
              MCP, and automate workflows with the CLI.
            </p>
          </motion.div>
          <motion.div
            variants={staggerContainer}
            className="grid gap-4 md:grid-cols-3"
          >
            {[
              {
                title: "Dashboard",
                detail:
                  "Monitor CI/CD health, investigate failures, and track regressions from one UI.",
                to: "app/getting-started",
                cta: "Open dashboard docs",
              },
              {
                title: "MCP server",
                detail:
                  "Expose telemetry tools to AI agents so they can query and diagnose pipelines in your editor.",
                to: "mcp/getting-started",
                cta: "Open MCP docs",
              },
              {
                title: "CLI",
                detail:
                  "Use terminal-first workflows for setup, automation, and CI observability tasks.",
                to: "cli",
                cta: "Open CLI docs",
              },
            ].map((feature) => (
              <motion.div key={feature.title} variants={fadeUp}>
                <SurfaceCard className="group h-full border-fd-border p-5 transition-all duration-300 hover:shadow-lg">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{feature.title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                    {feature.detail}
                  </p>
                  <Link
                    to="/docs/$"
                    params={{ _splat: feature.to }}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-everr-deep/25 bg-everr/8 px-2.5 py-1 text-sm font-semibold text-everr-deep transition-colors group-hover:bg-everr/12"
                  >
                    {feature.cta}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </SurfaceCard>
              </motion.div>
            ))}
          </motion.div>
        </motion.section>

        <motion.section
          variants={staggerContainer}
          {...reveal}
          className="mb-20"
        >
          <motion.div variants={fadeUp} className="mb-8">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Built for high-tempo engineering teams
            </h2>
          </motion.div>
          <motion.div
            variants={staggerContainer}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {[
              {
                title: "Trace Waterfall",
                detail:
                  "Navigate parent-child execution paths and isolate slow branches.",
                icon: <Server className="size-5" />,
              },
              {
                title: "Failure Clustering",
                detail:
                  "Group recurring stack traces and rank by impact frequency.",
                icon: <ShieldCheck className="size-5" />,
              },
              {
                title: "Test Intelligence",
                detail:
                  "Track flaky distribution and suite-level reliability drift.",
                icon: <Cpu className="size-5" />,
              },
              {
                title: "Latency Regressions",
                detail: "Monitor p50 and p95 deltas across workflow templates.",
                icon: <Clock3 className="size-5" />,
              },
            ].map((feature) => (
              <motion.div key={feature.title} variants={fadeUp}>
                <SurfaceCard className="h-full p-5">
                  <div className="mb-3 text-everr-deep">{feature.icon}</div>
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                    {feature.detail}
                  </p>
                </SurfaceCard>
              </motion.div>
            ))}
          </motion.div>
        </motion.section>

        <motion.section
          variants={staggerContainer}
          {...reveal}
          className="relative left-1/2 right-1/2 mb-10 -mx-[50vw] w-screen border-y border-fd-border bg-fd-card/35 py-7 sm:py-8"
        >
          <div
            className="pointer-events-none absolute inset-0 docs-grid-bg"
            aria-hidden
          />
          <motion.div
            variants={fadeUp}
            className="relative mx-auto max-w-6xl px-4"
          >
            <div className="mb-4">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                CI/CD system agnostic
              </h2>
              <p className="mt-3 max-w-3xl text-fd-muted-foreground">
                Everr normalizes pipeline telemetry into one trace model, so you
                can analyze runs consistently across CI providers.
              </p>
            </div>
            <CICDTopologyViz reduceMotion={shouldReduceMotion} />
            <motion.div
              variants={staggerContainer}
              className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
            >
              {ciSystems.map((item) => (
                <CICDSystemTile
                  key={item.name}
                  item={item}
                  reduceMotion={shouldReduceMotion}
                />
              ))}
            </motion.div>
          </motion.div>
        </motion.section>

        <motion.section
          variants={staggerContainer}
          {...reveal}
          className="mb-24 lg:grid lg:grid-cols-[1.08fr_0.92fr] lg:items-start lg:gap-10"
        >
          <motion.div
            variants={staggerContainer}
            className="runtime-matrix-bg grid gap-3 rounded-2xl border border-fd-border bg-fd-card/45 p-4 sm:grid-cols-2 lg:order-1 lg:grid-cols-3"
          >
            {languagesAndRuntimes.map((item, index) => (
              <RuntimeMatrixCard
                key={item.label}
                item={item}
                idx={index}
                reduceMotion={shouldReduceMotion}
              />
            ))}
          </motion.div>
          <motion.div variants={fadeUp} className="mb-6 lg:order-2 lg:mb-0">
            <SectionFrame
              align="right"
              title="Languages and runtimes"
              description="Go, Python, Node.js, and more all map to one trace model. Query and debug every pipeline the same way, with OpenTelemetry-based adapters under the hood."
            />
          </motion.div>
        </motion.section>

        <motion.section
          variants={staggerContainer}
          {...reveal}
          className="mb-24 lg:grid lg:grid-cols-[0.92fr_1.08fr] lg:items-start lg:gap-10"
        >
          <motion.div variants={fadeUp} className="mb-6 lg:mb-0">
            <SectionFrame
              title="Test frameworks"
              description="JUnit, pytest, Vitest, and Playwright signals are normalized into traces. Track pass/fail, error patterns, and flaky behavior without framework-specific dashboards."
            />
          </motion.div>
          <motion.div
            variants={staggerContainer}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {testFrameworks.map((item) => (
              <SignalPanelCard
                key={item.label}
                item={item}
                reduceMotion={shouldReduceMotion}
              />
            ))}
          </motion.div>
        </motion.section>

        <motion.section
          variants={fadeUp}
          {...reveal}
          className="relative left-1/2 right-1/2 mb-20 -mx-[50vw] w-screen border-y border-fd-border bg-fd-card/35 py-10 sm:py-12"
        >
          <div
            className="pointer-events-none absolute inset-0 docs-grid-bg-strong"
            aria-hidden
          />
          <div className="relative mx-auto grid max-w-6xl gap-6 px-4 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <span className="mb-3 inline-flex items-center rounded-full border border-everr-deep/30 bg-everr/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-everr-deep">
                Quickstart
              </span>
              <h3 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                Launch Everr in three steps
              </h3>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-fd-muted-foreground sm:text-base">
                Start at app.everr.dev, connect your CI, and jump straight into
                traces without self-hosting setup.
              </p>
              <a
                href="https://app.everr.dev"
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-everr-deep px-5 py-2.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-everr-deep/30"
              >
                Get started in app
                <ArrowRight className="size-4" />
              </a>
            </div>

            <ol className="grid gap-3 text-sm">
              {[
                {
                  title: "Create your Everr account",
                  detail: "Sign in at app.everr.dev and create your workspace.",
                  icon: <Radar className="size-4" />,
                },
                {
                  title: "Connect your CI provider",
                  detail:
                    "Authorize your repositories so new workflow runs stream into Everr automatically.",
                  icon: <GitPullRequest className="size-4" />,
                },
                {
                  title: "Analyze runs in the dashboard",
                  detail:
                    "Go from failed runs to root cause with traces, test signals, and regressions in one view.",
                  icon: <BarChart3 className="size-4" />,
                },
              ].map((step, idx) => (
                <li
                  key={step.title}
                  className="rounded-xl border border-fd-border bg-fd-card p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-everr/15 font-mono text-xs font-semibold text-everr-deep">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-everr-deep">{step.icon}</span>
                        <p className="font-semibold">{step.title}</p>
                      </div>
                      <p className="leading-relaxed text-fd-muted-foreground">
                        {step.detail}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </motion.section>

        <motion.section variants={fadeUp} {...reveal}>
          <SurfaceCard className="relative overflow-hidden p-8 text-center sm:p-10">
            <div
              className="pointer-events-none absolute inset-0 docs-cta-glow"
              aria-hidden
            />
            <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">
              <SparklesText
                className="text-3xl sm:text-4xl inline-block text-everr-deep"
                sparklesCount={4}
              >
                Everr
              </SparklesText>
              y second counts. See where yours go.
            </h2>
            <p className="relative mx-auto mt-4 max-w-2xl text-fd-muted-foreground">
              Start with GitHub Actions, then scale to GitLab CI, Jenkins, and
              broader test ecosystems with one telemetry model and one query
              surface.
            </p>
            <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
              <a
                href="https://app.everr.dev"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-everr-deep px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-everr-deep/30"
              >
                Start instrumenting your pipelines
                <ArrowRight className="size-4" />
              </a>
              <Link
                to="/docs/$"
                params={{ _splat: "" }}
                className="inline-flex items-center gap-2 rounded-xl border border-fd-border bg-fd-card px-6 py-3 text-sm font-semibold transition-all hover:-translate-y-0.5 hover:bg-fd-accent"
              >
                Read the docs
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </SurfaceCard>
        </motion.section>
      </main>
    </div>
  );
}
