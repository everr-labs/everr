import { cn } from "@everr/ui/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  ChartNoAxesCombined,
  Code2,
  Laptop,
} from "lucide-react";
import type { ReactNode } from "react";
import otelLogo from "@/assets/logos/otel.svg?url";
import { LandingShell } from "@/components/landing-shell";
import { ObservabilityExamples } from "@/components/observability-examples";

export const Route = createFileRoute("/why-observability")({
  head: () => ({
    meta: [
      { title: "Everr | Observability made easy" },
      {
        name: "description",
        content:
          "Understand performance, traffic spikes, and failures. Start monitoring locally for free, without an account, then take Everr to production with Hobby.",
      },
    ],
  }),
  component: WhyObservabilityPage,
});

const wrapClassName = "mx-auto max-w-[1280px] px-6";
const sectionClassName =
  "mx-auto max-w-[1280px] scroll-mt-20 px-6 py-20 max-[700px]:py-14";
const sectionHeadingClassName =
  "max-w-[790px] text-balance text-[clamp(2rem,3.7vw,3rem)] font-normal leading-[1.12] tracking-[-0.025em]";
const introClassName =
  "mt-6 max-w-[720px] text-[1.0625rem] leading-[1.65] text-muted-foreground";
const eyebrowClassName =
  "font-mono text-xs font-medium uppercase tracking-[0.12em] text-primary";

function MonitoringLink({
  href,
  children,
  secondary = false,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <a
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-3 rounded-full border border-primary bg-primary px-6 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4",
        secondary &&
          "border-border bg-transparent text-foreground hover:bg-card",
      )}
      href={href}
    >
      {children}
      <ArrowRight size={17} aria-hidden="true" />
    </a>
  );
}

function WhyObservabilityPage() {
  return (
    <LandingShell>
      <main>
        <WhyObservabilityHero />
        <ObservabilityExamples />
        <WhyObservabilityStandards />
        <WhyObservabilityCost />
        <WhyObservabilityGuidance />
        <WhyObservabilityLocal />
        <WhyObservabilityClosing />
      </main>
    </LandingShell>
  );
}

