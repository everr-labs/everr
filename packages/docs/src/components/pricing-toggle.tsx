// Pricing is intentionally off the homepage until launch pricing is finalized;
// this component is retained for reuse. Dead-code is silenced via the fallow
// override for this file in .fallowrc.jsonc.
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  Cloud,
  Cpu,
  Gauge,
  HardDrive,
  Server,
  Terminal,
  Zap,
} from "lucide-react";
import { motion, useInView } from "motion/react";
import { useCallback, useId, useRef, useState } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type Mode = "self-host" | "cloud";

const SEGMENTS: { id: Mode; label: string; icon: typeof Server }[] = [
  { id: "self-host", label: "Self-host", icon: Server },
  { id: "cloud", label: "Cloud", icon: Cloud },
];

const SELF_HOST_FEATURES = [
  "Full telemetry pipeline — logs, traces, metrics",
  "Unlimited retention, capped only by your disk",
  "No seat limits, no data egress fees, ever",
  "Apache-2.0 licensed — fork it, audit it, ship it",
] as const;

const CLOUD_FEATURES = [
  "Zero-ops ingestion — we run the collectors",
  "Automatic scaling and 30-day hot retention",
  "SSO, audit logs, and role-based access",
  "Backups, upgrades, and on-call handled for you",
] as const;

const SELF_HOST_SPECS = [
  { icon: Cpu, label: "Footprint", value: "2 vCPU · 4 GB" },
  { icon: HardDrive, label: "Storage", value: "Your volumes" },
  { icon: Terminal, label: "Install", value: "One command" },
] as const;

const CLOUD_INCLUDED = [
  { label: "Events / mo", value: "50M" },
  { label: "Retention", value: "30 days" },
  { label: "Seats", value: "Unlimited" },
] as const;

