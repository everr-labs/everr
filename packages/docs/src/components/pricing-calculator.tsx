import { cn } from "@everr/ui/lib/utils";
import { ArrowRight, Database, Server, Timer } from "lucide-react";
import { animate, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Pricing model — illustrative, transparent formula                  */
/* ------------------------------------------------------------------ */

const BASE_FEE = 49; // managed base, $/mo
const PER_GB = 0.18; // $/GB ingested
const PER_HOST = 6; // $/host or service
const RETENTION_PIVOT = 14; // days included before multiplier kicks in

/** Retention multiplier — longer storage scales the data cost. */
function retentionMultiplier(days: number) {
  // 1.0x at 14d, climbing gently; ~1.0 + (days-14)/120
  return Math.max(1, 1 + (days - RETENTION_PIVOT) / 120);
}

type Mode = "managed" | "self";

type Breakdown = {
  base: number;
  ingest: number;
  hosts: number;
  multiplier: number;
  total: number;
};

function computeBreakdown(
  gb: number,
  retention: number,
  hosts: number,
  mode: Mode,
): Breakdown {
  if (mode === "self") {
    return { base: 0, ingest: 0, hosts: 0, multiplier: 1, total: 0 };
  }
  const multiplier = retentionMultiplier(retention);
  const ingest = gb * PER_GB * multiplier;
  const hostsCost = hosts * PER_HOST;
  const total = BASE_FEE + ingest + hostsCost;
  return { base: BASE_FEE, ingest, hosts: hostsCost, multiplier, total };
}

const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const fmtUSD2 = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtInt = (n: number) => n.toLocaleString("en-US");

/* ------------------------------------------------------------------ */
/*  Slider control                                                     */
/* ------------------------------------------------------------------ */

type SliderProps = {
  id: string;
  icon: React.ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  display: string;
  hint: string;
  disabled?: boolean;
  onChange: (v: number) => void;
};

function Slider({
  id,
  icon,
  label,
  value,
  min,
  max,
  step,
  unit,
  display,
  hint,
  disabled,
  onChange,
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div
      className={cn(
        "transition-opacity duration-300",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <div className="flex items-baseline justify-between gap-4">
        <label
          htmlFor={id}
          className="flex items-center gap-2.5 font-heading text-sm font-bold text-fd-foreground"
        >
          <span className="text-fd-muted-foreground/70" aria-hidden="true">
            {icon}
          </span>
          {label}
        </label>
        <span className="font-mono text-sm tabular-nums text-fd-foreground">
          <span className="text-primary">{display}</span>{" "}
          <span className="text-fd-muted-foreground/60">{unit}</span>
        </span>
      </div>

      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${display} ${unit}`}
        className="pc-range mt-4 w-full"
        style={{ ["--pc-fill" as string]: `${pct}%` }}
      />

      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.15em] text-fd-muted-foreground/45">
        {hint}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated currency readout                                          */
/* ------------------------------------------------------------------ */

function AnimatedTotal({ value, mode }: { value: number; mode: Mode }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const controls = animate(prev.current, value, {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(v),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value]);

  if (mode === "self") {
    return (
      <span className="font-mono text-6xl font-bold leading-none tracking-tight text-fd-foreground tabular-nums sm:text-7xl">
        $0
      </span>
    );
  }

  return (
    <span className="font-mono text-6xl font-bold leading-none tracking-tight text-fd-foreground tabular-nums sm:text-7xl">
      {fmtUSD(shown)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Breakdown line item                                                */
/* ------------------------------------------------------------------ */

function LineItem({
  label,
  note,
  value,
  accent,
}: {
  label: string;
  note?: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <span className="text-sm text-fd-foreground">{label}</span>
        {note ? (
          <span className="ml-2 font-mono text-[11px] text-fd-muted-foreground/50">
            {note}
          </span>
        ) : null}
      </div>
      <span
        className={cn(
          "shrink-0 font-mono text-sm tabular-nums",
          accent ? "text-primary" : "text-fd-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export function PricingCalculator() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  const [gb, setGb] = useState(120);
  const [retention, setRetention] = useState(30);
  const [hosts, setHosts] = useState(8);
  const [mode, setMode] = useState<Mode>("managed");

  const isSelf = mode === "self";
  const bd = computeBreakdown(gb, retention, hosts, mode);

  return (
    <section
      ref={ref}
      className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · calculator
      </span>

      {/* Scoped range-input styling — lime thumb + filled track on dark. */}
      <style>{rangeCss}</style>

      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Pricing
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Drag the sliders. Watch the bill.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            No quote forms, no "contact sales." Model your real usage and see
            exactly what you'd pay — every line of the math, in the open.
          </p>
        </motion.div>

        {/* Two-column: controls + result */}
        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-xl border-2 border-fd-border bg-fd-border md:mt-20 md:grid-cols-[1.15fr_1fr]">
          {/* LEFT — controls */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{
              duration: 0.7,
              delay: 0.15,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="bg-fd-card/40 p-8 md:p-10"
          >
            {/* Mode toggle */}
            <fieldset>
              <legend className="font-heading text-[11px] font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/55">
                Deployment
              </legend>
              <div
                role="radiogroup"
                aria-label="Deployment model"
                className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-fd-border bg-fd-background/60 p-1.5"
              >
                {(
                  [
                    { id: "managed", label: "Managed", sub: "We run it" },
                    { id: "self", label: "Self-host", sub: "You run it" },
                  ] as const
                ).map((opt) => {
                  const active = mode === opt.id;
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: styled segmented control needs a button element with radio semantics
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setMode(opt.id)}
                      className={cn(
                        "group rounded-md px-4 py-3 text-left outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-fd-muted-foreground hover:bg-fd-card hover:text-fd-foreground",
                      )}
                    >
                      <span className="block font-heading text-sm font-bold">
                        {opt.label}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block font-mono text-[11px] uppercase tracking-[0.12em]",
                          active
                            ? "text-primary-foreground/70"
                            : "text-fd-muted-foreground/50",
                        )}
                      >
                        {opt.sub}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Sliders */}
            <div className="mt-10 space-y-9">
              <Slider
                id="pc-gb"
                icon={<Database className="size-4" />}
                label="Data ingested"
                value={gb}
                min={10}
                max={2000}
                step={10}
                unit="GB / mo"
                display={fmtInt(gb)}
                hint={`${fmtUSD2(PER_GB)} per GB`}
                disabled={isSelf}
                onChange={setGb}
              />
              <Slider
                id="pc-retention"
                icon={<Timer className="size-4" />}
                label="Retention"
                value={retention}
                min={7}
                max={365}
                step={1}
                unit="days"
                display={fmtInt(retention)}
                hint={`${RETENTION_PIVOT} days included · then scales`}
                disabled={isSelf}
                onChange={setRetention}
              />
              <Slider
                id="pc-hosts"
                icon={<Server className="size-4" />}
                label="Hosts / services"
                value={hosts}
                min={1}
                max={200}
                step={1}
                unit="hosts"
                display={fmtInt(hosts)}
                hint={`${fmtUSD(PER_HOST)} per host / mo`}
                disabled={isSelf}
                onChange={setHosts}
              />
            </div>

            {isSelf ? (
              <p className="mt-9 rounded-lg border border-fd-border bg-fd-background/50 p-4 text-sm leading-relaxed text-fd-muted-foreground">
                Self-hosted Everr is{" "}
                <span className="text-fd-foreground">
                  free, open, and yours
                </span>
                . You bring the infrastructure — sliders above stop mattering
                because the meter is off.
              </p>
            ) : null}
          </motion.div>

          {/* RIGHT — result */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{
              duration: 0.7,
              delay: 0.28,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="bg-fd-card p-8 md:p-10"
          >
            <div className="md:sticky md:top-24">
              <div className="flex items-center justify-between">
                <span className="font-heading text-[11px] font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/55">
                  Estimated monthly
                </span>
                <span className="rounded-full border border-fd-border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-fd-muted-foreground/60">
                  {isSelf ? "self-host" : "managed"}
                </span>
              </div>

              {/* Big animated total */}
              <div className="mt-5 flex items-end gap-2">
                <AnimatedTotal value={bd.total} mode={mode} />
                <span className="mb-1.5 font-mono text-sm text-fd-muted-foreground/60">
                  {isSelf ? "+ infra" : "/ mo"}
                </span>
              </div>

              {/* The math */}
              <div className="mt-8 border-t border-fd-border pt-2">
                {isSelf ? (
                  <>
                    <LineItem
                      label="Software license"
                      note="open source"
                      value="$0"
                    />
                    <LineItem
                      label="Your infrastructure"
                      note="self-managed"
                      value="at cost"
                    />
                  </>
                ) : (
                  <>
                    <LineItem
                      label="Platform base"
                      note="flat"
                      value={fmtUSD2(bd.base)}
                    />
                    <LineItem
                      label="Ingest"
                      note={`${fmtInt(gb)} GB × ${fmtUSD2(PER_GB)}`}
                      value={fmtUSD2(gb * PER_GB)}
                    />
                    <LineItem
                      label="Retention multiplier"
                      note={`${retention}d → ${bd.multiplier.toFixed(2)}×`}
                      value={`+${fmtUSD2(bd.ingest - gb * PER_GB)}`}
                      accent={bd.multiplier > 1}
                    />
                    <LineItem
                      label="Hosts"
                      note={`${fmtInt(hosts)} × ${fmtUSD(PER_HOST)}`}
                      value={fmtUSD2(bd.hosts)}
                    />
                  </>
                )}
              </div>

              <div className="mt-2 flex items-baseline justify-between border-t-2 border-fd-border pt-4">
                <span className="font-heading text-sm font-bold uppercase tracking-[0.15em] text-fd-foreground">
                  Total
                </span>
                <span className="font-mono text-lg font-bold tabular-nums text-fd-foreground">
                  {isSelf ? "$0 + infra" : `${fmtUSD2(bd.total)} / mo`}
                </span>
              </div>

              {/* CTA */}
              <a
                href="/docs"
                className={cn(
                  "group mt-8 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-4",
                  "font-heading text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-card",
                )}
              >
                Start free
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.15em] text-fd-muted-foreground/45">
                No card · cancel anytime · usage-based
              </p>
            </div>
          </motion.div>
        </div>

        <p className="mt-6 max-w-2xl font-mono text-[11px] leading-relaxed text-fd-muted-foreground/45">
          Illustrative estimate. Figures are placeholders for layout — base{" "}
          {fmtUSD(BASE_FEE)} + {fmtUSD2(PER_GB)}/GB (× retention) +{" "}
          {fmtUSD(PER_HOST)}/host.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Scoped range CSS — lime thumb, filled track, focus ring            */
/* ------------------------------------------------------------------ */

const rangeCss = `
.pc-range {
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    var(--primary) 0%,
    var(--primary) var(--pc-fill, 0%),
    color-mix(in oklab, var(--border) 70%, transparent) var(--pc-fill, 0%),
    color-mix(in oklab, var(--border) 70%, transparent) 100%
  );
  outline: none;
  cursor: pointer;
}
.pc-range:disabled { cursor: default; }
.pc-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  height: 20px;
  width: 20px;
  border-radius: 9999px;
  background: var(--primary);
  border: 3px solid var(--background);
  box-shadow: 0 0 0 1px var(--primary);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
  margin-top: 0;
}
.pc-range::-webkit-slider-thumb:hover { transform: scale(1.12); }
.pc-range:active::-webkit-slider-thumb { transform: scale(1.18); }
.pc-range:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--primary) 40%, transparent);
}
.pc-range::-moz-range-thumb {
  height: 20px;
  width: 20px;
  border-radius: 9999px;
  background: var(--primary);
  border: 3px solid var(--background);
  box-shadow: 0 0 0 1px var(--primary);
  cursor: pointer;
  transition: transform 0.12s ease;
}
.pc-range::-moz-range-thumb:hover { transform: scale(1.12); }
.pc-range:focus-visible::-moz-range-thumb {
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--primary) 40%, transparent);
}
.pc-range::-moz-range-track {
  height: 6px;
  border-radius: 9999px;
  background: color-mix(in oklab, var(--border) 70%, transparent);
}
.pc-range::-moz-range-progress {
  height: 6px;
  border-radius: 9999px;
  background: var(--primary);
}
`;