function WhyObservabilityHero() {
  return (
    <section className="border-t border-border bg-[radial-gradient(ellipse_at_85%_0%,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_55%)]">
      <div className="mx-auto max-w-[1280px] px-6 pb-20 pt-24 max-[700px]:py-14">
        <p className={eyebrowClassName}>Why observability</p>
        <h1 className="mt-8 max-w-[1050px] text-balance text-[clamp(3rem,6vw,6rem)] font-normal leading-[1.03] tracking-[-0.045em]">
          Monitoring should be part of shipping.
          <span className="block text-primary">Not a project of its own.</span>
        </h1>
        <div className="mt-12 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-12 max-[900px]:grid-cols-1">
          <p className="max-w-[720px] text-[17px] leading-[1.6] text-muted-foreground">
            Understand how your application performs, how it handles traffic
            spikes, and why requests fail. Everr turns established observability
            practices into a guided workflow, from AI-assisted setup to everyday
            monitoring and investigation.
          </p>
          <div className="flex flex-wrap gap-3">
            <MonitoringLink href="#start-local">
              Start monitoring your app
            </MonitoringLink>
            <MonitoringLink href="#how-everr-works" secondary>
              See how Everr works
            </MonitoringLink>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhyObservabilityStandards() {
  return (
    <section
      className="border-t border-border"
      aria-labelledby="monitor-standards-title"
    >
      <div className={sectionClassName}>
        <p className={eyebrowClassName}>02 / The foundation</p>
        <a
          className="mt-8 inline-flex items-center gap-3 rounded-full border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4"
          href="https://opentelemetry.io/docs/what-is-opentelemetry/"
        >
          <img src={otelLogo} alt="" width="25" height="25" />
          OpenTelemetry
        </a>
        <div className="mt-8 grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-16 max-[900px]:grid-cols-1 max-[900px]:gap-3">
          <h2 className={sectionHeadingClassName} id="monitor-standards-title">
            The foundations are established.
            <br />
            <span className="text-primary">
              You don't have to reinvent them.
            </span>
          </h2>
          <div>
            <p className="text-[1.0625rem] leading-[1.65] text-muted-foreground">
              Monitoring has established practices, and OpenTelemetry provides a
              shared, vendor-neutral foundation for generating, collecting, and
              exporting traces, metrics, and logs.
            </p>
            <p className={introClassName}>
              The building blocks exist. Adopting them is where the work begins.
            </p>
          </div>
        </div>
        <p className="mt-14 border-t border-border pt-6 text-[clamp(1.5rem,3vw,2.25rem)] leading-tight tracking-[-0.025em]">
          So why aren't you monitoring yet?
        </p>
      </div>
    </section>
  );
}

function WhyObservabilityCost() {
  return (
    <section
      className="border-t border-border bg-card/40"
      aria-labelledby="monitor-cost-title"
    >
      <div className={sectionClassName}>
        <p className={eyebrowClassName}>03 / The real cost</p>
        <div className="mt-8 grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-16 max-[900px]:grid-cols-1 max-[900px]:gap-3">
          <h2 className={sectionHeadingClassName} id="monitor-cost-title">
            Because the tools are only part of the cost.
          </h2>
          <p className="max-w-[550px] text-[1.0625rem] leading-[1.65] text-muted-foreground">
            The subscription is one cost. Learning what to collect, deciding
            what matters, and keeping the setup useful are others.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-3 border-y border-border max-[700px]:grid-cols-1">
          {[
            [
              "What should you instrument?",
              "Which requests and dependencies need visibility? How much data is enough?",
            ],
            [
              "Rispondere a domande è costoso",
              "Costruire query e dashboard richiede tempo e conoscenza",
            ],
            [
              "What needs to stay up to date?",
              "As your application changes, which instrumentation, dashboards, and alert rules need attention?",
            ],
          ].map(([title, body], index) => (
            <article
              className="border-r border-border px-7 py-8 first:pl-0 last:border-r-0 last:pr-0 max-[700px]:border-r-0 max-[700px]:border-b max-[700px]:px-0 max-[700px]:py-6 max-[700px]:last:border-b-0"
              key={title}
            >
              <span className={eyebrowClassName}>0{index + 1}</span>
              <h3 className="mt-8 text-[1.375rem] font-normal leading-[1.3] tracking-[-0.02em] max-[700px]:mt-5">
                {title}
              </h3>
              <p className="mt-4 leading-[1.65] text-muted-foreground">
                {body}
              </p>
            </article>
          ))}
        </div>
        <div className="mt-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-12 max-[700px]:grid-cols-1 max-[700px]:gap-6">
          <p className="max-w-[540px] leading-[1.65] text-muted-foreground">
            Those decisions take experience. Keeping them useful takes time. It
            is understandable to put monitoring off when getting value from it
            looks like a project of its own.
          </p>
          <p className="border-l-2 border-primary pl-6 text-[1.25rem] leading-[1.5]">
            That's why Everr exists: to make that experience part of the
            product, so you don't have to figure everything out yourself.
          </p>
        </div>
      </div>
    </section>
  );
}

function WhyObservabilityGuidance() {
  return (
    <section
      id="how-everr-works"
      className="scroll-mt-20 border-t border-border"
      aria-labelledby="monitor-guidance-title"
    >
      <div className={sectionClassName}>
        <p className={eyebrowClassName}>04 / The Everr approach</p>
        <div className="mt-8 grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-16 max-[900px]:grid-cols-1 max-[900px]:gap-3">
          <h2 className={sectionHeadingClassName} id="monitor-guidance-title">
            You shouldn't have to become an observability expert to get useful
            answers.
          </h2>
          <p className="max-w-[550px] text-[1.0625rem] leading-[1.65] text-muted-foreground">
            Everr condenses years of observability experience into an
            opinionated getting-started flow. From AI-assisted instrumentation
            to dashboards and alerting, established practices guide the
            decisions that would otherwise be yours to research and maintain.
          </p>
        </div>
        <ol className="mt-14 grid list-none grid-cols-3 border-y border-border p-0 max-[700px]:grid-cols-1">
          {[
            {
              title: "Instrument",
              icon: Code2,
              items: ["AI-assisted setup", "Local verification"],
            },
            {
              title: "Understand",
              icon: ChartNoAxesCombined,
              items: ["Opinionated dashboards"],
            },
            {
              title: "Act",
              icon: Activity,
              items: [
                "Guided alerting",
                "Real-world context for AI investigation",
              ],
            },
          ].map(({ title, icon: Icon, items }, index) => (
            <li
              className="border-r border-border px-7 py-8 first:pl-0 last:border-r-0 last:pr-0 max-[700px]:border-r-0 max-[700px]:border-b max-[700px]:px-0 max-[700px]:py-6 max-[700px]:last:border-b-0"
              key={title}
            >
              <div className="flex items-center justify-between">
                <Icon
                  size={25}
                  strokeWidth={1.5}
                  className="text-primary"
                  aria-hidden="true"
                />
                <span className={eyebrowClassName}>0{index + 1}</span>
              </div>
              <h3 className="mt-10 text-[1.5rem] font-normal tracking-[-0.025em] max-[700px]:mt-5">
                {title}
              </h3>
              {items.map((item) => (
                <p
                  className="mt-3 leading-[1.6] text-muted-foreground"
                  key={item}
                >
                  {item}
                </p>
              ))}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function WhyObservabilityLocal() {
  return (
    <section
      id="start-local"
      className="scroll-mt-20 border-t border-border"
      aria-labelledby="monitor-local-title"
    >
      <div className={sectionClassName}>
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-16 max-[900px]:grid-cols-1 max-[900px]:gap-8">
          <div>
            <p className={eyebrowClassName}>05 / Start here</p>
            <h2
              className={cn(sectionHeadingClassName, "mt-8")}
              id="monitor-local-title"
            >
              Start locally.
              <br />
              <span className="text-primary">Start for free.</span>
            </h2>
            <p className={introClassName}>
              Try Everr Local on your local environment. Collect and explore
              your telemetry on your machine, for free. No account required.
            </p>
            <div className="mt-8">
              <MonitoringLink href="/docs/learn/install">
                Try Everr for free
              </MonitoringLink>
            </div>
          </div>
          <div className="border-l border-border pl-12 max-[900px]:border-l-0 max-[900px]:border-t max-[900px]:pl-0 max-[900px]:pt-8">
            <Laptop
              size={36}
              strokeWidth={1.5}
              className="mb-8 text-primary"
              aria-hidden="true"
            />
            <p className={eyebrowClassName}>Everr Local</p>
            <p className="mt-4 text-[1.75rem] leading-tight tracking-[-0.025em]">
              Free. No account required.
            </p>
          </div>
        </div>
        <div className="mt-14 grid grid-cols-2 gap-12 border-t border-border pt-8 max-[700px]:grid-cols-1 max-[700px]:gap-8">
          <article>
            <h3 className="text-[1.375rem] font-normal tracking-[-0.02em]">
              See it working before you deploy.
            </h3>
            <p className="mt-4 leading-[1.65] text-muted-foreground">
              Let your coding assistant guide the instrumentation, run your app,
              and query the telemetry locally. Check what you are capturing,
              investigate real requests, and verify the setup before taking it
              to production.
            </p>
          </article>
          <article>
            <h3 className="text-[1.375rem] font-normal tracking-[-0.02em]">
              Take it to production with Hobby.
            </h3>
            <p className="mt-4 leading-[1.65] text-muted-foreground">
              When you are ready,{" "}
              <a
                className="text-foreground underline decoration-border underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4"
                href="https://app.everr.dev"
              >
                create an account
              </a>{" "}
              and start monitoring in production with the Hobby plan's generous
              free allowance. Put monitoring to work before committing to a paid
              plan.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

function WhyObservabilityClosing() {
  return (
    <section className="border-t border-border">
      <div className={cn(wrapClassName, "py-28 text-center max-[700px]:py-20")}>
        <h2 className="mx-auto max-w-[790px] text-balance text-[clamp(2.25rem,5vw,4.5rem)] font-normal leading-[1.1] tracking-[-0.035em]">
          Everr, <span className="text-primary">observability made easy.</span>
        </h2>
      </div>
    </section>
  );
}
