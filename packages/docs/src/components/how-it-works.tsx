import { AGENT_CHAPTER_MS, type AgentChapter, AgentDemo } from "@/components/agent-demo/AgentDemo";
import { DemoPlayer, type PlayerChapter } from "@/components/demo-player";
import { sectionHeading, sectionLead, sectionWrap } from "@/components/ui/type";
import { m } from "@/paraglide/messages";

const STEPS = [
  { title: m.setup_step_1_title, body: m.setup_step_1_body },
  { title: m.setup_step_2_title, body: m.setup_step_2_body },
  { title: m.setup_step_3_title, body: m.setup_step_3_body },
];

// Each chapter is one agent session, one per step above
const chapters = (): PlayerChapter<AgentChapter>[] => [
  {
    chapter: 0,
    label: m.setup_chapter_1_label(),
    question: m.setup_chapter_1_question(),
    detail: m.setup_chapter_1_detail(),
    color: "oklch(0.7 0.15 255)",
    ms: AGENT_CHAPTER_MS[0],
  },
  {
    chapter: 1,
    label: m.setup_chapter_2_label(),
    question: m.setup_chapter_2_question(),
    detail: m.setup_chapter_2_detail(),
    color: "oklch(0.83 0.15 80)",
    ms: AGENT_CHAPTER_MS[1],
  },
  {
    chapter: 2,
    label: m.setup_chapter_3_label(),
    question: m.setup_chapter_3_question(),
    detail: m.setup_chapter_3_detail(),
    color: "oklch(0.78 0.17 340)",
    ms: AGENT_CHAPTER_MS[2],
  },
];

export function HowItWorks() {
  return (
    <section className="border-t border-border text-foreground">
      <div className={`${sectionWrap} py-20 md:py-36`}>
        <h2 className={`${sectionHeading} max-w-[16ch]`}>{m.setup_heading()}</h2>
        <p className={`${sectionLead} mt-7 max-w-[58ch]`}>{m.setup_lead()}</p>
        <ol className="mt-14 grid gap-y-9 md:mt-20 md:grid-cols-3 md:divide-x md:divide-border">
          {STEPS.map(({ title, body }, i) => (
            <li
              // oxlint-disable-next-line react/no-array-index-key -- A fixed list of three steps.
              key={i}
              className="md:px-9 md:first:pl-0 md:last:pr-0"
            >
              <h3 className="text-2xl font-medium tracking-[-0.02em]">{title()}</h3>
              <p className="mt-3 max-w-[40ch] text-[17px] leading-[1.6] text-pretty text-muted-foreground">
                {body()}
              </p>
            </li>
          ))}
        </ol>
        <div className="mt-14 md:mt-20">
          <DemoPlayer chapters={chapters()}>{(player) => <AgentDemo {...player} />}</DemoPlayer>
        </div>
      </div>
    </section>
  );
}
