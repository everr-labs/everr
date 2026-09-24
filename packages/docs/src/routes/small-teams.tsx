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
import { LandingShell } from "@/components/landing-shell";

export const Route = createFileRoute("/small-teams")({
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
  component: ProductionMonitoringPage,
});

const sectionClassName =
  "mx-auto max-w-[1280px] scroll-mt-20 px-8 py-[88px] max-[700px]:px-6 max-[700px]:py-14";
const sectionHeadingClassName =
  "max-w-[790px] text-[clamp(30px,3.5vw,46px)] font-[550] leading-[1.12] tracking-[-0.035em]";
const introClassName =
  "mt-6 max-w-[740px] text-[1.0625rem] leading-[1.7] text-muted-foreground";
const cardHeadingClassName =
  "my-3 text-[21px] font-semibold leading-[1.3] tracking-[-0.02em]";

function MonitoringLink({
  href,
  children,
  secondary = false,
  inverted = false,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
  inverted?: boolean;
}) {
  return (
    <a
      className={cn(
        "inline-flex items-center justify-center gap-3 rounded-full border border-primary bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground transition-[transform,box-shadow,opacity] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:-translate-y-[3px] hover:opacity-100 hover:shadow-[0_8px_28px_color-mix(in_srgb,var(--primary)_12%,transparent)] focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[5px] motion-reduce:transform-none motion-reduce:transition-none",
        secondary && "border-foreground/10 bg-transparent text-foreground",
        inverted &&
          "border-primary-foreground bg-primary-foreground text-primary",
      )}
      href={href}
    >
      {children}
      <ArrowRight size={16} aria-hidden="true" />
    </a>
  );
}

function ProductionMonitoringPage() {
  return (
    <LandingShell>
      <SmallTeamsHero />
      <SmallTeamsStandards />
      <SmallTeamsCost />
      <SmallTeamsGuidance />
      <SmallTeamsLocal />
      <SmallTeamsClosing />
    </LandingShell>
  );
}

function SmallTeamsHero() {
  return (
    <section
      className={cn(
        sectionClassName,
        "bg-[radial-gradient(ellipse_at_90%_0%,color-mix(in_srgb,var(--primary)_15%,transparent),transparent_55%),radial-gradient(ellipse_at_5%_80%,color-mix(in_srgb,#32c8cc_6%,transparent),transparent_45%)] pt-[104px] pb-[88px] text-left max-[700px]:pt-16 max-[700px]:pb-14",
      )}
    >
      <h1 className="m-0 max-w-[1160px] animate-in text-balance fade-in slide-in-from-bottom-3 text-[clamp(2.5rem,5.8vw,5.25rem)] font-[550] leading-[1.06] tracking-[-0.05em] duration-[650ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:animate-none max-[700px]:text-[clamp(2.25rem,8vw,3.25rem)]">
        Your app can be up <br />
        <span className="text-primary">and still let users down</span>
      </h1>
      <h2 className="!text-4xl text-white mt-8">
        The observability platform that helps you ship faster.
      </h2>

      <div className="mt-9 grid animate-in grid-cols-[minmax(0,1fr)_auto] items-center gap-16 fade-in slide-in-from-bottom-3 duration-[750ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:animate-none max-[900px]:grid-cols-1 max-[900px]:gap-7">
        <p className="m-0 max-w-[720px] text-lg leading-[1.7] text-muted-foreground max-[700px]:text-base">
          Everr helps you understand your app’s performance and failures, from
          local development to production. Your coding agent can help instrument
          and investigate; your team gets useful dashboards, alerts, and
          answers.
        </p>
        <div className="flex flex-col items-stretch gap-3 max-[900px]:flex-row max-[900px]:flex-wrap">
          <MonitoringLink href="#start-local">
            Start monitoring your app
          </MonitoringLink>
          <MonitoringLink href="#how-everr-works" secondary>
            See how Everr works
          </MonitoringLink>
        </div>
      </div>
    </section>
  );
}

function SmallTeamsStandards() {
  return (
    <section
      className={cn(sectionClassName, "py-64 text-center")}
      aria-labelledby="monitor-standards-title"
    >
      <h2
        className={cn(sectionHeadingClassName, "mx-auto")}
        id="monitor-standards-title"
      >
        The foundations are established.
        <br />
        You don't have to reinvent them.
      </h2>
      <p className={cn(introClassName, "mx-auto")}>
        Monitoring has established practices, and OpenTelemetry provides a
        shared, vendor-neutral foundation for generating, collecting, and
        exporting traces, metrics, and logs.
      </p>
      <p className={cn(introClassName, "mx-auto")}>
        The building blocks exist. Adopting them is where the work begins.
      </p>
      <p className="mx-auto mt-14 w-fit -rotate-[1.5deg] rounded-xl bg-primary px-8 py-[22px] text-[clamp(1.5rem,3vw,2.25rem)] leading-tight tracking-[-0.03em] text-primary-foreground!">
        So why aren't you monitoring yet?
      </p>
    </section>
  );
}

function SmallTeamsCost() {
  return (
    <section className={sectionClassName} aria-labelledby="monitor-cost-title">
      <h2 className={sectionHeadingClassName} id="monitor-cost-title">
        Because the tools are only part of the cost.
      </h2>
      <p className={introClassName}>
        The subscription is one cost. Learning what to collect, deciding what
        matters, and keeping the setup useful are others.
      </p>
      <div className="my-10 grid grid-cols-3 gap-8 max-[900px]:gap-5 max-[700px]:grid-cols-1">
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
            className="rounded-[20px] border border-foreground/10 bg-card p-7"
            key={title}
          >
            <span className="text-[2.5rem] font-medium tracking-[-0.06em] text-[color-mix(in_srgb,var(--primary)_55%,var(--muted-foreground))]">
              0{index + 1}
            </span>
            <h3 className={cardHeadingClassName}>{title}</h3>
            <p className="leading-[1.7] text-muted-foreground">{body}</p>
          </article>
        ))}
      </div>
      <p className={introClassName}>
        Those decisions take experience. Keeping them useful takes time. It is
        understandable to put monitoring off when getting value from it looks
        like a project of its own.
      </p>
      <p className="mt-9 max-w-[900px] border-l-2 border-primary pl-6 text-[1.375rem] leading-normal text-foreground!">
        That's why Everr exists: to make that experience part of the product, so
        you don't have to figure everything out yourself.
      </p>
    </section>
  );
}

