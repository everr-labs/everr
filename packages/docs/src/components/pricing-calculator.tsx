import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { ArrowRight } from "lucide-react";
import { motion, useInView } from "motion/react";
import { useId, useMemo, useRef, useState } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/*  Cost model                                                         */
/*                                                                     */
/*  Every provider is a single list of rows. Each row carries both the  */
/*  vendor's charge and Everr's charge for the same thing, so the two    */
/*  columns mirror each other line-for-line. Rates are published list    */
/*  prices as of 2026; all figures are estimates (see disclaimer).       */
/* ------------------------------------------------------------------ */

const EVERR = {
  base: 39,
  includedGb: 300,
  overagePerGb: 0.4,
  perSeat: 8,
  includedSeats: 3,
};

const LOG_KB = 2;
const kEventsToGb = (kEvents: number) => (kEvents * 1000 * LOG_KB) / 1_000_000;
const seriesToGb = (kSeries: number) => kSeries;

// Datadog per-host allotments: an infra host includes 100 custom metrics and an
// APM host includes 150 GB of ingested spans. Custom metrics past the allotment
// bill at ~$0.05 each; APM host counts are backed out from trace volume.
// https://www.datadoghq.com/pricing/allotments/
const DATADOG_METRICS_PER_HOST = 100;
const DATADOG_SPAN_GB_PER_HOST = 150;

type Values = Record<string, number>;

