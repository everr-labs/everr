import { createFileRoute } from "@tanstack/react-router";
import { Shuffle, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, useEffect, useId, useState } from "react";
import { AgentsCompare } from "@/components/agents-compare";
import { Community } from "@/components/community";
import { FAQ } from "@/components/faq";
import { FeaturedTestimonial } from "@/components/featured-testimonial";
import { FeaturesZigzag } from "@/components/features-zigzag";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { PricingMatrix } from "@/components/pricing-matrix";
import { PricingToggle } from "@/components/pricing-toggle";
import { QuickstartFriction } from "@/components/quickstart-friction";
import { Species } from "@/components/species";
import { ToolsExplainer } from "@/components/tools-explainer";
import { VideoSection } from "@/components/video-section";

/**
 * Homepage variant playground. Pick any combination of the four candidate
 * sections from the toolbar; the rest of the page is the finished, shared
 * layout (no placeholder stubs). The current combination lives in the URL
 * search params, so a layout you like is shareable/bookmarkable.
 *
 * This route is NOT linked from the main site — it's an internal preview.
 */

// Only the shipped variants remain — the losing candidates were removed. The
// picker is kept as scaffolding for future variant exploration.
const FEATURES: Record<string, ComponentType> = {
  zigzag: FeaturesZigzag,
};

const AGENTS: Record<string, ComponentType> = {
  compare: AgentsCompare,
};

const PRICING: Record<string, ComponentType> = {
  toggle: PricingToggle,
  matrix: PricingMatrix,
};

const QUICKSTART: Record<string, ComponentType> = {
  friction: QuickstartFriction,
};

type PreviewSearch = {
  features: string;
  agents: string;
  pricing: string;
  quickstart: string;
};

const DEFAULTS: PreviewSearch = {
  features: "zigzag",
  agents: "compare",
  pricing: "toggle",
  quickstart: "friction",
};

function pick(
  map: Record<string, ComponentType>,
  key: string,
  fallback: string,
) {
  return map[key] ?? map[fallback];
}

export const Route = createFileRoute("/preview")({
  validateSearch: (search: Record<string, unknown>): PreviewSearch => ({
    features:
      typeof search.features === "string" ? search.features : DEFAULTS.features,
    agents: typeof search.agents === "string" ? search.agents : DEFAULTS.agents,
    pricing:
      typeof search.pricing === "string" ? search.pricing : DEFAULTS.pricing,
    quickstart:
      typeof search.quickstart === "string"
        ? search.quickstart
        : DEFAULTS.quickstart,
  }),
  component: PreviewPage,
});

function PreviewPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const update = (patch: Partial<PreviewSearch>) => {
    navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });
  };

  const randomize = () => {
    const rand = (map: Record<string, ComponentType>) => {
      const keys = Object.keys(map);
      return keys[Math.floor(Math.random() * keys.length)];
    };
    navigate({
      search: {
        features: rand(FEATURES),
        agents: rand(AGENTS),
        pricing: rand(PRICING),
        quickstart: rand(QUICKSTART),
      },
      replace: true,
      resetScroll: false,
    });
  };

  const Features = pick(FEATURES, search.features, DEFAULTS.features);
  const Agents = pick(AGENTS, search.agents, DEFAULTS.agents);
  const Pricing = pick(PRICING, search.pricing, DEFAULTS.pricing);
  const Quickstart = pick(QUICKSTART, search.quickstart, DEFAULTS.quickstart);

  return (
    <div className="overflow-x-clip">
      <PreviewControls
        search={search}
        onChange={update}
        onRandomize={randomize}
      />

      <Hero />
      <Species />
      <VideoSection />
      <Features />
      <Agents />
      <ToolsExplainer />
      <Quickstart />
      <HowItWorks />
      <Pricing />
      <FeaturedTestimonial />
      <FAQ />
      <Community />
      <FinalCTA />
      <Footer />
    </div>
  );
}

function PreviewControls({
  search,
  onChange,
  onRandomize,
}: {
  search: PreviewSearch;
  onChange: (patch: Partial<PreviewSearch>) => void;
  onRandomize: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Escape closes the panel. It otherwise stays open while you scroll/tweak.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="fixed right-6 bottom-6 z-[60] flex flex-col items-end gap-3">
      <AnimatePresence>
        {open ? (
          <motion.div
            id={panelId}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="w-[min(19rem,calc(100vw-3rem))] rounded-xl border border-fd-border bg-fd-background/95 p-5 shadow-2xl shadow-black/50 backdrop-blur-md"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex flex-col">
                <span className="font-heading text-sm font-bold leading-none text-fd-foreground">
                  Homepage preview
                </span>
                <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground/70">
                  mix &amp; match every section
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close panel"
                className="-m-1 rounded-md p-1 text-fd-muted-foreground outline-none transition-colors hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <Picker
                label="Features"
                map={FEATURES}
                value={search.features}
                onSelect={(v) => onChange({ features: v })}
              />
              <Picker
                label="Agents"
                map={AGENTS}
                value={search.agents}
                onSelect={(v) => onChange({ agents: v })}
              />
              <Picker
                label="Pricing"
                map={PRICING}
                value={search.pricing}
                onSelect={(v) => onChange({ pricing: v })}
              />
              <Picker
                label="Quick start"
                map={QUICKSTART}
                value={search.quickstart}
                onSelect={(v) => onChange({ quickstart: v })}
              />
            </div>

            <button
              type="button"
              onClick={onRandomize}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md border border-fd-border px-3 py-2 font-heading text-xs font-bold text-fd-foreground outline-none transition-colors hover:border-primary/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Shuffle className="size-3.5" aria-hidden />
              Surprise me
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-4 py-3 font-heading text-xs font-bold text-fd-foreground shadow-2xl shadow-black/50 outline-none transition-colors hover:border-primary/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
      >
        <SlidersHorizontal className="size-4 text-primary" aria-hidden />
        Layout
      </button>
    </div>
  );
}

function Picker({
  label,
  map,
  value,
  onSelect,
}: {
  label: string;
  map: Record<string, ComponentType>;
  value: string;
  onSelect: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="font-heading text-[10px] font-bold uppercase tracking-[0.2em] text-fd-muted-foreground"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full cursor-pointer rounded-md border border-fd-border bg-fd-card px-2.5 py-2 font-mono text-xs text-fd-foreground outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary"
      >
        {Object.keys(map).map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
    </div>
  );
}