function SmallTeamsGuidance() {
  return (
    <section
      id="how-everr-works"
      className={sectionClassName}
      aria-labelledby="monitor-guidance-title"
    >
      <h2 className={sectionHeadingClassName} id="monitor-guidance-title">
        You shouldn't have to become an observability expert to get useful
        answers.
      </h2>
      <p className={introClassName}>
        Everr condenses years of observability experience into an opinionated
        getting-started flow. From AI-assisted instrumentation to dashboards and
        alerting, established practices guide the decisions that would otherwise
        be yours to research and maintain.
      </p>
      <ol className="mt-12 grid list-none grid-cols-3 gap-6 px-0 pb-8 max-[700px]:grid-cols-1">
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
            className={cn(
              "relative rounded-[20px] border border-foreground/10 bg-card p-7 transition-[transform,border-color] duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:-translate-y-[5px] hover:border-primary motion-reduce:transform-none motion-reduce:transition-none",
              index === 1 && "mt-4 -mb-4 max-[700px]:my-0",
              index === 2 && "mt-8 -mb-8 max-[700px]:my-0",
            )}
            key={title}
          >
            <div className="mb-6 flex items-center justify-between text-primary">
              <Icon size={24} aria-hidden="true" />
              <span className="font-mono text-xs text-muted-foreground">
                0{index + 1}
              </span>
            </div>
            <h3 className={cardHeadingClassName}>{title}</h3>
            {items.map((item) => (
              <p className="leading-[1.7] text-muted-foreground" key={item}>
                {item}
              </p>
            ))}
            {index < 2 && (
              <ArrowRight
                className="absolute top-1/2 -right-[23px] text-primary max-[700px]:top-auto max-[700px]:right-1/2 max-[700px]:-bottom-[23px] max-[700px]:rotate-90"
                size={20}
                aria-hidden="true"
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function SmallTeamsLocal() {
  return (
    <section
      id="start-local"
      className="mx-auto mt-14 w-[calc(100%-64px)] max-w-[1216px] scroll-mt-20 rounded-[32px] bg-primary p-14 text-primary-foreground max-[900px]:w-[calc(100%-48px)] max-[900px]:p-9 max-[700px]:w-[calc(100%-32px)] max-[700px]:px-5 max-[700px]:py-7"
      aria-labelledby="monitor-local-title"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_280px] items-center gap-16 max-[900px]:grid-cols-[minmax(0,1fr)_230px] max-[900px]:gap-8 max-[700px]:grid-cols-1">
        <div>
          <h2 className={sectionHeadingClassName} id="monitor-local-title">
            Start locally.
            <br />
            <span className="text-inherit">Start for free.</span>
          </h2>
          <p className={cn(introClassName, "text-primary-foreground/80!")}>
            Try Everr Local on your local environment. Collect and explore your
            telemetry on your machine, for free. No account required.
          </p>
          <div className="mt-[30px] flex flex-wrap gap-3">
            <MonitoringLink href="/docs/learn/install" inverted>
              Try Everr for free
            </MonitoringLink>
          </div>
        </div>
        <div className="flex rotate-3 flex-col items-center gap-[18px] rounded-[14px] border border-[color-mix(in_srgb,var(--primary-foreground)_14%,transparent)] bg-[color-mix(in_srgb,var(--primary-foreground)_5%,transparent)] px-4 py-9 max-[700px]:transform-none max-[700px]:flex-row max-[700px]:flex-wrap max-[700px]:justify-center max-[700px]:gap-4 max-[700px]:p-5">
          <Laptop size={42} strokeWidth={1.2} aria-hidden="true" />
          <strong className="text-2xl font-medium">Everr Local</strong>
          <span className="text-sm">Free. No account required.</span>
        </div>
      </div>
      <div className="mt-12 grid grid-cols-2 gap-12 border-t border-[color-mix(in_srgb,var(--primary-foreground)_18%,transparent)] pt-7 max-[700px]:mt-8 max-[700px]:grid-cols-1 max-[700px]:gap-6">
        <article>
          <h3 className={cardHeadingClassName}>
            See it working before you deploy.
          </h3>
          <p className="leading-[1.7] text-primary-foreground/80!">
            Let your coding assistant guide the instrumentation, run your app,
            and query the telemetry locally. Check what you are capturing,
            investigate real requests, and verify the setup before taking it to
            production.
          </p>
        </article>
        <article>
          <h3 className={cardHeadingClassName}>
            Take it to production with Hobby.
          </h3>
          <p className="leading-[1.7] text-primary-foreground/80!">
            When you are ready,{" "}
            <a
              className="text-inherit underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-primary-foreground focus-visible:outline-offset-[5px]"
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
    </section>
  );
}

function SmallTeamsClosing() {
  return (
    <section className={cn(sectionClassName, "text-center")}>
      <h2 className="mx-auto max-w-[790px] text-balance text-[clamp(2rem,4.5vw,3.75rem)]! font-[550] leading-[1.12] tracking-[-0.035em]">
        Everr, <span className="text-primary">observability made easy.</span>
      </h2>
    </section>
  );
}
