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
    q: "Where is my telemetry stored?",
    a: (
      <>
        While you develop, a collector runs on your machine and the data stays
        local. In production, your services send OpenTelemetry to the Everr
        cloud over OTLP, into a shared workspace scoped to your organization.
      </>
    ),
  },
  {
    q: "What can I send to Everr?",
    a: (
      <>
        Traces, logs, and metrics in one OpenTelemetry model, the same signal
        from your laptop to CI to production. Business events ride the same
        pipeline, so product and engineering query the same data.
      </>
    ),
  },
  {
    q: "Do I have to instrument my code?",
    a: (
      <>
        If your runtime already speaks OpenTelemetry, you're most of the way
        there. Everr's bundled skills also help your coding assistant add the
        right instrumentation, working straight from your repository.
      </>
    ),
  },
  {
    q: "How do coding assistants query Everr?",
    a: (
      <>
        Through bundled skills plus plain SQL via the CLI:{" "}
        <code className="font-mono text-[0.95em] text-fd-foreground">
          everr local query
        </code>{" "}
        and{" "}
        <code className="font-mono text-[0.95em] text-fd-foreground">
          everr cloud query
        </code>
        . Your coding assistant reads your telemetry directly, no glue code.
      </>
    ),
  },
  {
    q: "Am I locked in?",
    a: (
      <>
        No. Everr uses OpenTelemetry for ingest, the Perses spec for dashboards,
        and a ClickHouse SQL surface for queries, all open standards. Your data,
        dashboards, and alerts are portable files, not trapped behind a
        proprietary agent or query language.
      </>
    ),
  },
  // Pricing isn't finalized yet; keep this answer ready but hidden.
  /*
  {
    q: "What does it cost?",
    a: (
      <>
        Everr is open source and free to self-host. The managed Cloud plan is
        usage-based, with an Enterprise tier for compliance and scale. See the{" "}
        <a
          href="/pricing"
          className="text-fd-foreground underline decoration-primary decoration-2 underline-offset-4 hover:text-primary"
        >
          pricing page
        </a>{" "}
        for the full comparison.
      </>
    ),
  },
  */
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
