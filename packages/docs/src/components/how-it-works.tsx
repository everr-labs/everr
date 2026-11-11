import { AGENT_CHAPTER_MS, type AgentChapter, AgentDemo } from "@/components/agent-demo/AgentDemo";
import { DemoPlayer, type PlayerChapter } from "@/components/demo-player";
import { sectionHeading, sectionLead, sectionWrap } from "@/components/ui/type";

const STEPS = [
  {
    title: "Connect your app",
    body: "Ask your coding assistant to add Everr. It works out what is worth watching, wires it in, and proves it works on your machine before anything ships.",
  },
  {
    title: "See what matters",
    body: "Ready-made views show speed, errors and demand from day one. They follow practices that took the industry years to settle on, so there is no blank page to fill.",
  },
  {
    title: "Act on it",
    body: "Get alerts worth waking up for, each with the steps your team agreed on. When something breaks, your assistant investigates with what really happened.",
  },
];

// Each chapter is one agent session, one per step above
const CHAPTERS: PlayerChapter<AgentChapter>[] = [
  {
    chapter: 0,
    label: "Connect",
    question: "Can my assistant set this up?",
    detail: "It plans the work, makes the changes and checks the result on your machine.",
    color: "oklch(0.7 0.15 255)",
    ms: AGENT_CHAPTER_MS[0],
  },
  {
    chapter: 1,
    label: "See",
    question: "What should I be looking at?",
    detail: "It looks at what your app reports, then builds a view of what moves with revenue.",
    color: "oklch(0.83 0.15 80)",
    ms: AGENT_CHAPTER_MS[1],
  },
  {
    chapter: 2,
    label: "Act",
    question: "An alert fired. What happened?",
    detail: "It reads the alert, follows the evidence and comes back with the cause.",
    color: "oklch(0.78 0.17 340)",
    ms: AGENT_CHAPTER_MS[2],
  },
];

export function HowItWorks() {
  return (
    <section className="border-t border-border text-foreground">
      <div className={`${sectionWrap} py-20 md:py-36`}>
        <h2 className={`${sectionHeading} max-w-[16ch]`}>
          You shouldn’t need an expert to know your own app
        </h2>
        <p className={`${sectionLead} mt-7 max-w-[58ch]`}>
          Seeing this much used to mean hiring specialists or becoming one: deciding what to
          measure, building the views, keeping it all current. Everr builds that experience into the
          product, and your AI coding assistant does the setup.
        </p>
        <ol className="mt-14 grid gap-y-9 md:mt-20 md:grid-cols-3 md:divide-x md:divide-border">
          {STEPS.map(({ title, body }) => (
            <li key={title} className="md:px-9 md:first:pl-0 md:last:pr-0">
              <h3 className="text-2xl font-medium tracking-[-0.02em]">{title}</h3>
              <p className="mt-3 max-w-[40ch] text-[17px] leading-[1.6] text-pretty text-muted-foreground">
                {body}
              </p>
            </li>
          ))}
        </ol>
        <div className="mt-14 md:mt-20">
          <DemoPlayer chapters={CHAPTERS}>{(player) => <AgentDemo {...player} />}</DemoPlayer>
        </div>
      </div>
    </section>
  );
}
