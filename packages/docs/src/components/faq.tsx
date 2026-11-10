import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { sectionHeading, sectionWrap } from "@/components/ui/type";

export type FaqItem = {
  q: string;
  a: ReactNode;
};

const FAQS: FaqItem[] = [
  {
    q: "Do I need to know anything about monitoring?",
    a: (
      <>
        No. Setup, dashboards and alerts follow established practices, so the decisions an expert
        would make are already made for you. You can change any of them later.
      </>
    ),
  },
  {
    q: "How does setup work?",
    a: (
      <>
        Everr comes with skills for coding assistants such as Claude Code and Codex. Your assistant
        adds what is needed working straight from your repository, and a collector on your machine
        lets you check that data arrives before you deploy. If your app already speaks
        OpenTelemetry, you&apos;re most of the way there.
      </>
    ),
  },
  {
    q: "Where does my data live?",
    a: (
      <>
        While you develop, a collector runs on your machine and the data stays local. In production,
        your services send it to the Everr cloud, into a workspace scoped to your organization.
        Everr is also open source, so you can run it on your own infrastructure.
      </>
    ),
  },
  {
    q: "What can I send to Everr?",
    a: (
      <>
        Traces, logs, and metrics in one OpenTelemetry model, the same signal from your laptop to CI
        to production. Business events ride the same pipeline, so product and engineering look at
        the same data.
      </>
    ),
  },
  {
    q: "How do coding assistants use Everr?",
    a: (
      <>
        Through bundled skills plus plain SQL via the CLI:{" "}
        <code className="font-mono text-[0.95em] text-fd-foreground">everr local query</code> and{" "}
        <code className="font-mono text-[0.95em] text-fd-foreground">everr cloud query</code>. Your
        assistant reads what your app actually did, no glue code.
      </>
    ),
  },
  {
    q: "Am I locked in?",
    a: (
      <>
        No. Everr uses OpenTelemetry for ingest, the Perses spec for dashboards, and a ClickHouse
        SQL surface for queries, all open standards. Your data, dashboards, and alerts are portable
        files, not trapped behind a proprietary agent or query language.
      </>
    ),
  },
];

export function FAQ({
  items = FAQS,
  title,
  contactPrompt = "Something we haven’t covered?",
  contactLinkText = "Ask us on Discord",
}: {
  items?: FaqItem[];
  title?: string;
  contactPrompt?: string;
  contactLinkText?: string;
}) {
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);

  return (
    <section className="border-t border-border">
      <div className={`${sectionWrap} py-20 md:py-32`}>
        <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-20">
          <div>
            <h2 className={sectionHeading}>{title ?? "Questions worth answering"}</h2>
            <p className="mt-6 max-w-sm text-base leading-relaxed text-fd-muted-foreground">
              {contactPrompt}{" "}
              <a
                href="https://everr.dev/discord"
                className="text-fd-foreground underline decoration-primary decoration-2 underline-offset-4 hover:text-primary"
              >
                {contactLinkText}
              </a>
              .
            </p>
          </div>

          <ul className="border-t border-fd-border">
            {items.map((item) => (
              <FaqRow
                key={item.q}
                item={item}
                open={openQuestion === item.q}
                onOpenChange={(open) => setOpenQuestion(open ? item.q : null)}
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function FaqRow({
  item,
  open,
  onOpenChange,
}: {
  item: FaqItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <li>
      <Collapsible
        open={open}
        onOpenChange={onOpenChange}
        className="group/faq border-b border-fd-border"
      >
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-6 py-6 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <span className="text-xl leading-[1.25] font-medium tracking-[-0.02em] text-fd-foreground transition-colors group-hover/faq:text-primary md:text-2xl">
            {item.q}
          </span>
          <Plus
            aria-hidden
            className="size-5 shrink-0 text-fd-muted-foreground transition-transform duration-300 ease-out group-hover/faq:text-primary group-data-[open]/faq:rotate-45"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden text-sm leading-relaxed text-fd-muted-foreground transition-[height] duration-300 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 md:text-base h-[var(--collapsible-panel-height)]">
          <p className="max-w-[62ch] pb-6">{item.a}</p>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
