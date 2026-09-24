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
import {
  calculateEverrCharges,
  EVERR_PRICING,
} from "@/components/pricing-calculator-model";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/*  Cost model                                                         */
/*                                                                     */
/*  Provider list prices are estimated in USD and converted to EUR for     */
/*  comparison. Everr's 300 GB ingestion allowance is pooled across all   */
/*  signals, so its overage appears as one row.                           */
/* ------------------------------------------------------------------ */

// ECB reference rate for 23 September 2026: €1 = $1.1411.
const EUR_USD_REFERENCE_RATE = 1.1411;

const LOG_KB = 2;
// A log/error event is ~2 KB (500k ≈ 1 GB); a metric series counts as ~1 GB
// per 1k, so its k-value is used directly as GB in Everr's volume billing.
const kEventsToGb = (kEvents: number) => (kEvents * 1000 * LOG_KB) / 1_000_000;

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
type Cell = { amount: number; trap?: string; display?: string };
// `control` is the slider key that drives this row; it orders the summary.
type Row = { label: string; control?: string; everr: Cell; provider: Cell };

type Provider = {
  id: string;
  label: string;
  controls: Control[];
  rows: (v: Values) => Row[];
};

const seatsRow = (
  teamSize: number,
  providerPerSeat: number,
  providerFreeSeats = 0,
): Row => ({
  label: "Seats",
  control: "teamSize",
  everr: { amount: 0 },
  provider: {
    amount: Math.max(0, teamSize - providerFreeSeats) * providerPerSeat,
  },
});

const baseRow = (providerAmount: number): Row => ({
  label: "Base",
  everr: { amount: EVERR_PRICING.baseEur },
  provider: { amount: providerAmount },
});

function ingestionRow(v: Values, includeErrors = false): Row {
  const ingestionGb =
    v.metricSeries +
    v.logVolume +
    v.traceVolume +
    (includeErrors ? kEventsToGb(v.errorEvents) : 0);
  return {
    label: "Ingestion overage",
    everr: {
      amount: calculateEverrCharges({
        ingestionGb,
        uptimeMonitors: EVERR_PRICING.includedUptimeMonitors,
      }).ingestionOverageEur,
    },
    provider: { amount: 0, display: "See signal rows" },
  };
}

function uptimeRow(v: Values): Row {
  return {
    label: "Uptime monitors",
    control: "uptimeMonitors",
    everr: {
      amount: calculateEverrCharges({
        ingestionGb: 0,
        uptimeMonitors: v.uptimeMonitors,
      }).uptimeMonitorsEur,
    },
    provider: { amount: 0, display: "Not modeled" },
  };
}

