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
        Yes! Those tools are built for platform and SRE teams. Everr is built
        for <strong className="text-fd-foreground">people like us</strong> that
        have to move fast and don't have the time to learn a new complicated
        tool.
      </>
    ),
  },
  {
    q: "Where is my telemetry stored?",
    a: (
      <>
        Local telemetry stays{" "}
        <strong className="text-fd-foreground">on your machine</strong>. The
        desktop app and local collector are designed for that fast feedback
        loop. Production and shared team telemetry goes to Everr Cloud, backed
        by ClickHouse, so you can query it with the same SQL shape without
        running storage yourself.
      </>
    ),
  },
  {
    q: "Do I have to instrument my code?",
    a: (
      <>
        Yes, because useful observability needs real spans, logs, metrics, and
        errors from your app. We make that setup small: Everr is{" "}
        <strong className="text-fd-foreground">OpenTelemetry-native</strong>,
        the SDKs already exist for your stack, and the Everr agent skill can
        wire the right instrumentation into your codebase.
      </>
    ),
  },
  {
    q: "Does it work in CI?",
    a: (
      <>
        Yes. Install the{" "}
        <strong className="text-fd-foreground">Everr GitHub App</strong>, run
        Everr in your workflows, and CI becomes another telemetry source instead
        of a black box. You can inspect slow jobs, flaky tests, failing steps,
        and resource usage with the same SQL and dashboards you use locally.
      </>
    ),
  },
  {
    q: "How do AI agents query Everr?",
    a: (
      <>
        With <strong className="text-fd-foreground">SQL through the CLI</strong>
        . Agents are good at SQL, and SQL is very expressive for real telemetry
        work: filtering traces, grouping logs, comparing runs, spotting
        regressions, and drafting dashboards from the same data you see.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Local telemetry is <strong className="text-fd-foreground">free</strong>.
        Everr Cloud has a generous free plan for hosted and shared telemetry,
        then usage-based billing as you grow. You pay for cloud storage,
        retention, and usage, not for validating telemetry on your own machine.
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
            <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground">
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
