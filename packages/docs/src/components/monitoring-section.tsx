import { DemoPlayer, type PlayerChapter } from "@/components/demo-player";
import {
  CHAPTER_MS,
  type Chapter,
  MonitoringDemo,
} from "@/components/monitoring-demo/MonitoringDemo";
import { sectionHeading, sectionLead, sectionWrap } from "@/components/ui/type";

// One color per chapter. Neighbours differ in lightness as well as hue (blue,
// amber, red, green, pink), so they stay distinct under color-vision deficiency.
const CHAPTERS: PlayerChapter<Chapter>[] = [
  {
    chapter: 0,
    label: "Slow pages",
    question: "Why did checkout feel slow this morning?",
    detail: "Follow one request step by step, and the slow part stands out.",
    color: "oklch(0.7 0.15 255)",
    ms: CHAPTER_MS[0],
  },
  {
    chapter: 1,
    label: "Busy days",
    question: "Did we hold up when everyone showed up?",
    detail: "Demand, speed and failures side by side, while it is happening.",
    color: "oklch(0.83 0.15 80)",
    ms: CHAPTER_MS[1],
  },
  {
    chapter: 2,
    label: "Errors",
    question: "Is anyone hitting errors right now?",
    detail: "Every error with the code behind it and how many people it reached.",
    color: "oklch(0.66 0.2 22)",
    ms: CHAPTER_MS[2],
  },
  {
    chapter: 3,
    label: "Alerts",
    question: "Will we hear about it before they do?",
    detail: "Everr notices when things drift and tells the right people.",
    color: "oklch(0.86 0.19 135)",
    ms: CHAPTER_MS[3],
  },
  {
    chapter: 4,
    label: "Next steps",
    question: "The alarm went off. Now what?",
    detail: "Each alert arrives with the steps your team already agreed on.",
    color: "oklch(0.78 0.17 340)",
    ms: CHAPTER_MS[4],
  },
];

export function MonitoringSection() {
  return (
    <section id="tour" className="scroll-mt-14 border-t border-border bg-fd-background">
      <div className={`${sectionWrap} pt-20 pb-24 text-foreground md:pt-32 md:pb-36`}>
        <div className="mb-6 grid gap-6 md:mb-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:items-end md:gap-16">
          <h2 className={`${sectionHeading} max-w-[14ch]`}>
            An app can be up and still let people down
          </h2>
          <p className={`${sectionLead} max-w-[38ch] md:pb-2`}>
            Working is not the same as working well. These are the questions that matter on a bad
            day. Pick one and watch Everr answer it.
          </p>
        </div>
        <DemoPlayer chapters={CHAPTERS}>{(player) => <MonitoringDemo {...player} />}</DemoPlayer>
      </div>
    </section>
  );
}