type Cat = { label: string; control: string; provider: Cell };
function dataRows(cats: Cat[]): Row[] {
  return cats.map((c) => ({
    label: c.label,
    control: c.control,
    everr: { amount: 0 },
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
    controls: [
      METRIC_SERIES(),
      LOG_VOLUME(),
      TRACE_VOLUME(),
      TEAM_SIZE(),
      UPTIME_MONITORS(),
    ],
    rows: (v) => [
      baseRow(19),
      ...dataRows([
        {
          label: "Metrics",
          control: "metricSeries",
          provider: {
            amount: Math.max(0, v.metricSeries - 10) * 6.5,
            trap: "Billed per active time series past 10k free. It scales with metric cardinality, so high-cardinality tags multiply the count fast.",
          },
        },
        {
          label: "Logs",
          control: "logVolume",
          provider: { amount: Math.max(0, v.logVolume - 50) * 0.5 },
        },
        {
          label: "Traces",
          control: "traceVolume",
          provider: { amount: Math.max(0, v.traceVolume - 50) * 0.5 },
        },
      ]),
      seatsRow(v.teamSize, 8, 3),
      ingestionRow(v),
      uptimeRow(v),
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
      UPTIME_MONITORS(),
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
      baseRow(0),
      {
        label: "Infrastructure",
        control: "infraHosts",
        everr: { amount: 0 },
        provider: {
          amount: v.infraHosts * 15,
          trap: "Flat per-host fee. Every monitored host is billed $15/mo, busy or idle.",
        },
      },
      {
        label: "APM",
        control: "apmHosts",
        everr: { amount: 0 },
        provider: {
          amount: v.apmHosts * 31,
          trap: "Billed per host again, on top of infrastructure. Trace-heavy services need more APM hosts.",
        },
      },
      ...dataRows([
        {
          label: "Logs",
          control: "logVolume",
          provider: {
            amount: v.logVolume * 0.36,
            trap: "The per-GB rate is ingestion only. Indexing and retention are billed separately and usually dwarf it.",
          },
        },
        {
          label: "Traces",
          control: "traceVolume",
          provider: {
            // Ingested spans beyond the 150 GB/APM-host allotment: $0.10/GB.
            amount:
              Math.max(
                0,
                v.traceVolume - v.apmHosts * DATADOG_SPAN_GB_PER_HOST,
              ) * 0.1,
            trap: "Spans past the 150 GB/host allotment, plus indexed-span retention billed on top.",
          },
        },
        {
          label: "Metrics",
          control: "metricSeries",
          provider: {
            // Custom metrics beyond the 100/host allotment: ~$0.05 each.
            amount:
              Math.max(
                0,
                v.metricSeries * 1000 - v.infraHosts * DATADOG_METRICS_PER_HOST,
              ) * 0.05,
            trap: "Custom metrics past 100/host cost ~$0.05 each. High-cardinality tags multiply this fast.",
          },
        },
      ]),
      seatsRow(v.teamSize, 0),
      ingestionRow(v),
      uptimeRow(v),
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
      UPTIME_MONITORS(),
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
      baseRow(29),
      ...dataRows([
        {
          label: "Errors",
          control: "errorEvents",
          provider: {
            amount: Math.max(0, v.errorEvents - 50) * 0.3,
            trap: "50k errors are included, but past that they add up fast at production volume. On Everr, errors are just logs, billed at the normal log rate.",
          },
        },
        {
          label: "Logs",
          control: "logVolume",
          provider: { amount: Math.max(0, v.logVolume - 5) * 0.5 },
        },
        {
          label: "Traces",
          control: "traceVolume",
          provider: { amount: Math.max(0, v.traceVolume - 5) * 0.5 },
        },
        {
          label: "Metrics",
          control: "metricSeries",
          provider: { amount: v.metricSeries * 0.5 },
        },
      ]),
      seatsRow(v.teamSize, 0),
      ingestionRow(v, true),
      uptimeRow(v),
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

function UPTIME_MONITORS(): Control {
  return {
    key: "uptimeMonitors",
    label: "Uptime monitors",
    unit: "monitors",
    min: 0,
    max: 100,
    step: 1,
    default: 10,
  };
}

function eur(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
  }).format(n);
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
  // Rows without a control (Base) sort first.
  const orderedRows = useMemo(() => {
    const rank = (row: Row) =>
      row.control
        ? provider.controls.findIndex((c) => c.key === row.control)
        : -1;
    return [...rows].sort((a, b) => rank(a) - rank(b));
  }, [rows, provider]);
  const everrTotal = useMemo(
    () => rows.reduce((s, r) => s + r.everr.amount, 0),
    [rows],
  );
  const providerTotalUsd = useMemo(
    () => rows.reduce((s, r) => s + r.provider.amount, 0),
    [rows],
  );
  const providerTotalEur = providerTotalUsd / EUR_USD_REFERENCE_RATE;

  const savings = providerTotalEur - everrTotal;
  const savingsPct =
    providerTotalEur > 0 ? Math.round((savings / providerTotalEur) * 100) : 0;
  const yearly = savings * 12;

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
                    {eur(everrTotal)}
                  </span>
                  <span className="pb-1 font-mono text-sm text-fd-muted-foreground/70">
                    / mo
                  </span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-fd-muted-foreground/60">
                  Pro plan, 300 GB ingestion and 10 uptime monitors included
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
                        {eur(row.everr.amount)}
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
                    {eur(providerTotalEur)}
                  </span>
                  <span className="pb-1 font-mono text-sm text-fd-muted-foreground/50">
                    / mo
                  </span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-fd-muted-foreground/40">
                  Estimated, converted from USD
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
                        {row.provider.display ? (
                          <span className="text-fd-muted-foreground/60">
                            {row.provider.display}
                          </span>
                        ) : row.provider.trap ? (
                          <Tooltip>
                            <TooltipTrigger className="cursor-help rounded font-medium text-rose-400 underline decoration-rose-400/40 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50">
                              {eur(
                                row.provider.amount / EUR_USD_REFERENCE_RATE,
                              )}
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-left leading-relaxed">
                              {row.provider.trap}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-fd-muted-foreground/80">
                            {eur(row.provider.amount / EUR_USD_REFERENCE_RATE)}
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
                      <span className="text-primary">{eur(savings)}/month</span>
                    </p>
                    <p className="mt-1.5 text-sm text-fd-muted-foreground">
                      That's {savingsPct}% less than {provider.label}, or{" "}
                      {eur(yearly)}/year back in your budget.
                    </p>
                  </>
                ) : (
                  <p className="font-heading text-xl font-bold text-fd-foreground md:text-2xl">
                    Everr is {eur(-savings)}/month more for this usage.
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
            Estimates based on provider list prices in USD. Conversion uses the{" "}
            <a
              href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html"
              className="underline underline-offset-2 hover:text-fd-foreground"
            >
              ECB reference rate
            </a>{" "}
            for 23 September 2026 (€1 = $1.1411). Everr Pro includes 300 GB
            pooled ingestion, then costs €0.10/GB, plus €1 for each uptime
            monitor beyond 10. Users are unlimited. Query overage and provider
            uptime monitoring are excluded because their prices are not
            specified here. Actual provider costs vary by contract, volume, and
            features.
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
