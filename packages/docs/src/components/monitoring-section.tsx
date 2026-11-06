import { motion } from "motion/react";
import { DemoPlayer, type PlayerChapter } from "@/components/demo-player";
import {
  CHAPTER_MS,
  type Chapter,
  MonitoringDemo,
} from "@/components/monitoring-demo/MonitoringDemo";

// One color per chapter. Neighbours differ in lightness as well as hue (blue,
// amber, red, green, pink), so they stay distinct under color-vision deficiency.
const CHAPTERS: PlayerChapter<Chapter>[] = [
  {
    chapter: 0,
    label: "Catch performance bottlenecks",
    color: "oklch(0.7 0.15 255)",
    ms: CHAPTER_MS[0],
  },
  { chapter: 1, label: "Monitor traffic spikes", color: "oklch(0.83 0.15 80)", ms: CHAPTER_MS[1] },
  { chapter: 2, label: "Inspect errors", color: "oklch(0.66 0.2 22)", ms: CHAPTER_MS[2] },
  {
    chapter: 3,
    label: "Detect incidents before your users",
    color: "oklch(0.86 0.19 135)",
    ms: CHAPTER_MS[3],
  },
  {
    chapter: 4,
    label: "Respond the way your team planned",
    color: "oklch(0.78 0.17 340)",
    ms: CHAPTER_MS[4],
  },
];

export function MonitoringSection() {
  return (
    <section className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background">
      <div className="mx-auto max-w-7xl px-6 pt-10 pb-24 text-foreground sm:pt-[72px]">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mb-8 grid gap-5"
        >
          <h2 className="max-w-[18ch] text-balance text-[clamp(30px,3.5vw,44px)] leading-[1.12] tracking-[-0.025em]">
            An app can be up and still let users down
          </h2>
          <p className="max-w-[62ch] text-base leading-[1.65] text-muted-foreground">
            Monitoring goes beyond error reporting. See where your app slows down, how it responds
            to demand, and what led to a failure.
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          <DemoPlayer chapters={CHAPTERS}>{(player) => <MonitoringDemo {...player} />}</DemoPlayer>
        </motion.div>
      </div>
    </section>
  );
}
