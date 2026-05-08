import { cn } from "@everr/ui/lib/utils";
import { type MotionValue, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useRef, useState } from "react";
import ClaudeCode from "./icons/claudecode.svg?react";

/** True once the viewport is at least the `md:` breakpoint (768px). */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

type Speaker =
  | "user"
  | "agent"
  | "agent-think"
  | "everr-ok"
  | "everr-err"
  | "blank";

type Line = {
  who: Speaker;
  text: string;
};

const LINES: Line[] = [
  // 1. User asks for a simple feature
  {
    who: "user",
    text: "⌥ Add GET /api/users — return each user with their last activity.",
  },
  { who: "blank", text: "" },

  // 2. Agent implements
  {
    who: "agent-think",
    text: "⏵ Wiring up GET /api/users with last_activity from sessions.",
  },
  { who: "agent-think", text: "⏵ Tests pass. Hitting the endpoint to verify." },
  { who: "blank", text: "" },

  // 3. Agent validates via Everr
  {
    who: "agent",
    text: "> everr query SELECT * \"FROM traces WHERE trace.name='GET /api/users'\"",
  },
  { who: "everr-err", text: "GET /api/users        1.4s    200 OK" },

  // 4. Regression: N+1 query
  {
    who: "everr-err",
    text: "  ↳ db.query × 187    1.2s    results=1 ",
  },
  { who: "blank", text: "" },

  // 5. Agent fixes
  {
    who: "agent-think",
    text: "⏵ Executing one query per user. Replacing with a single JOIN and verifying...",
  },
  { who: "blank", text: "" },

  // 6. Agent revalidates
  {
    who: "agent",
    text: "> everr query SELECT * \"FROM traces WHERE trace.name='GET /api/users'\"",
  },
  {
    who: "everr-ok",
    text: "GET /api/users        124ms   200 OK",
  },
  {
    who: "everr-ok",
    text: "  ↳ db.query × 1      68ms    results=187",
  },
  { who: "blank", text: "" },

  { who: "agent-think", text: "⏵ Done. Opening PR." },
];

