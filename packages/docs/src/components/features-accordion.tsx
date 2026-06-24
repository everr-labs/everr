import { cn } from "@everr/ui/lib/utils";
import {
  Activity,
  BellRing,
  Bot,
  ChevronDown,
  Layers,
  type LucideIcon,
  Search,
  Unplug,
} from "lucide-react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { useRef, useState } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type Feature = {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
};

const FEATURES: Feature[] = [
  {
    id: "unified",
    icon: Layers,
    title: "Unified logs, traces & metrics",
    body: "One pipeline ingests every signal — structured logs, distributed traces, and high-cardinality metrics — and stitches them into a single timeline. Jump from a slow span to the exact log line that explains it without ever leaving the page.",
  },
  {
    id: "query",
    icon: Search,
    title: "One query surface",
    body: "Stop juggling four dialects. The same expression language spans logs, traces, and metrics, so a query you write once works everywhere. Autocomplete, saved views, and shareable links come standard.",
  },
  {
    id: "retention",
    icon: Activity,
    title: "Tiered retention",
    body: "Keep hot data instant and cold data cheap. Define per-stream retention tiers and watch Everr move older telemetry to object storage automatically — queryable, just slower, never deleted by surprise.",
  },
  {
    id: "alerting",
    icon: BellRing,
    title: "Alerting & SLOs",
    body: "Turn any query into an alert and any alert into an SLO. Burn-rate windows, multi-signal conditions, and routing to the channels your team already lives in — no separate alerting product to babysit.",
  },
  {
    id: "open",
    icon: Unplug,
    title: "Open & portable",
    body: "Built on OpenTelemetry end to end. Your instrumentation, your data, your schema — exportable at any time. No proprietary agents, no lock-in, no surprise when you want to leave.",
  },
  {
    id: "agents",
    icon: Bot,
    title: "Built for agents",
    body: "Coding agents read the same telemetry you do, through an interface designed for machines as much as humans. Ground-truth runtime behavior on tap, so the agent stops guessing and starts answering.",
  },
];

export function FeaturesAccordion() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const [openId, setOpenId] = useState<string>(FEATURES[0].id);

  return (
    <section
      ref={ref}
      className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · accordion
      </span>

      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Capabilities
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Everything you expect.
            <br className="hidden sm:block" /> None of the babysitting.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            A full observability stack behind one query surface. Expand any
            capability to see how it fits.
          </p>
        </motion.div>

        <motion.ul
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : undefined}
          transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
          className="mt-16 flex flex-col border-t border-fd-border md:mt-20"
        >
          {FEATURES.map((feature, i) => (
            <AccordionRow
              key={feature.id}
              feature={feature}
              index={i}
              open={openId === feature.id}
              onToggle={() =>
                setOpenId((cur) => (cur === feature.id ? "" : feature.id))
              }
              inView={inView}
            />
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

function AccordionRow({
  feature,
  index,
  open,
  onToggle,
  inView,
}: {
  feature: Feature;
  index: number;
  open: boolean;
  onToggle: () => void;
  inView: boolean;
}) {
  const Icon = feature.icon;
  const panelId = `feature-panel-${feature.id}`;
  const headerId = `feature-header-${feature.id}`;
  const num = String(index + 1).padStart(2, "0");

  return (
    <motion.li
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.6, delay: 0.25 + index * 0.07, ease: EASE }}
      className={cn(
        "border-b border-fd-border transition-colors duration-300",
        open && "bg-fd-card/40",
      )}
    >
      <h3>
        <button
          type="button"
          id={headerId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={cn(
            "group flex w-full items-center gap-4 px-2 py-6 text-left outline-none transition-colors md:gap-6 md:px-4 md:py-8",
            "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
          )}
        >
          <span className="hidden w-10 shrink-0 font-mono text-xs tabular-nums text-fd-muted-foreground/40 sm:block">
            {num}
          </span>

          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg border transition-colors duration-300",
              open
                ? "border-primary/40 text-primary"
                : "border-fd-border text-fd-muted-foreground group-hover:text-fd-foreground",
            )}
          >
            <Icon className="size-5" strokeWidth={1.75} aria-hidden />
          </span>

          <span
            className={cn(
              "flex-1 font-heading text-xl font-bold tracking-tight transition-colors duration-300 md:text-2xl",
              open
                ? "text-primary"
                : "text-fd-foreground/90 group-hover:text-fd-foreground",
            )}
          >
            {feature.title}
          </span>

          <ChevronDown
            aria-hidden
            strokeWidth={2}
            className={cn(
              "size-5 shrink-0 transition-all duration-300 ease-out",
              open
                ? "rotate-180 text-primary"
                : "text-fd-muted-foreground group-hover:text-fd-foreground",
            )}
          />
        </button>
      </h3>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            id={panelId}
            role="region"
            aria-labelledby={headerId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.45, ease: EASE },
              opacity: { duration: 0.3, ease: EASE },
            }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 gap-8 px-2 pb-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-center md:gap-12 md:px-4 md:pb-12 md:pl-20">
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1, ease: EASE }}
                className="max-w-md text-base leading-relaxed text-fd-muted-foreground md:text-lg"
              >
                {feature.body}
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.14, ease: EASE }}
              >
                <Shot label={feature.title} />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function Shot({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl shadow-black/20">
      <div className="flex items-center gap-2 border-b border-fd-border bg-fd-card/60 px-4 py-3">
        <span className="size-2.5 rounded-full bg-fd-muted-foreground/25" />
        <span className="size-2.5 rounded-full bg-fd-muted-foreground/25" />
        <span className="size-2.5 rounded-full bg-fd-muted-foreground/25" />
        <span className="ml-2 truncate font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/40">
          {label}
        </span>
      </div>
      <div
        className="relative flex aspect-video items-center justify-center bg-fd-background/40"
        style={{
          backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
          backgroundSize: "16px 16px",
          color: "var(--color-fd-border)",
        }}
      >
        <span className="font-mono text-xs text-fd-muted-foreground/40">
          screenshot
        </span>
      </div>
    </div>
  );
}
