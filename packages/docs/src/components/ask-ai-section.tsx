import { AskAiComposer } from "@/components/ask-ai-composer";
import { sectionHeading, sectionLead, sectionWrap } from "@/components/ui/type";
import { m } from "@/paraglide/messages";

export function AskAiSection() {
  return (
    <section className="border-t border-border bg-background text-foreground">
      <div
        className={`${sectionWrap} grid items-center gap-10 py-20 md:grid-cols-2 md:gap-16 md:py-32`}
      >
        <div>
          <h2 className={`${sectionHeading} max-w-[10ch]`}>{m.ask_heading()}</h2>
          <p className={`${sectionLead} mt-7 max-w-[40ch]`}>{m.ask_lead()}</p>
        </div>
        <div className="min-w-0">
          <AskAiComposer />
        </div>
      </div>
    </section>
  );
}
