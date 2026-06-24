import { cn } from "@everr/ui/lib/utils";
import {
  Activity,
  BellRing,
  Bot,
  ChevronLeft,
  ChevronRight,
  Layers,
  type LucideIcon,
  PiggyBank,
  Search,
  Unplug,
} from "lucide-react";
import { motion, useInView } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type Feature = {
  icon: LucideIcon;
  title: string;
  blurb: string;
};

const FEATURES: Feature[] = [
  {
    icon: Layers,
    title: "Unified logs, traces & metrics",
    blurb:
      "Every signal lands in one place, correlated by default — no stitching across four disconnected tools.",
  },
  {
    icon: Search,
    title: "One query surface",
    blurb:
      "Ask the same question of any telemetry type. One syntax, one mental model, one box to type into.",
  },
  {
    icon: Activity,
    title: "Tiered retention",
    blurb:
      "Keep hot data instant and cold data cheap. Set the curve once and let it run on autopilot.",
  },
  {
    icon: BellRing,
    title: "Alerting & SLOs",
    blurb:
      "Define objectives, burn-rate alerts, and escalations next to the data they watch over.",
  },
  {
    icon: Unplug,
    title: "Open & portable",
    blurb:
      "Built on OpenTelemetry end to end. No proprietary agents, no lock-in, your data stays yours.",
  },
  {
    icon: Bot,
    title: "Built for agents",
    blurb:
      "A query interface your coding agents already understand, so they reason from real runtime truth.",
  },
  {
    icon: PiggyBank,
    title: "Cost at scale",
    blurb:
      "Predictable pricing that doesn't punish you for shipping. Watch spend, not surprises.",
  },
];

export function FeaturesCarousel() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: true, margin: "-15% 0px" });

  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const syncScrollState = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;

    const { scrollLeft, scrollWidth, clientWidth } = track;
    const maxScroll = scrollWidth - clientWidth;

    setAtStart(scrollLeft <= 1);
    setAtEnd(scrollLeft >= maxScroll - 1);

    const cards = track.querySelectorAll<HTMLElement>("[data-card]");
    if (cards.length === 0) return;

    // Card width including the flex gap, derived from the first two cards.
    const first = cards[0];
    const step =
      cards.length > 1
        ? cards[1].offsetLeft - first.offsetLeft
        : first.offsetWidth;
    const idx = Math.round(scrollLeft / step);
    setActiveIndex(Math.max(0, Math.min(cards.length - 1, idx)));
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    syncScrollState();
    track.addEventListener("scroll", syncScrollState, { passive: true });
    window.addEventListener("resize", syncScrollState);
    return () => {
      track.removeEventListener("scroll", syncScrollState);
      window.removeEventListener("resize", syncScrollState);
    };
  }, [syncScrollState]);

  const scrollToCard = useCallback((index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const cards = track.querySelectorAll<HTMLElement>("[data-card]");
    const target = cards[Math.max(0, Math.min(cards.length - 1, index))];
    if (!target) return;
    track.scrollTo({ left: target.offsetLeft, behavior: "smooth" });
  }, []);

  const scrollByDirection = useCallback(
    (direction: 1 | -1) => {
      scrollToCard(activeIndex + direction);
    },
    [activeIndex, scrollToCard],
  );

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background"
    >
      <span className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-primary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
        variant · carousel
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
            Everything you need, on one rail.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Slide through the platform — every capability built on the same open
            pipeline, the same query surface, the same predictable bill.
          </p>
        </motion.div>

        {/* Controls row: progress + prev/next */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
          className="mt-12 flex items-center justify-between gap-6"
        >
          <div className="flex min-w-0 items-center gap-4">
            <span className="font-mono text-xs tabular-nums text-fd-muted-foreground/60">
              <span className="text-fd-foreground">
                {String(activeIndex + 1).padStart(2, "0")}
              </span>
              {" / "}
              {String(FEATURES.length).padStart(2, "0")}
            </span>
            <div
              className="relative h-px w-32 overflow-hidden bg-fd-border sm:w-48"
              aria-hidden
            >
              <motion.span
                className="absolute inset-y-0 left-0 bg-primary"
                animate={{
                  width: `${((activeIndex + 1) / FEATURES.length) * 100}%`,
                }}
                transition={{ duration: 0.4, ease: EASE }}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ArrowButton
              label="Previous capability"
              disabled={atStart}
              onClick={() => scrollByDirection(-1)}
            >
              <ChevronLeft className="size-4" />
            </ArrowButton>
            <ArrowButton
              label="Next capability"
              disabled={atEnd}
              onClick={() => scrollByDirection(1)}
            >
              <ChevronRight className="size-4" />
            </ArrowButton>
          </div>
        </motion.div>
      </div>

      {/* Full-bleed track so cards can peek at the edges. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : undefined}
        transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
        className="-mt-4 pb-24 md:-mt-8 md:pb-36"
      >
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: a scrollable carousel track benefits from an accessible name for screen-reader navigation */}
        <div
          ref={trackRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a labeled scroll region must be keyboard-focusable so arrow keys can scroll it
          tabIndex={0}
          aria-label="Capabilities carousel"
          className={cn(
            "no-scrollbar flex snap-x snap-mandatory gap-5 overflow-x-auto",
            "scroll-smooth px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "focus-visible:outline-none",
          )}
          style={{
            // Center the active card within the max-w-7xl reading column.
            scrollPaddingLeft:
              "max(1.5rem, calc((100vw - 80rem) / 2 + 1.5rem))",
            paddingLeft: "max(1.5rem, calc((100vw - 80rem) / 2 + 1.5rem))",
            paddingRight: "max(1.5rem, calc((100vw - 80rem) / 2 + 1.5rem))",
          }}
        >
          {FEATURES.map((feature, i) => (
            <FeatureCard
              key={feature.title}
              feature={feature}
              index={i}
              inView={inView}
            />
          ))}
        </div>
      </motion.div>

      {/* Pagination dots */}
      <div className="mx-auto -mt-12 flex max-w-7xl justify-center gap-2 px-6 pb-24 md:pb-28">
        {FEATURES.map((feature, i) => (
          <button
            key={feature.title}
            type="button"
            aria-label={`Go to ${feature.title}`}
            aria-current={i === activeIndex}
            onClick={() => scrollToCard(i)}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
              i === activeIndex
                ? "w-6 bg-primary"
                : "w-1.5 bg-fd-border hover:bg-fd-muted-foreground/50",
            )}
          />
        ))}
      </div>
    </section>
  );
}

function ArrowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-10 items-center justify-center rounded-full border border-fd-border bg-fd-card/30 text-fd-foreground transition-colors",
        "hover:border-primary/60 hover:text-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background",
        "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-fd-border disabled:hover:text-fd-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FeatureCard({
  feature,
  index,
  inView,
}: {
  feature: Feature;
  index: number;
  inView: boolean;
}) {
  const Icon = feature.icon;
  return (
    <motion.article
      data-card
      initial={{ opacity: 0, y: 28 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.7, delay: 0.25 + index * 0.07, ease: EASE }}
      className={cn(
        "group flex shrink-0 snap-start flex-col rounded-xl border border-fd-border bg-fd-card/30 p-5 transition-colors hover:border-primary/40",
        "w-[78vw] sm:w-[58vw] md:w-[42vw] lg:w-[30rem]",
      )}
    >
      <Shot label={`${String(index + 1).padStart(2, "0")} · screenshot`} />

      <div className="mt-6 flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-fd-border bg-fd-background text-fd-muted-foreground transition-colors group-hover:border-primary/50 group-hover:text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-bold leading-tight text-fd-foreground">
            {feature.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
            {feature.blurb}
          </p>
        </div>
      </div>
    </motion.article>
  );
}

function Shot({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-fd-border bg-fd-background">
      {/* Window chrome */}
      <div className="flex items-center gap-1.5 border-b border-fd-border bg-fd-card/40 px-3 py-2">
        <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
        <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
        <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
      </div>
      {/* Screenshot body */}
      <div
        className="relative flex aspect-video items-center justify-center"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--color-fd-border) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        <span className="font-mono text-xs text-fd-muted-foreground/40">
          {label}
        </span>
      </div>
    </div>
  );
}
