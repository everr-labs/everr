import { Button } from "@/components/ui/button";
import { sectionHeading, sectionLead, sectionWrap } from "@/components/ui/type";

export function SelfHostedBanner() {
  return (
    <section className="border-t border-border text-foreground">
      <div
        className={`${sectionWrap} grid items-center gap-10 py-20 md:gap-16 md:py-32 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]`}
      >
        <div>
          <h2 className={`${sectionHeading} max-w-[14ch]`}>Run Everr on your own infrastructure</h2>
          <p className={`${sectionLead} mt-7 max-w-[52ch]`}>
            Everr is open source. The code is yours to use under AGPL-3.0, with no Everr license
            fee. You manage the infrastructure, updates, and backups.
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-card/40 p-7 sm:p-8">
          <h3 className="text-xl font-medium tracking-[-0.02em]">Self-hosted</h3>
          <div className="mt-5 flex items-baseline gap-2">
            <span className="display text-[3.5rem] tabular-nums md:text-[4rem]">€0</span>
            <span className="text-base text-muted-foreground">license fee</span>
          </div>
          <p className="mt-4 text-[15px] leading-[1.55] text-muted-foreground">
            Your hosting costs depend on the infrastructure you choose.
          </p>
          <Button
            variant="outline"
            nativeButton={false}
            render={
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- content is injected by Button
              <a href="https://github.com/everr-labs/everr" />
            }
            className="mt-8 w-full"
          >
            Explore the source
          </Button>
        </div>
      </div>
    </section>
  );
}
