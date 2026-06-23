import { cn } from "@everr/ui/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type Beat = {
  img: string;
  alt: string;
  w: number;
  h: number;
  title: ReactNode;
  caption: string;
  reverse?: boolean;
};

const BEATS: Beat[] = [
  {
    img: "/home/dashboard.png",
    w: 3450,
    h: 1996,
    alt: "An Everr dashboard of Node.js runtime metrics: event-loop delay, V8 heap by space, GC pause, and active worker jobs.",
    title: (
      <>
        Dashboards <span className="text-primary">as-code</span>
      </>
    ),
    caption:
      "We use Perses, an open standard to write dashboards. Your LLM already knows it, the same way it knows HTML",
  },
  {
    img: "/home/runbook.png",
    w: 3452,
    h: 1996,
    alt: "An Everr runbook for spotting resource pressure, with prose explaining what to look for next to live Node CPU and memory panels.",
    title: (
      <>
        Runbooks are just <span className="text-primary">markdown</span>
      </>
    ),
    caption:
      "Easy to write, your collegue will thank you when the systems are down and you are on the beach driking margarita",
    reverse: true,
  },
  {
    img: "/home/native-app.png",
    w: 2624,
    h: 1824,
    alt: "The Everr native app's Traces view, with a five-minute trace flagged before it ever shipped.",
    title: (
      <>
        Test it <span className="text-primary">locally</span>
      </>
    ),
    caption:
      "Our desktop app has a built-in OpenTelemetry collector. Use it to validate the telemetry you have just added, or to debug what's happening in your app. Traces work way better than console.log",
  },
];

export function ProductShowcase() {
  const reduced = useReducedMotion();

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-32">
        <div className="mt-16 space-y-20 md:mt-24 md:space-y-32">
          {BEATS.map((beat) => (
            <BeatRow key={beat.img} beat={beat} reduced={!!reduced} />
          ))}
        </div>
      </div>
    </section>
  );
}

function BeatRow({ beat, reduced }: { beat: Beat; reduced: boolean }) {
  const reveal = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-12% 0px" },
          transition: { duration: 0.7, delay, ease: EASE },
        };

  return (
    <div className="grid items-center gap-8 md:grid-cols-2 md:gap-14">
      <motion.div
        {...reveal(0)}
        className={cn("relative", beat.reverse && "md:order-2")}
      >
        {/* soft lime halo behind the frame, desktop only (blur is costly on mobile) */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-4 hidden rounded-3xl bg-primary/[0.07] blur-2xl md:block"
        />
        <div className="relative overflow-hidden rounded-xl border-2 border-fd-border bg-fd-card shadow-2xl shadow-black/40">
          <img
            src={beat.img}
            alt={beat.alt}
            width={beat.w}
            height={beat.h}
            loading="lazy"
            decoding="async"
            className="block h-auto w-full"
          />
        </div>
      </motion.div>

      <motion.div {...reveal(0.1)} className={cn(beat.reverse && "md:order-1")}>
        <h3 className="font-heading text-2xl font-bold text-fd-foreground sm:text-3xl">
          {beat.title}
        </h3>
        <p className="mt-4 max-w-md text-base leading-relaxed text-fd-muted-foreground md:text-lg">
          {beat.caption}
        </p>
      </motion.div>
    </div>
  );
}