export function PricingToggle() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const [mode, setMode] = useState<Mode>("cloud");
  const tablistId = useId();

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setMode((prev) => {
      const idx = SEGMENTS.findIndex((s) => s.id === prev);
      const next =
        e.key === "ArrowRight"
          ? (idx + 1) % SEGMENTS.length
          : (idx - 1 + SEGMENTS.length) % SEGMENTS.length;
      return SEGMENTS[next].id;
    });
  }, []);

  return (
    <section
      ref={ref}
      className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background"
    >
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Pricing
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            <span className="text-fd-foreground">Host it yourself,</span>{" "}
            <span className="text-fd-muted-foreground/60">or let us run it.</span>
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            One decision shapes everything. Run the whole pipeline on your own infrastructure for
            free, or hand the ops to us and start in seconds.
          </p>
        </motion.div>

        {/* Segmented control */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
          className="mt-12"
        >
          <div
            role="tablist"
            aria-label="Choose how to run Everr"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="inline-flex w-full max-w-md gap-1 rounded-full border border-fd-border bg-fd-card/40 p-1 sm:w-auto"
          >
            {SEGMENTS.map((seg) => {
              const active = mode === seg.id;
              const Icon = seg.icon;
              return (
                <button
                  key={seg.id}
                  type="button"
                  role="tab"
                  id={`${tablistId}-${seg.id}-tab`}
                  aria-selected={active}
                  aria-controls={`${tablistId}-${seg.id}-panel`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setMode(seg.id)}
                  className={cn(
                    "relative flex flex-1 items-center justify-center gap-2 rounded-full px-6 py-3 font-heading text-sm font-bold tracking-tight outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background sm:flex-none sm:px-8",
                    active
                      ? "text-fd-background"
                      : "text-fd-muted-foreground hover:text-fd-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="pricing-segment-indicator"
                      className="absolute inset-0 rounded-full bg-primary"
                      transition={{
                        type: "spring",
                        stiffness: 360,
                        damping: 32,
                      }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    <Icon className="size-4" strokeWidth={2.25} aria-hidden />
                    {seg.label}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Panel — both variants are always rendered, stacked in the same grid
            cell, so the section height stays constant (sized to the taller
            panel) no matter which tab is active. Each slides in from its own
            side (self-host from the left, cloud from the right). `x`/opacity
            animate via transforms, which don't affect layout, so the stack keeps
            reserving the taller panel's height throughout the transition. */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.7, delay: 0.25, ease: EASE }}
          className="mt-8 grid"
        >
          <motion.div
            inert={mode !== "self-host"}
            aria-hidden={mode !== "self-host"}
            initial={false}
            animate={mode === "self-host" ? { opacity: 1, x: 0 } : { opacity: 0, x: -28 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="col-start-1 row-start-1"
          >
            <SelfHostPanel tablistId={tablistId} />
          </motion.div>
          <motion.div
            inert={mode !== "cloud"}
            aria-hidden={mode !== "cloud"}
            initial={false}
            animate={mode === "cloud" ? { opacity: 1, x: 0 } : { opacity: 0, x: 28 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="col-start-1 row-start-1"
          >
            <CloudPanel tablistId={tablistId} />
          </motion.div>
        </motion.div>

        {/* Link to the detailed plan-comparison page */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : undefined}
          transition={{ duration: 0.6, delay: 0.4, ease: EASE }}
          className="mt-10 flex justify-center"
        >
          <Link
            to="/pricing"
            className="group inline-flex items-center gap-1.5 font-heading text-sm font-bold text-fd-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
          >
            Compare all plans, feature by feature
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Self-host panel — terminal-forward, "you own it"                   */
/* ------------------------------------------------------------------ */

function SelfHostPanel({ tablistId }: { tablistId: string }) {
  return (
    <div
      role="tabpanel"
      id={`${tablistId}-self-host-panel`}
      aria-labelledby={`${tablistId}-self-host-tab`}
      className="grid items-stretch gap-6 lg:grid-cols-[1.1fr_1fr]"
    >
      {/* Left: the offer */}
      <div className="flex flex-col rounded-2xl border border-fd-border bg-fd-card/30 p-8 md:p-10">
        <div className="flex items-center gap-2.5">
          <Server className="size-4 text-primary" strokeWidth={2.25} aria-hidden />
          <span className="font-heading text-xs font-bold uppercase tracking-[0.25em] text-fd-muted-foreground">
            Self-host
          </span>
          <span className="ml-auto rounded-full border border-fd-border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-fd-muted-foreground">
            Open source
          </span>
        </div>

        <div className="mt-8 flex items-end gap-3">
          <span className="font-mono text-6xl font-bold leading-none tracking-tight text-fd-foreground md:text-7xl">
            $0
          </span>
          <span className="pb-1.5 font-mono text-sm text-fd-muted-foreground">forever</span>
        </div>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-fd-muted-foreground">
          The full Everr stack, running on your infrastructure. No license keys, no metered usage,
          no phone-home.
        </p>

        <ul className="mt-8 space-y-3.5">
          {SELF_HOST_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-3 text-sm text-fd-foreground">
              <Check
                className="mt-0.5 size-4 shrink-0 text-primary"
                strokeWidth={2.5}
                aria-hidden
              />
              <span className="leading-snug">{f}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="group mt-8 flex w-full items-center justify-center gap-2 rounded-full border-2 border-primary bg-transparent px-6 py-3.5 font-heading text-sm font-bold tracking-tight text-primary outline-none transition-colors duration-200 hover:bg-primary hover:text-fd-background focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
        >
          Deploy
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            strokeWidth={2.5}
            aria-hidden
          />
        </button>
      </div>

      {/* Right: terminal + specs — distinct presentation */}
      <div className="flex flex-col gap-6">
        <div className="overflow-hidden rounded-2xl border border-fd-border bg-fd-card font-mono text-xs">
          <div className="flex items-center gap-2 border-b border-fd-border px-4 py-3">
            <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
            <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
            <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
            <span className="ml-2 text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/50">
              install.sh
            </span>
          </div>
          <div className="space-y-2 p-5 leading-relaxed">
            <p className="text-fd-muted-foreground">
              <span className="text-primary">$</span> curl -fsSL everr.dev/install | sh
            </p>
            <p className="text-fd-muted-foreground/70">↳ pulling collector…</p>
            <p className="text-fd-muted-foreground/70">↳ starting pipeline…</p>
            <p className="text-fd-foreground">
              <span className="text-primary">✓</span> everr live,{" "}
              <span className="text-fd-foreground">collector ready</span>
            </p>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-3 gap-px overflow-hidden rounded-2xl border border-fd-border bg-fd-border">
          {SELF_HOST_SPECS.map((spec) => {
            const Icon = spec.icon;
            return (
              <div key={spec.label} className="flex flex-col justify-between bg-fd-card/30 p-5">
                <Icon className="size-4 text-fd-muted-foreground" strokeWidth={2} aria-hidden />
                <div className="mt-6">
                  <div className="font-heading text-sm font-bold text-fd-foreground">
                    {spec.value}
                  </div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-fd-muted-foreground/60">
                    {spec.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cloud panel — usage-forward, single hero offer card               */
/* ------------------------------------------------------------------ */

function CloudPanel({ tablistId }: { tablistId: string }) {
  return (
    <div
      role="tabpanel"
      id={`${tablistId}-cloud-panel`}
      aria-labelledby={`${tablistId}-cloud-tab`}
      className="grid items-stretch gap-6 lg:grid-cols-[1fr_1.1fr]"
    >
      {/* Left: usage meters — distinct presentation */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col justify-between rounded-2xl border border-fd-border bg-fd-card/30 p-8">
          <div className="flex items-center gap-2.5">
            <Gauge className="size-4 text-primary" strokeWidth={2.25} aria-hidden />
            <span className="font-heading text-xs font-bold uppercase tracking-[0.25em] text-fd-muted-foreground">
              What&apos;s included
            </span>
          </div>
          <dl className="mt-8 grid grid-cols-3 gap-4">
            {CLOUD_INCLUDED.map((item) => (
              <div key={item.label}>
                <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-fd-muted-foreground/60">
                  {item.label}
                </dt>
                <dd className="mt-1 font-heading text-xl font-bold tracking-tight text-fd-foreground sm:text-2xl">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex-1 rounded-2xl border border-fd-border bg-fd-card/30 p-8">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-fd-muted-foreground/60">
              Usage this cycle
            </span>
            <span className="font-mono text-xs text-fd-muted-foreground">31M / 50M</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-fd-border">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: "62%" }}
              transition={{ duration: 0.9, delay: 0.2, ease: EASE }}
              className="h-full rounded-full bg-primary"
            />
          </div>
          <p className="mt-5 text-sm leading-relaxed text-fd-muted-foreground">
            Only pay past the included tier — billed per million events, prorated to the second. No
            overage surprises.
          </p>
        </div>
      </div>

      {/* Right: the offer — single hero card */}
      <div className="relative flex flex-col rounded-2xl border-2 border-primary/50 bg-fd-card p-8 md:p-10">
        <div className="flex items-center gap-2.5">
          <Cloud className="size-4 text-primary" strokeWidth={2.25} aria-hidden />
          <span className="font-heading text-xs font-bold uppercase tracking-[0.25em] text-fd-muted-foreground">
            Cloud
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-primary">
            <Zap className="size-3" strokeWidth={2.5} aria-hidden />
            Managed
          </span>
        </div>

        <div className="mt-8 flex items-end gap-3">
          <span className="font-mono text-6xl font-bold leading-none tracking-tight text-fd-foreground md:text-7xl">
            $39
          </span>
          <span className="pb-1.5 font-mono text-sm text-fd-muted-foreground">/ mo + usage</span>
        </div>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-fd-muted-foreground">
          We run the whole thing for you — ingestion, storage, scaling, upgrades. Point your agents
          at one endpoint and go.
        </p>

        <ul className="mt-8 space-y-3.5">
          {CLOUD_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-3 text-sm text-fd-foreground">
              <Check
                className="mt-0.5 size-4 shrink-0 text-primary"
                strokeWidth={2.5}
                aria-hidden
              />
              <span className="leading-snug">{f}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="group mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 font-heading text-sm font-bold tracking-tight text-fd-background outline-none transition-colors duration-200 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
        >
          Start free
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            strokeWidth={2.5}
            aria-hidden
          />
        </button>
      </div>
    </div>
  );
}
