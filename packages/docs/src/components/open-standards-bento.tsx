import { cn } from "@everr/ui/lib/utils";
import {
  ArrowRight,
  Boxes,
  Cloud,
  FileCode2,
  LineChart,
  type LucideIcon,
  Network,
  Terminal,
  Workflow,
} from "lucide-react";
import { motion, useInView } from "motion/react";
import { type ReactNode, useRef } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/*  Section                                                            */
/* ------------------------------------------------------------------ */

export function OpenStandardsBento() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section className="relative overflow-x-clip border-y-2 border-fd-border bg-fd-background">
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        {/* Header */}
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: EASE }}
          className="max-w-3xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Built on open standards
          </p>
          <h2 className="mt-4 text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Open standards, top to bottom.{" "}
            <span className="text-primary">Nothing proprietary to learn.</span>
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Everr doesn&apos;t invent a private model. Your telemetry is
            OpenTelemetry, your dashboards and alerts are plain files, and you
            query all of it with SQL.
          </p>
        </motion.div>

        {/* Bento */}
        <div className="mt-14 grid grid-cols-1 gap-4 md:mt-20 md:auto-rows-[18rem] md:grid-cols-3">
          {ITEMS.map((item, i) => (
            <BentoItem key={item.title} item={item} index={i} inView={inView} />
          ))}
        </div>

        {/* Footer link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : undefined}
          transition={{ duration: 0.6, delay: 0.5, ease: EASE }}
          className="mt-10 flex justify-center"
        >
          <a
            href="/docs/overview"
            className="group inline-flex items-center gap-1.5 font-heading text-sm font-bold text-fd-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
          >
            See how it fits together
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Bento item                                                        */
/* ------------------------------------------------------------------ */

type Item = {
  title: string;
  description: string;
  header: ReactNode;
  icon: LucideIcon;
  className?: string;
};

function BentoItem({
  item,
  index,
  inView,
}: {
  item: Item;
  index: number;
  inView: boolean;
}) {
  const Icon = item.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.7, delay: 0.1 + index * 0.08, ease: EASE }}
      className={cn(
        "group/bento row-span-1 flex min-h-[15rem] flex-col justify-between gap-4 overflow-hidden rounded-xl border border-fd-border bg-fd-card/40 p-5 transition-colors duration-300 hover:border-primary/40 md:min-h-0",
        item.className,
      )}
    >
      {item.header}
      <div className="transition-transform duration-300 group-hover/bento:translate-x-1.5">
        <div className="flex items-center gap-2">
          <Icon
            className="size-4 shrink-0 text-primary"
            strokeWidth={2}
            aria-hidden
          />
          <h3 className="font-heading text-base font-bold tracking-tight text-fd-foreground">
            {item.title}
          </h3>
        </div>
        <p className="mt-1.5 text-sm leading-snug text-fd-muted-foreground">
          {item.description}
        </p>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Placeholder — stands in until each tile illustration is designed  */
/* ------------------------------------------------------------------ */

function Placeholder() {
  return (
    <div
      className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-fd-border bg-fd-background/40"
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--color-fd-border) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
        backgroundPosition: "-1px -1px",
      }}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/40">
        placeholder
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Content                                                           */
/* ------------------------------------------------------------------ */

const ITEMS: Item[] = [
  {
    title: "Standard OpenTelemetry",
    description:
      "Traces, logs, and metrics in one model — the same on your laptop, in CI, and in production.",
    header: <Placeholder />,
    icon: Network,
  },
  {
    title: "CI & tests as signals",
    description:
      "GitHub Actions runs and test output become the same OpenTelemetry signals — structured data, not pasted screenshots.",
    header: <Placeholder />,
    icon: Workflow,
    className: "md:col-span-2",
  },
  {
    title: "Query with SQL",
    description:
      "One SQL surface across every signal. The same query runs locally and in the cloud.",
    header: <Placeholder />,
    icon: Terminal,
  },
  {
    title: "Perses dashboards",
    description:
      "The open CNCF dashboard spec, versioned as plain files — not locked in a UI.",
    header: <Placeholder />,
    icon: LineChart,
  },
  {
    title: "Standard OTLP ingest",
    description:
      "Send with any OpenTelemetry SDK over OTLP. No proprietary agent — point it at one endpoint.",
    header: <Placeholder />,
    icon: Cloud,
  },
  {
    title: "Dashboards & alerts as code",
    description:
      "Defined as files and reconciled with everr apply. Git is the source of truth, not a dashboard editor.",
    header: <Placeholder />,
    icon: FileCode2,
    className: "md:col-span-2",
  },
  {
    title: "One model, everywhere",
    description:
      "The same semantic model follows your code from local to CI to production.",
    header: <Placeholder />,
    icon: Boxes,
  },
];
