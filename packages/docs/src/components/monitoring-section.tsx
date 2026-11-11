import { DemoPlayer, type PlayerChapter } from "@/components/demo-player";
import {
  CHAPTER_MS,
  type Chapter,
  MonitoringDemo,
} from "@/components/monitoring-demo/MonitoringDemo";
import { sectionHeading, sectionLead, sectionWrap } from "@/components/ui/type";
import { m } from "@/paraglide/messages";

// One color per chapter. Neighbours differ in lightness as well as hue (blue,
// amber, red, green, pink), so they stay distinct under color-vision deficiency.
const chapters = (): PlayerChapter<Chapter>[] => [
  {
    chapter: 0,
    label: m.tour_1_label(),
    question: m.tour_1_question(),
    detail: m.tour_1_detail(),
    color: "oklch(0.7 0.15 255)",
    ms: CHAPTER_MS[0],
  },
  {
    chapter: 1,
    label: m.tour_2_label(),
    question: m.tour_2_question(),
    detail: m.tour_2_detail(),
    color: "oklch(0.83 0.15 80)",
    ms: CHAPTER_MS[1],
  },
  {
    chapter: 2,
    label: m.tour_3_label(),
    question: m.tour_3_question(),
    detail: m.tour_3_detail(),
    color: "oklch(0.66 0.2 22)",
    ms: CHAPTER_MS[2],
  },
  {
    chapter: 3,
    label: m.tour_4_label(),
    question: m.tour_4_question(),
    detail: m.tour_4_detail(),
    color: "oklch(0.86 0.19 135)",
    ms: CHAPTER_MS[3],
  },
  {
    chapter: 4,
    label: m.tour_5_label(),
    question: m.tour_5_question(),
    detail: m.tour_5_detail(),
    color: "oklch(0.78 0.17 340)",
    ms: CHAPTER_MS[4],
  },
];

export function MonitoringSection() {
  return (
    <section id="tour" className="scroll-mt-14 border-t border-border bg-fd-background">
      <div className={`${sectionWrap} pt-20 pb-24 text-foreground md:pt-32 md:pb-36`}>
        <div className="mb-6 grid gap-6 md:mb-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:items-end md:gap-16">
          <h2 className={`${sectionHeading} max-w-[14ch]`}>{m.tour_heading()}</h2>
          <p className={`${sectionLead} max-w-[38ch] md:pb-2`}>{m.tour_lead()}</p>
        </div>
        <DemoPlayer chapters={chapters()}>{(player) => <MonitoringDemo {...player} />}</DemoPlayer>
      </div>
    </section>
  );
}