export function Examples() {
  const ref = useRef<HTMLDivElement>(null);
  const isDesktop = useIsDesktop();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  return (
    <section ref={ref} className="relative overflow-x-clip">
      {/* Mobile: simple stacked layout — terminal renders fully, no sticky pin,
          no scroll-driven reveal. The pinned demo only runs at md+ where
          viewport heights are stable and the GPU can keep up. */}
      <div className="md:hidden">
        <div className="mx-auto max-w-2xl px-6 pt-16">
          <Intro />
        </div>
        <div className="mx-auto max-w-2xl px-1 pb-16 pt-12">
          <ScrollTerminal progress={scrollYProgress} forceReveal />
        </div>
      </div>

      {/* Desktop: tall scroll container with sticky-pinned terminal. */}
      <div className="relative hidden md:block md:h-[320vh]">
        <div className="sticky top-0 flex h-screen items-center">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-10 px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-16">
            <div className="self-center">
              <Intro />
            </div>
            <ScrollTerminal
              progress={scrollYProgress}
              forceReveal={!isDesktop}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Intro() {
  return (
    <div>
      <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
        Agent ↔ Everr
      </p>
      <h2 className="mt-4 font-heading text-3xl leading-[1.05] tracking-tight sm:text-4xl md:text-5xl">
        <span className="text-fd-foreground">Watch the agent</span>{" "}
        <span className="relative everr-decoration everr-decoration-primary">
          debug itself
        </span>
      </h2>
      <p className="mt-6 max-w-md text-base leading-relaxed text-fd-muted-foreground md:text-lg">
        A real conversation between a coding agent and Everr — query, identify,
        fix, verify. No screenshots. No hand-waving.
      </p>
      <p className="mt-8 hidden font-heading text-xs font-bold uppercase tracking-[0.25em] text-fd-muted-foreground/60 md:block">
        Scroll to play ↓
      </p>
    </div>
  );
}

function ScrollTerminal({
  progress,
  forceReveal = false,
}: {
  progress: MotionValue<number>;
  forceReveal?: boolean;
}) {
  // One subscription on the parent — derive how many visible lines should
  // be revealed and pass each child a plain boolean. Avoids N motion-value
  // listeners and N independent setStates per scroll tick.
  const visibleTotal = LINES.filter((l) => l.who !== "blank").length;

  const startMargin = 0.04;
  const endMargin = 0.08;
  const active = 1 - startMargin - endMargin;

  const computeRevealed = (v: number) => {
    const t = (v - startMargin) / active;
    if (t <= 0) return 0;
    if (t >= 1) return visibleTotal;
    return Math.floor(t * visibleTotal + 0.5);
  };

  const [revealed, setRevealed] = useState(() =>
    forceReveal ? visibleTotal : computeRevealed(progress.get()),
  );
  useMotionValueEvent(progress, "change", (v) => {
    if (forceReveal) return;
    const next = computeRevealed(v);
    setRevealed((current) => (current === next ? current : next));
  });
  // Resync whenever forceReveal flips. On mobile (forceReveal=true) keep all
  // lines visible. On desktop (forceReveal=false) seed from current scroll
  // progress, otherwise the prior visibleTotal sticks until the next scroll
  // event and the lines briefly flash on then off.
  useEffect(() => {
    setRevealed(forceReveal ? visibleTotal : computeRevealed(progress.get()));
    // computeRevealed is recomputed each render but only called here; deps
    // intentionally limited to the trigger conditions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceReveal, visibleTotal]);

  let visibleIndex = -1;

  return (
    <div className="relative mx-auto w-full min-w-0 max-w-2xl md:justify-self-end">
      {/* Subtle glow on the bezel — desktop only; backdrop blur is expensive on mobile */}
      <div className="pointer-events-none absolute -inset-6 hidden rounded-2xl bg-primary/5 blur-2xl md:block" />
      <div className="relative overflow-hidden rounded-xl border-2 border-fd-border bg-fd-card shadow-xl shadow-black/30 md:shadow-2xl md:shadow-black/40">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b-2 border-fd-border px-3 py-2.5 sm:px-4 sm:py-3">
          <span className="size-2.5 rounded-full bg-red-500/70" />
          <span className="size-2.5 rounded-full bg-yellow-500/70" />
          <span className="size-2.5 rounded-full bg-green-500/70" />
          <span className="ml-3 flex items-center font-mono text-[11px] uppercase tracking-[0.2em] text-fd-muted-foreground/60">
            <ClaudeCode className="size-4 sm:size-5" />
          </span>
        </div>

        <pre className="grid gap-y-1.5 px-4 py-4 font-mono text-[11px] leading-[1.6] md:overflow-x-auto md:px-5 md:py-5 md:text-[13px]">
          {LINES.map((line, i) => {
            if (line.who !== "blank") visibleIndex += 1;
            const visible =
              line.who === "blank" ? true : visibleIndex < revealed;
            return (
              <ScrollLine
                key={`${i}-${line.text.slice(0, 16)}`}
                line={line}
                visible={visible}
              />
            );
          })}
        </pre>
      </div>
    </div>
  );
}

function ScrollLine({ line, visible }: { line: Line; visible: boolean }) {
  if (line.who === "blank") {
    return <span className="block h-2" aria-hidden />;
  }

  return (
    <span
      className={cn(
        "block whitespace-pre-wrap break-words transition-opacity duration-100 ease-out md:whitespace-pre md:break-normal",
        visible ? "opacity-100" : "opacity-0",
        line.who === "user" && "text-fd-foreground/90",
        line.who === "agent" && "text-primary",
        line.who === "agent-think" && "text-fd-foreground",
        line.who === "everr-ok" && "text-emerald-400/90",
        line.who === "everr-err" && "text-red-400/90",
      )}
    >
      {line.text}
    </span>
  );
}