type Control = {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

// `trap` holds the tooltip text explaining why a vendor line is a hidden cost.
type Cell = { amount: number; detail?: string; trap?: string };
type Row = { label: string; everr: Cell; provider: Cell };

type Provider = {
  id: string;
  label: string;
  controls: Control[];
  rows: (v: Values) => Row[];
};

const billedSeats = (teamSize: number) =>
  Math.max(0, teamSize - EVERR.includedSeats);

const seatsRow = (
  teamSize: number,
  providerPerSeat: number,
  providerFreeSeats = 0,
): Row => {
  const providerBilled = Math.max(0, teamSize - providerFreeSeats);
  return {
    label: "Seats",
    everr: {
      amount: billedSeats(teamSize) * EVERR.perSeat,
      detail: `${billedSeats(teamSize)} × $8 (3 free)`,
    },
    provider:
      providerPerSeat > 0
        ? {
            amount: providerBilled * providerPerSeat,
            detail: `${providerBilled} × $${providerPerSeat} (${providerFreeSeats} free)`,
          }
        : { amount: 0, detail: "included" },
  };
};

const baseRow = (providerAmount: number, providerDetail: string): Row => ({
  label: "Base",
  everr: { amount: EVERR.base, detail: "Pro plan" },
  provider: { amount: providerAmount, detail: providerDetail },
});

type Cat = { label: string; gb: number; provider: Cell };
function dataRows(cats: Cat[]): Row[] {
  const total = cats.reduce((s, c) => s + c.gb, 0);
  const overage = Math.max(0, total - EVERR.includedGb);
  return cats.map((c) => ({
    label: c.label,
    everr: {
      amount: total > 0 ? (c.gb / total) * overage * EVERR.overagePerGb : 0,
      detail: `${Math.round(c.gb)} GB`,
    },
    provider: c.provider,
  }));
}

// APM hosts are seeded from trace volume via Datadog's 150 GB-spans-per-host
// allotment. Infra hosts stay a plain physical count; custom metrics beyond the
// hosts' 100-per-host allotment are billed as overage on the Metrics line.
function derivedApmHosts(v: Values) {
  return Math.ceil(v.traceVolume / DATADOG_SPAN_GB_PER_HOST);
}

const PROVIDERS: Provider[] = [
  {
    id: "grafana",
    label: "Grafana Cloud",
    controls: [METRIC_SERIES(), LOG_VOLUME(), TRACE_VOLUME(), TEAM_SIZE()],
    rows: (v) => [
      baseRow(19, "Base plan"),
      ...dataRows([
        {
          label: "Metrics",
          gb: seriesToGb(v.metricSeries),
          provider: {
            amount: Math.max(0, v.metricSeries - 10) * 6.5,
            detail: `${v.metricSeries}k series (10k free)`,
            trap: "Billed per active time series past 10k free. It scales with metric cardinality, so high-cardinality tags multiply the count fast.",
          },
        },
        {
          label: "Logs",
          gb: v.logVolume,
          provider: {
            amount: Math.max(0, v.logVolume - 50) * 0.5,
            detail: `${v.logVolume} GB (50 GB free)`,
          },
        },
        {
          label: "Traces",
          gb: v.traceVolume,
          provider: {
            amount: Math.max(0, v.traceVolume - 50) * 0.5,
            detail: `${v.traceVolume} GB (50 GB free)`,
          },
        },
      ]),
      seatsRow(v.teamSize, 8, 3),
    ],
  },
  {
    id: "datadog",
    label: "Datadog",
    // APM hosts are editable but seeded from trace volume (derivedApmHosts)
    // until dragged; infra hosts are a plain count. Host counts set Datadog's
    // included allotments, and volume beyond that is billed as overage.
    controls: [
      CUSTOM_METRICS(),
      LOG_VOLUME(),
      TRACE_VOLUME(),
      TEAM_SIZE(),
      {
        key: "apmHosts",
        label: "APM hosts",
        unit: "hosts",
        min: 0,
        max: 20,
        step: 1,
        default: 10,
      },
      {
        key: "infraHosts",
        label: "Infrastructure hosts",
        unit: "hosts",
        min: 0,
        max: 100,
        step: 5,
        default: 5,
      },
    ],
    rows: (v) => [
      baseRow(0, "no base fee"),
      {
        label: "Infrastructure",
        everr: { amount: 0, detail: "not billed" },
        provider: {
          amount: v.infraHosts * 15,
          detail: `${v.infraHosts} hosts × $15`,
          trap: "Flat per-host fee. Every monitored host is billed $15/mo, busy or idle.",
        },
      },
      {
        label: "APM",
        everr: { amount: 0, detail: "not billed" },
        provider: {
          amount: v.apmHosts * 31,
          detail: `${v.apmHosts} hosts × $31`,
          trap: "Billed per host again, on top of infrastructure. Trace-heavy services need more APM hosts.",
        },
      },
      ...dataRows([
        {
          label: "Logs",
          gb: v.logVolume,
          provider: {
            amount: v.logVolume * 0.36,
            detail: `${v.logVolume} GB ingested`,
            trap: "The per-GB rate is ingestion only. Indexing and retention are billed separately and usually dwarf it.",
          },
        },
        {
          label: "Traces",
          gb: v.traceVolume,
          provider: {
            // Ingested spans beyond the 150 GB/APM-host allotment: $0.10/GB.
            amount:
              Math.max(
                0,
                v.traceVolume - v.apmHosts * DATADOG_SPAN_GB_PER_HOST,
              ) * 0.1,
            detail: "span overage",
            trap: "Spans past the 150 GB/host allotment, plus indexed-span retention billed on top.",
          },
        },
        {
          label: "Metrics",
          gb: seriesToGb(v.metricSeries),
          provider: {
            // Custom metrics beyond the 100/host allotment: ~$0.05 each.
            amount:
              Math.max(
                0,
                v.metricSeries * 1000 - v.infraHosts * DATADOG_METRICS_PER_HOST,
              ) * 0.05,
            detail: "custom metric overage",
            trap: "Custom metrics past 100/host cost ~$0.05 each. High-cardinality tags multiply this fast.",
          },
        },
      ]),
      seatsRow(v.teamSize, 0),
    ],
  },
  {
    id: "sentry",
    label: "Sentry",
    controls: [
      METRIC_SERIES(),
      LOG_VOLUME(),
      TRACE_VOLUME(),
      TEAM_SIZE(),
      {
        key: "errorEvents",
        label: "Error events",
        unit: "k/mo",
        min: 0,
        max: 10000,
        step: 50,
        default: 500,
      },
    ],
    rows: (v) => [
      baseRow(29, "Team plan"),
      ...dataRows([
        {
          label: "Errors",
          gb: kEventsToGb(v.errorEvents),
          provider: {
            amount: Math.max(0, v.errorEvents - 50) * 0.3,
            detail: `${v.errorEvents}k events (50k free)`,
            trap: "50k errors are included, but past that they add up fast at production volume. On Everr, errors are just logs, billed at the normal log rate.",
          },
        },
        {
          label: "Logs",
          gb: v.logVolume,
          provider: {
            amount: Math.max(0, v.logVolume - 5) * 0.5,
            detail: `${v.logVolume} GB (5 GB free)`,
          },
        },
        {
          label: "Traces",
          gb: v.traceVolume,
          provider: {
            amount: Math.max(0, v.traceVolume - 5) * 0.5,
            detail: `${v.traceVolume} GB (5 GB free)`,
          },
        },
        {
          label: "Metrics",
          gb: seriesToGb(v.metricSeries),
          provider: {
            amount: seriesToGb(v.metricSeries) * 0.5,
            detail: `${v.metricSeries}k series`,
          },
        },
      ]),
      seatsRow(v.teamSize, 0),
    ],
  },
];

function METRIC_SERIES(): Control {
  return {
    key: "metricSeries",
    label: "Active metric series",
    unit: "k series",
    min: 0,
    max: 200,
    step: 10,
    default: 50,
  };
}

// Datadog-only variant: its metric cost is driven by custom metrics specifically.
function CUSTOM_METRICS(): Control {
  return {
    key: "metricSeries",
    label: "Custom metrics",
    unit: "k",
    min: 0,
    max: 50,
    step: 1,
    default: 5,
  };
}
function LOG_VOLUME(): Control {
  return {
    key: "logVolume",
    label: "Log volume",
    unit: "GB/mo",
    min: 0,
    max: 2000,
    step: 10,
    default: 100,
  };
}
function TRACE_VOLUME(): Control {
  return {
    key: "traceVolume",
    label: "Trace volume",
    unit: "GB/mo",
    min: 0,
    max: 2000,
    step: 10,
    default: 100,
  };
}
function TEAM_SIZE(): Control {
  return {
    key: "teamSize",
    label: "Team size",
    unit: "users",
    min: 1,
    max: 200,
    step: 1,
    default: 3,
  };
}

// Maps a summary row to the slider that drives it, so the breakdown can be
// ordered to match the slider layout (left-to-right, top-to-bottom). Rows with
// no slider (Base) sort first.
const ROW_CONTROL: Record<string, string> = {
  Metrics: "metricSeries",
  Logs: "logVolume",
  Traces: "traceVolume",
  Seats: "teamSize",
  APM: "apmHosts",
  Infrastructure: "infraHosts",
  Errors: "errorEvents",
};

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function initialValues(): Record<string, Values> {
  return Object.fromEntries(
    PROVIDERS.map((p) => [
      p.id,
      Object.fromEntries(p.controls.map((c) => [c.key, c.default])),
    ]),
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PricingCalculator() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const [byProvider, setByProvider] =
    useState<Record<string, Values>>(initialValues);
  const [providerId, setProviderId] = useState<string>("grafana");
  // Whether the user has taken manual control of the Datadog APM host slider.
  // Until then it auto-tracks the trace volume.
  const [apmDirty, setApmDirty] = useState(false);

  const provider = PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS[0];
  const rawValues = byProvider[providerId];

  // For Datadog, seed the APM host slider from trace volume until the user drags
  // it, and cap it at the infra host count (APM runs on a subset of your hosts).
  // Trace volume past what those hosts cover spills into the span-overage line.
  const values = useMemo(() => {
    if (providerId !== "datadog") return rawValues;
    const apm = apmDirty ? rawValues.apmHosts : derivedApmHosts(rawValues);
    return {
      ...rawValues,
      apmHosts: Math.min(apm, rawValues.infraHosts),
    };
  }, [providerId, rawValues, apmDirty]);

  const rows = useMemo(() => provider.rows(values), [provider, values]);
  // Order the summary to match the slider layout (reading order = controls order).
  const orderedRows = useMemo(() => {
    const rank = (label: string) => {
      const key = ROW_CONTROL[label];
      if (!key) return -1;
      const i = provider.controls.findIndex((c) => c.key === key);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...rows].sort((a, b) => rank(a.label) - rank(b.label));
  }, [rows, provider]);
  const everrTotal = useMemo(
    () => rows.reduce((s, r) => s + r.everr.amount, 0),
    [rows],
  );
  const providerTotal = useMemo(
    () => rows.reduce((s, r) => s + r.provider.amount, 0),
    [rows],
  );

  const savings = providerTotal - everrTotal;
  const savingsPct =
    providerTotal > 0 ? Math.round((savings / providerTotal) * 100) : 0;
  const yearly = savings * 12;
  const yearlyLabel =
    yearly >= 1000 ? `$${(yearly / 1000).toFixed(1)}k` : usd(yearly);
  const bananaKg = Math.round(yearly / 5); // bananas at $5/kg

  const setValue = (key: string, val: number) => {
    if (key === "apmHosts") setApmDirty(true);
    setByProvider((prev) => ({
      ...prev,
      [providerId]: { ...prev[providerId], [key]: val },
    }));
  };

  return (
    <TooltipProvider delay={150}>
      <section className="relative overflow-x-clip border-t-2 border-fd-border bg-fd-background">
        <div ref={ref} className="mx-auto max-w-7xl px-6 py-24 md:py-36">
          {/* Section intro */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.8, ease: EASE }}
            className="max-w-3xl"
          >
            <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
              Cost calculator
            </p>
            <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
              Estimate your bill.
            </h2>
          </motion.div>

          {/* One stacked panel: tabs → sliders → comparison → savings */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.8, delay: 0.12, ease: EASE }}
            className="mt-14 overflow-hidden rounded-2xl border border-fd-border bg-fd-card/40 md:mt-20"
          >
            {/* Compare against */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-fd-border/60 px-6 py-5 md:px-10">
              <span className="font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-fd-muted-foreground/50">
                Compare against
              </span>
              <div
                role="tablist"
                aria-label="Compare against"
                className="inline-flex flex-wrap gap-1 rounded-full border border-fd-border bg-fd-card/60 p-1"
              >
                {PROVIDERS.map((prov) => {
                  const active = prov.id === providerId;
                  return (
                    <button
                      key={prov.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setProviderId(prov.id)}
                      className={cn(
                        "rounded-full px-4 py-1.5 font-heading text-[13px] font-bold tracking-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none",
                        active
                          ? "bg-primary text-fd-background"
                          : "text-fd-muted-foreground hover:text-fd-foreground",
                      )}
                    >
                      {prov.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Adjust your usage */}
            <div className="border-b border-fd-border/60 px-6 py-7 md:px-10 md:py-8">
              <span className="font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-fd-muted-foreground/50">
                Adjust your usage
              </span>
              <div className="mt-6 grid gap-x-12 gap-y-6 md:grid-cols-2">
                {provider.controls.map((c) => (
                  <Slider
                    key={c.key}
                    control={c}
                    value={values[c.key]}
                    onChange={(val) => setValue(c.key, val)}
                  />
                ))}
              </div>
              {providerId === "datadog" && (
                <p className="mt-6 font-mono text-[11px] leading-relaxed text-fd-muted-foreground/50">
                  APM hosts auto-adjust to your trace volume (capped at your
                  host count) until you set them. Custom metrics beyond 100/host
                  and spans beyond 150 GB/host bill as overage.
                </p>
              )}
            </div>

            {/* Comparison: two vendor blocks, rows aligned via equal headers */}
            <div className="grid md:grid-cols-2">
              {/* Everr */}
              <div className="border-b border-fd-border/60 px-6 py-8 md:border-b-0 md:border-r md:px-10">
                <span className="font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
                  Everr
                </span>
                <div className="mt-3 flex items-end gap-1.5">
                  <span className="font-mono text-4xl font-bold leading-none tracking-tight text-fd-foreground md:text-5xl">
                    {usd(everrTotal)}
                  </span>
                  <span className="pb-1 font-mono text-sm text-fd-muted-foreground/70">
                    / mo
                  </span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-fd-muted-foreground/60">
                  Pro plan
                </p>
                <dl className="mt-6 space-y-3">
                  {orderedRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-baseline justify-between gap-4"
                    >
                      <dt className="text-sm text-fd-muted-foreground">
                        {row.label}
                      </dt>
                      <dd className="font-mono text-sm font-medium text-primary">
                        {usd(row.everr.amount)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Provider */}
              <div className="px-6 py-8 md:px-10">
                <span className="font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-fd-muted-foreground">
                  {provider.label}
                </span>
                <div className="mt-3 flex items-end gap-1.5">
                  <span className="font-mono text-4xl font-bold leading-none tracking-tight text-fd-muted-foreground/70 md:text-5xl">
                    {usd(providerTotal)}
                  </span>
                  <span className="pb-1 font-mono text-sm text-fd-muted-foreground/50">
                    / mo
                  </span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-fd-muted-foreground/40">
                  Estimated
                </p>
                <dl className="mt-6 space-y-3">
                  {orderedRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-baseline justify-between gap-4"
                    >
                      <dt className="text-sm text-fd-muted-foreground">
                        {row.label}
                      </dt>
                      <dd className="font-mono text-sm">
                        {row.provider.trap ? (
                          <Tooltip>
                            <TooltipTrigger className="cursor-help rounded font-medium text-rose-400 underline decoration-rose-400/40 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50">
                              {usd(row.provider.amount)}
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-left leading-relaxed">
                              {row.provider.trap}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-fd-muted-foreground/80">
                            {usd(row.provider.amount)}
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                {orderedRows.some((row) => row.provider.trap) && (
                  <p className="mt-6 text-xs leading-relaxed text-fd-muted-foreground/60">
                    <span className="text-rose-400">Highlighted</span> lines are
                    hidden cost traps. Hover for why.
                  </p>
                )}
              </div>
            </div>

            {/* Savings footer */}
            <div className="flex flex-col gap-5 border-t border-fd-border/60 bg-primary/[0.06] px-6 py-6 sm:flex-row sm:items-center sm:justify-between md:px-10">
              <div>
                {savings > 0 ? (
                  <>
                    <p className="font-heading text-2xl font-bold tracking-tight text-fd-foreground md:text-3xl">
                      Save{" "}
                      <span className="text-primary">{usd(savings)}/month</span>
                    </p>
                    <p className="mt-1.5 text-sm text-fd-muted-foreground">
                      That's {savingsPct}% less than {provider.label}, or{" "}
                      {yearlyLabel}/year back in your budget.
                    </p>
                    <p className="mt-1 text-sm text-fd-muted-foreground/70">
                      That's {bananaKg.toLocaleString("en-US")}kg of
                      bananas/year. 🍌
                    </p>
                  </>
                ) : (
                  <p className="font-heading text-3xl font-bold text-primary">
                    Waaaat
                  </p>
                )}
              </div>
              <a
                href="https://app.everr.dev"
                className="group flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-7 py-3.5 font-heading text-sm font-bold tracking-tight text-fd-background outline-none transition-colors duration-200 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background motion-reduce:transition-none"
              >
                Get started
                <ArrowRight
                  className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
                  strokeWidth={2.5}
                  aria-hidden
                />
              </a>
            </div>
          </motion.div>

          <p className="mt-6 max-w-3xl font-mono text-[11px] leading-relaxed tracking-[0.05em] text-fd-muted-foreground/50">
            Estimates based on published pricing as of 2026. Actual costs vary
            with contract terms, volume discounts, and features. Everr figure
            uses the Pro plan: $39/mo + $8/user (first 3 free), with 300 GB
            total included, then $0.40/GB. Hosts are never billed.
          </p>
        </div>
      </section>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------ */
/*  Slider control                                                     */
/* ------------------------------------------------------------------ */

function Slider({
  control,
  value,
  onChange,
}: {
  control: Control;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const pct = ((value - control.min) / (control.max - control.min)) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium text-fd-foreground">
          {control.label}
        </label>
        <span className="font-mono text-sm text-fd-foreground">
          {value.toLocaleString("en-US")}{" "}
          <span className="text-fd-muted-foreground/60">{control.unit}</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${value} ${control.unit}`}
        className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        style={{
          background: `linear-gradient(to right, var(--color-primary) ${pct}%, var(--color-fd-border) ${pct}%)`,
        }}
      />
    </div>
  );
}
