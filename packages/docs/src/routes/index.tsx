import {
  SiBuildkite,
  SiCircleci,
  SiDrone,
  SiGithubactions,
  SiGitlab,
  SiJenkins,
  SiOpentelemetry,
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
  siArgo,
  siBuildkite,
  siBun,
  siCircleci,
  siDart,
  siDeno,
  siDotnet,
  siDrone,
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
  circleci: {
    title: "CircleCI",
    path: siCircleci.path,
    hex: siCircleci.hex,
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
  drone: {
    title: "Drone",
    path: siDrone.path,
    hex: siDrone.hex,
  },
  argocd: {
    title: "Argo CD",
    path: siArgo.path,
    hex: siArgo.hex,
  },
  buildkite: {
    title: "Buildkite",
    path: siBuildkite.path,
    hex: siBuildkite.hex,
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
  caption: string;
  meta?: string;
  lane?: string;
};

function SectionFrame({
  eyebrow,
  title,
  description,
  children,
  align = "left",
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  align?: "left" | "right";
}) {
  const isRight = align === "right";
  return (
    <SurfaceCard className="section-terminal-shell relative overflow-hidden p-5 sm:p-6">
      <div className={`mb-4 ${isRight ? "text-right" : "text-left"}`}>
        <p className="terminal-eyebrow">{eyebrow}</p>
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
  const circleRef = useRef<HTMLDivElement>(null);
  const jenkinsRef = useRef<HTMLDivElement>(null);
  const droneRef = useRef<HTMLDivElement>(null);
  const buildkiteRef = useRef<HTMLDivElement>(null);
  const otelRef = useRef<HTMLDivElement>(null);
  const citricRef = useRef<HTMLDivElement>(null);
  const randomizedDelays = useMemo(
    () => ({
      gha: Math.random() * 1.8,
      gitlab: Math.random() * 1.8,
      circle: Math.random() * 1.8,
      jenkins: Math.random() * 1.8,
      drone: Math.random() * 1.8,
      buildkite: Math.random() * 1.8,
      otelToCitric: 0.4 + Math.random() * 1.6,
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className="cicd-topology-grid relative flex h-[420px] w-full items-center justify-center overflow-hidden rounded-xl border border-fd-border bg-fd-secondary/20 p-8"
    >
      <div className="flex size-full max-w-2xl flex-row items-stretch justify-between gap-10">
        <div className="flex flex-col justify-center gap-3">
          <BeamCircle ref={ghaRef}>
            <SiGithubactions />
            {/*<BrandIcon icon={brandIcons.githubactions} className="size-5" />*/}
          </BeamCircle>
          <BeamCircle ref={gitlabRef}>
            <SiGitlab />
            {/*<BrandIcon icon={brandIcons.gitlab} className="size-5" />*/}
          </BeamCircle>
          <BeamCircle ref={circleRef}>
            <SiCircleci />
            {/*<BrandIcon icon={brandIcons.circleci} className="size-5" />*/}
          </BeamCircle>
          <BeamCircle ref={jenkinsRef}>
            <SiJenkins />
            {/*<BrandIcon icon={brandIcons.jenkins} className="size-5" />*/}
          </BeamCircle>
          <BeamCircle ref={droneRef}>
            <SiDrone />
            {/*<BrandIcon icon={brandIcons.drone} className="size-5" />*/}
          </BeamCircle>
          <BeamCircle ref={buildkiteRef}>
            <SiBuildkite />
            {/*<BrandIcon icon={brandIcons.buildkite} className="size-5" />*/}
          </BeamCircle>
        </div>

        <div className="flex flex-col justify-center">
          <BeamCircle ref={otelRef} className="size-16">
            <div className="flex flex-col items-center gap-1">
              <SiOpentelemetry className="size-5 text-citric-deep fill-foreground" />

              <span className="text-[9px] font-semibold leading-none">
                OTel
              </span>
            </div>
          </BeamCircle>
        </div>

        <div className="flex flex-col justify-center">
          <BeamCircle ref={citricRef}>
            <div className="flex flex-col items-center gap-1">
              <Citrus className="size-4 text-citric-deep" />
              <span className="text-[9px] font-semibold leading-none">
                Citric
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
        fromRef={circleRef}
        toRef={otelRef}
        pathColor="#f97316"
        gradientStartColor="#f97316"
        gradientStopColor="#fb923c"
        duration={reduceMotion ? 7 : 5.4}
        delay={reduceMotion ? 0 : randomizedDelays.circle}
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
        fromRef={droneRef}
        toRef={otelRef}
        pathColor="#f97316"
        gradientStartColor="#f97316"
        gradientStopColor="#fb923c"
        duration={reduceMotion ? 7 : 5.8}
        delay={reduceMotion ? 0 : randomizedDelays.drone}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={buildkiteRef}
        toRef={otelRef}
        pathColor="#f97316"
        gradientStartColor="#f97316"
        gradientStopColor="#fb923c"
        duration={reduceMotion ? 7 : 6}
        delay={reduceMotion ? 0 : randomizedDelays.buildkite}
      />

      <AnimatedBeam
        containerRef={containerRef}
        fromRef={otelRef}
        toRef={citricRef}
        pathColor="#ea580c"
        gradientStartColor="#ea580c"
        gradientStopColor="#fb923c"
        duration={reduceMotion ? 7 : 5.5}
        delay={reduceMotion ? 0 : randomizedDelays.otelToCitric}
      />
    </div>
  );
}

function CICDStatusTile({
  item,
  reduceMotion,
}: {
  item: EcosystemItem;
  reduceMotion: boolean;
}) {
  const iconFromItem = item.iconKey ? brandIcons[item.iconKey] : undefined;

  return (
    <motion.div
      className="terminal-tile"
      variants={fadeUp}
      whileHover={reduceMotion ? undefined : { y: -5, scale: 1.01 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="rounded-md border border-fd-border bg-fd-secondary/30 p-1.5">
          {iconFromItem ? (
            <BrandIcon icon={iconFromItem} className="size-4.5" />
          ) : (
            <Cpu className="size-4.5 text-citric-deep" />
          )}
        </div>
        <span className="rounded-full bg-citric/15 px-2 py-0.5 font-mono text-[10px] text-citric-deep">
          receiver
        </span>
      </div>
      <p className="text-sm font-semibold">{item.label}</p>
      <p className="mt-1 text-xs leading-relaxed text-fd-muted-foreground">
        {item.caption}
      </p>
    </motion.div>
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
      <div className="mb-2 flex items-center gap-2">
        <div className="rounded-md border border-fd-border bg-fd-secondary/30 p-1.5">
          {icon ? (
            <BrandIcon icon={icon} className="size-4.5" />
          ) : (
            <Cpu className="size-4.5 text-citric-deep" />
          )}
        </div>
        <p className="font-semibold text-sm">{item.label}</p>
      </div>
      <p className="text-xs leading-relaxed text-fd-muted-foreground">
        {item.caption}
      </p>
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
      <div className="mb-2 flex items-center gap-2">
        <div className="rounded-md border border-fd-border bg-fd-secondary/30 p-1.5">
          {icon ? (
            <BrandIcon icon={icon} className="size-4.5" />
          ) : (
            <FlaskConical className="size-4.5 text-citric-deep" />
          )}
        </div>
        <p className="text-sm font-semibold">{item.label}</p>
      </div>
      <p className="text-xs leading-relaxed text-fd-muted-foreground">
        {item.caption}
      </p>
    </motion.div>
  );
}

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

  const ciSystems = [
    {
      iconKey: "githubactions",
      label: "GitHub Actions",
      caption: "Primary ingestion path for workflow/run metadata.",
    },
    {
      iconKey: "gitlab",
      label: "GitLab CI",
      caption: "Adapter target for pipeline and stage ingestion.",
    },
    {
      iconKey: "circleci",
      label: "CircleCI",
      caption: "Adapter target for workflow and step correlation.",
    },
    {
      iconKey: "jenkins",
      label: "Jenkins",
      caption: "Adapter target for job/stage event normalization.",
    },
    {
      iconKey: "drone",
      label: "Drone",
      caption: "Adapter target for run metadata and outcomes.",
    },
    {
      iconKey: "argocd",
      label: "Argo CD",
      caption: "Deployment telemetry adapter target.",
    },
    {
      iconKey: "buildkite",
      label: "Buildkite",
      caption: "Adapter target for build graph ingestion.",
    },
  ];

  const languagesAndRuntimes = [
    { iconKey: "go", label: "Go", caption: "Collector/runtime baseline." },
    {
      iconKey: "nodejs",
      label: "Node.js",
      caption: "Runtime telemetry coverage target.",
    },
    {
      iconKey: "deno",
      label: "Deno",
      caption: "Runtime telemetry coverage target.",
    },
    {
      iconKey: "bun",
      label: "Bun",
      caption: "Runtime telemetry coverage target.",
    },
    {
      iconKey: "python",
      label: "Python",
      caption: "Suite and test metadata target.",
    },
    {
      iconKey: "ruby",
      label: "Ruby",
      caption: "Suite and test metadata target.",
    },
    {
      iconKey: "dotnet",
      label: "C#/.NET",
      caption: "CLR telemetry compatibility target.",
    },
    {
      iconKey: "swift",
      label: "Swift",
      caption: "Package/test telemetry mapping target.",
    },
    {
      iconKey: "zig",
      label: "Zig",
      caption: "Build/test telemetry mapping target.",
    },
    {
      iconKey: "gleam",
      label: "Gleam",
      caption: "Language telemetry mapping target.",
    },
    {
      iconKey: "dart",
      label: "Dart",
      caption: "Language telemetry mapping target.",
    },
    {
      iconKey: "flutter",
      label: "Flutter",
      caption: "App test telemetry mapping target.",
    },
    {
      iconKey: "php",
      label: "PHP",
      caption: "PHP test telemetry mapping target.",
    },
    {
      iconKey: "kotlin",
      label: "Kotlin",
      caption: "JVM telemetry compatibility target.",
    },
    {
      iconKey: "scala",
      label: "Scala",
      caption: "JVM telemetry compatibility target.",
    },
    {
      iconKey: "rust",
      label: "Rust",
      caption: "Test and bench telemetry target.",
    },
    {
      iconKey: "elixir",
      label: "Elixir",
      caption: "Suite telemetry mapping target.",
    },
  ];

  const testFrameworks = [
    {
      iconKey: "vitest",
      label: "Vitest",
      caption: "Current test analytics ingestion path.",
    },
    {
      iconKey: "jest",
      label: "Jest",
      caption: "JavaScript test ingestion target.",
    },
    {
      iconKey: "pytest",
      label: "Pytest",
      caption: "Python test ingestion target.",
    },
    {
      iconKey: "junit5",
      label: "JUnit 5",
      caption: "JVM test result model target.",
    },
    {
      label: "Playwright",
      caption: "Placeholder icon - browser E2E telemetry adapter target.",
    },
  ];

  return (
    <div className="relative overflow-x-hidden">
      <div
        className="pointer-events-none absolute inset-0 docs-grid-bg"
        aria-hidden
      />
      <motion.div
        className="pointer-events-none absolute left-1/2 top-[-220px] h-[520px] w-[520px] -translate-x-1/2 rounded-full docs-radial-glow"
        animate={shouldReduceMotion ? undefined : { scale: [1, 1.06, 1] }}
        transition={
          shouldReduceMotion
            ? undefined
            : {
                duration: 10,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }
        }
        aria-hidden
      />

      <main className="relative mx-auto flex max-w-6xl flex-col px-4 pb-24 pt-14 sm:pt-20">
        <motion.section
          variants={staggerContainer}
          {...reveal}
          className="mb-20 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center"
        >
          <motion.div variants={fadeUp}>
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-citric-deep/30 bg-citric/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-citric-deep">
              <Radar className="size-3.5" />
              Cross-Ecosystem CI Telemetry
            </span>
            <h1 className="max-w-2xl text-4xl font-black tracking-tight sm:text-5xl md:text-6xl">
              Observe every pipeline span across CI providers.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-fd-muted-foreground sm:text-lg">
              Citric normalizes workflow runs into OpenTelemetry traces and
              stores them in ClickHouse for fast, high-cardinality queries.
              Start with GitHub Actions today, then extend via adapter-based
              ingestion for GitLab CI, CircleCI, Jenkins, and additional
              platforms.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/docs/$"
                params={{ _splat: "" }}
                className="inline-flex items-center gap-2 rounded-xl bg-citric-deep px-5 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-citric-deep/30"
              >
                Read the docs
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="https://github.com/citric-app/citric"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-fd-border bg-fd-card px-5 py-3 text-sm font-semibold transition-all hover:-translate-y-0.5 hover:bg-fd-accent"
              >
                Inspect source
              </a>
            </div>
          </motion.div>

          <motion.div variants={fadeUp}>
            <SurfaceCard className="relative overflow-hidden p-6 shadow-xl shadow-citric-deep/10">
              <div className="mb-5 flex items-center justify-between">
                <span className="rounded-md bg-citric/10 px-2 py-1 font-mono text-xs text-citric-deep">
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
                          span.ok ? "bg-citric/45" : "bg-red-500/45"
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
              Telemetry pipeline, end to end
            </h2>
            <p className="mt-3 max-w-3xl text-fd-muted-foreground">
              Citric keeps the data model explicit: provider events are
              ingested, normalized to traces, indexed in ClickHouse, and queried
              with dashboard primitives optimized for incident triage across
              diverse CI and test ecosystems.
            </p>
          </motion.div>
          <motion.div
            variants={staggerContainer}
            className="grid gap-4 md:grid-cols-4"
          >
            {[
              {
                title: "Ingest",
                text: "Provider adapters ingest CI metadata (GitHub Actions first).",
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
                text: "Trace waterfall, regressions, and flaky signatures.",
                icon: <BarChart3 className="size-4" />,
              },
            ].map((item) => (
              <motion.div key={item.title} variants={fadeUp}>
                <SurfaceCard className="h-full p-5">
                  <div className="mb-3 inline-flex size-8 items-center justify-center rounded-md bg-citric/10 text-citric-deep">
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
          <motion.div variants={fadeUp} className="mb-8">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Built for debugging at span granularity
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
                  <div className="mb-3 text-citric-deep">{feature.icon}</div>
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
          className="mb-24 lg:grid lg:grid-cols-[0.92fr_1.08fr] lg:items-start lg:gap-10"
        >
          <motion.div variants={fadeUp} className="mb-6 lg:mb-0">
            <SectionFrame
              eyebrow="Pipeline Control Plane"
              title="CI/CD systems"
              description="Provider adapters are routed through a single telemetry control plane. Links pulse as execution signals are normalized into consistent traces."
            >
              <CICDTopologyViz reduceMotion={shouldReduceMotion} />
            </SectionFrame>
          </motion.div>
          <motion.div
            variants={staggerContainer}
            className="grid gap-3 sm:grid-cols-2"
          >
            {ciSystems.map((item) => (
              <CICDStatusTile
                key={item.label}
                item={item}
                reduceMotion={shouldReduceMotion}
              />
            ))}
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
              eyebrow="Runtime Compatibility Matrix"
              title="Languages and runtimes"
              description="Language telemetry lanes are curated as matrix profiles. Each card exposes parser posture, event model strategy, and schema normalization characteristics."
            ></SectionFrame>
          </motion.div>
        </motion.section>

        <motion.section
          variants={staggerContainer}
          {...reveal}
          className="mb-24 lg:grid lg:grid-cols-[0.92fr_1.08fr] lg:items-start lg:gap-10"
        >
          <motion.div variants={fadeUp} className="mb-6 lg:mb-0">
            <SectionFrame
              eyebrow="Test Signal Lab"
              title="Test frameworks"
              description="Framework signals are ingested through lane-oriented adapters. Timing vectors and flaky indicators are shaped into a stable analytical graph."
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

        <motion.section variants={fadeUp} {...reveal} className="mb-20">
          <SurfaceCard className="p-5">
            <h3 className="mb-4 font-semibold">Quickstart path</h3>
            <ol className="space-y-4 text-sm">
              <li className="rounded-lg border border-fd-border bg-fd-secondary/20 p-3">
                <p className="font-medium">1. Deploy collector endpoint</p>
                <p className="mt-1 text-fd-muted-foreground">
                  Configure webhook intake and repository auth.
                </p>
              </li>
              <li className="rounded-lg border border-fd-border bg-fd-secondary/20 p-3">
                <p className="font-medium">2. Emit trace-rich workflow runs</p>
                <p className="mt-1 text-fd-muted-foreground">
                  Normalization maps jobs, steps, logs, and test signals from
                  provider-specific schemas to one trace model.
                </p>
              </li>
              <li className="rounded-lg border border-fd-border bg-fd-secondary/20 p-3">
                <p className="font-medium">
                  3. Query and correlate in dashboard
                </p>
                <p className="mt-1 text-fd-muted-foreground">
                  Pivot from failing spans to aggregated regressions across
                  repositories, CI vendors, and test runners.
                </p>
              </li>
            </ol>
            <Link
              to="/docs/$"
              params={{ _splat: "getting-started" }}
              className="mt-5 inline-flex items-center gap-2 rounded-lg border border-citric-deep/40 bg-citric/10 px-4 py-2 text-xs font-semibold text-citric-deep transition-colors hover:bg-citric/20"
            >
              Open setup guide
              <ArrowRight className="size-3.5" />
            </Link>
          </SurfaceCard>
        </motion.section>

        <motion.section variants={fadeUp} {...reveal}>
          <SurfaceCard className="relative overflow-hidden p-8 text-center sm:p-10">
            <div
              className="pointer-events-none absolute inset-0 docs-cta-glow"
              aria-hidden
            />
            <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">
              Replace CI guesswork with trace evidence.
            </h2>
            <p className="relative mx-auto mt-4 max-w-2xl text-fd-muted-foreground">
              Start with GitHub Actions now, then scale to GitLab CI, CircleCI,
              Jenkins, and broader test ecosystems with the same telemetry graph
              and query surface.
            </p>
            <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/docs/$"
                params={{ _splat: "" }}
                className="inline-flex items-center gap-2 rounded-xl bg-citric-deep px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-citric-deep/30"
              >
                Start documenting your pipeline
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="https://github.com/citric-app/citric"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-fd-border bg-fd-card px-6 py-3 text-sm font-semibold transition-all hover:-translate-y-0.5 hover:bg-fd-accent"
              >
                Review source on GitHub
              </a>
            </div>
          </SurfaceCard>
        </motion.section>
      </main>
    </div>
  );
}
