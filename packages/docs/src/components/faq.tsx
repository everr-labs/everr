import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

type FaqItem = {
  q: string;
  a: ReactNode;
};

const FAQS: FaqItem[] = [
  {
    q: "Does Everr replace Datadog / Grafana / Honeycomb?",
    a: (
      <>
        Not yet, but we're working on it! We are currently focused on local
        observability. Everr lives{" "}
        <strong className="text-fd-foreground">upstream</strong> — your laptop,
        CI, and agent runs your existing tools never see. Production
        observability is a natural next step.
      </>
    ),
  },
  {
    q: "Where is my telemetry stored?",
    a: (
      <>
        On the device that produced it. Local-first by default. If you want a
        shared cluster for your team we host one — but it's never required and
        nothing leaves your machine until you opt in.
      </>
    ),
  },
  {
    q: "Do I have to instrument my code?",
    a: (
      <>
        If your runtime speaks OpenTelemetry, you're already done. If not, OTel
        SDKs are already in every model's training data — point your agent at
        the codebase and it will wire it up faster than you can read the docs.
      </>
    ),
  },
  {
    q: "Does it work in CI?",
    a: (
      <>
        Yes. Drop the same binary into a GitHub Actions step. The data model,
        SQL surface, and APIs are identical to what you run locally — so
        identifying a CI regression is literally one query away.
      </>
    ),
  },
  {
    q: "How do AI agents query Everr?",
    a: (
      <>
        Through one structured API and plain SQL via a CLI so Claude Code,
        Cursor, Codex, Copilot, and friends can hit it without any glue code.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Free for local use, forever. You only pay when you want a hosted
        cluster, premium support, or longer retention.
      </>
    ),
  },
];

export function FAQ() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-32">
        <div className="grid gap-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-20">
          <div>
            <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
              FAQ
            </p>
            <h2 className="mt-4 font-heading text-4xl leading-none sm:text-5xl md:text-6xl">
              Questions{" "}
              <span className="relative everr-decoration everr-decoration-primary">
                worth answering
              </span>
            </h2>
            <p className="mt-6 max-w-sm text-base leading-relaxed text-fd-muted-foreground">
              Still curious?{" "}
              <a
                href="https://everr.dev/discord"
                className="text-fd-foreground underline decoration-primary decoration-2 underline-offset-4 hover:text-primary"
              >
                Ask us on Discord
              </a>
              .
            </p>
          </div>

          <ul>
            {FAQS.map((item) => (
              <FaqRow key={item.q} item={item} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function FaqRow({ item }: { item: FaqItem }) {
  return (
    <li>
      <Collapsible className="group/faq border-b border-fd-border py-5">
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-6 text-left outline-none">
          <span className="font-heading text-base leading-snug text-fd-foreground transition-colors group-hover/faq:text-primary md:text-lg">
            {item.q}
          </span>
          <Plus
            aria-hidden
            className="size-4 shrink-0 text-fd-muted-foreground transition-transform duration-300 ease-out group-hover/faq:text-primary"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden text-sm leading-relaxed text-fd-muted-foreground transition-[height] duration-300 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 md:text-base h-[var(--collapsible-panel-height)]">
          <p className="pt-4">{item.a}</p>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
