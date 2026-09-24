const headingClass =
  "text-balance text-[32px] leading-[1.14] tracking-[-0.03em] min-[761px]:text-[clamp(32px,3.5vw,48px)]";
const bodyClass =
  "mt-5 max-w-[70ch] text-[17px] leading-[1.65] text-muted-foreground";
const subheadingClass =
  "text-[22px] font-medium leading-[1.3] tracking-[-0.02em]";

export function ObservabilityVision() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-12 text-foreground min-[761px]:py-20">
      <div>
        <div className="max-w-[850px]">
          <h2 className={headingClass}>So why aren’t you monitoring yet?</h2>
          <p className="mt-5 max-w-[70ch] text-[26px] leading-[1.35] tracking-[-0.02em]">
            Because the tools are only part of the cost.
          </p>
          <p className={bodyClass}>
            The subscription is one cost. Learning what to collect, deciding
            what matters, and keeping the setup useful are others.
          </p>
        </div>
        <div className="mt-10 grid gap-7 min-[761px]:grid-cols-3 min-[761px]:gap-8">
          <div className="border-t border-border pt-5">
            <h3 className={subheadingClass}>What should you instrument?</h3>
            <p className="mt-3 max-w-[70ch] text-[17px] leading-[1.65] text-muted-foreground">
              Which requests and dependencies need visibility? How much data is
              enough?
            </p>
          </div>
          <div className="border-t border-border pt-5">
            <h3 className={subheadingClass}>How do you get useful answers?</h3>
            <p className="mt-3 max-w-[70ch] text-[17px] leading-[1.65] text-muted-foreground">
              Building queries and dashboards takes time and knowledge.
            </p>
          </div>
          <div className="border-t border-border pt-5">
            <h3 className={subheadingClass}>What needs to stay up to date?</h3>
            <p className="mt-3 max-w-[70ch] text-[17px] leading-[1.65] text-muted-foreground">
              As your application changes, instrumentation, dashboards, and
              alert rules need attention.
            </p>
          </div>
        </div>
        <p className="mt-8 max-w-[80ch] text-[17px] leading-[1.65] text-muted-foreground">
          Those decisions take experience. Keeping them useful takes time. It’s
          understandable to put monitoring off when getting value looks like a
          project of its own.
        </p>
      </div>
      <div className="mt-12 min-[761px]:mt-20">
        <div className="max-w-[920px]">
          <h2 className={`${headingClass} text-primary`}>
            You shouldn’t have to become an observability expert to get useful
            answers.
          </h2>
          <p className={bodyClass}>
            That’s why Everr exists: to make that experience part of the
            product.
          </p>
          <p className={bodyClass}>
            Everr condenses years of observability experience into an
            opinionated getting-started flow. Established practices guide the
            decisions you would otherwise have to research and maintain.
          </p>
        </div>
        <div className="mt-10 grid gap-7 min-[761px]:grid-cols-3 min-[761px]:gap-10">
          <div className="border-t border-border pt-5">
            <h3 className={subheadingClass}>Instrument</h3>
            <p className="mt-3 text-[17px] font-medium leading-[1.65]">
              AI-assisted setup, verified locally.
            </p>
            <p className={bodyClass}>
              Start with guidance on instrumentation and check that your
              telemetry arrives before you deploy.
            </p>
          </div>
          <div className="border-t border-border pt-5">
            <h3 className={subheadingClass}>Understand</h3>
            <p className="mt-3 text-[17px] font-medium leading-[1.65]">
              Opinionated dashboards.
            </p>
            <p className={bodyClass}>
              Use established practices to explore your data and find the
              questions worth asking.
            </p>
          </div>
          <div className="border-t border-border pt-5">
            <h3 className={subheadingClass}>Act</h3>
            <p className="mt-3 text-[17px] font-medium leading-[1.65]">
              Guided alerting. Informed investigation.
            </p>
            <p className={bodyClass}>
              Set up useful alerts and give your coding agent real-world context
              to investigate problems.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
