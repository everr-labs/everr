import { createFileRoute } from "@tanstack/react-router";
import { GitBranch, Laptop, Radio } from "lucide-react";
import {
  LandingLink,
  LandingSection,
  LandingShell,
} from "@/components/landing-shell";
import { InstallCommand } from "@/components/ui/install-command";
export const Route = createFileRoute("/ai-assisted")({
  head: () => ({
    meta: [
      { title: "Everr for coding agents | Close the runtime feedback loop" },
      {
        name: "description",
        content:
          "Instrument, run, investigate, and verify with runtime feedback across local development, CI, and production.",
      },
    ],
  }),
  component: AiAssistedPage,
});
function AiAssistedPage() {
  return (
    <LandingShell>
      <AiAssistedHero />
      <AiAssistedSignals />
      <AiAssistedWorkflow />
      <AiAssistedRunbook />
      <AiAssistedTools />
      <AiAssistedInstall />
    </LandingShell>
  );
}

function AiAssistedHero() {
  return (
    <section className="mx-auto grid min-h-[690px] max-w-[1240px] grid-cols-[1.15fr_1fr] items-center gap-16 bg-[radial-gradient(ellipse_at_90%_40%,color-mix(in_srgb,var(--primary)_9%,transparent),transparent_60%)] px-8 py-[88px] max-[900px]:gap-8 max-[700px]:min-h-0 max-[700px]:grid-cols-1 max-[700px]:gap-10 max-[700px]:px-6 max-[700px]:py-14">
      <div>
        <p className="mb-6 text-[11px] font-bold uppercase tracking-[0.15em] text-primary">
          ● Observability for AI-assisted development
        </p>
        <h1 className="mb-[26px] text-[clamp(42px,4.4vw,66px)] font-semibold leading-[1.06] tracking-[-0.045em]">
          Your coding agent
          <br />
          is in the loop.
          <br />
          <span className="text-primary">
            Bring observability
            <br />
            into it.
          </span>
        </h1>
        <p className="max-w-[540px] text-lg leading-[1.7] text-muted-foreground">
          Give your agent access to what your software actually does.
          Instrument, investigate, and verify changes across local development,
          CI, and production.
        </p>
        <div className="mt-[30px] flex flex-wrap gap-3">
          <LandingLink href="#install">Try Everr locally</LandingLink>
          <LandingLink href="#workflow" secondary>
            Explore the workflow
          </LandingLink>
        </div>
      </div>
      <div className="min-w-0 overflow-hidden rounded-2xl border border-foreground/10 bg-card font-mono">
        <div className="flex justify-between gap-4 border-b border-foreground/10 px-6 py-5 text-[10px] tracking-[0.09em] text-muted-foreground">
          <span>CHECKOUT / INVESTIGATION</span>
          <span>LOCAL</span>
        </div>
        <p className="border-b border-foreground/10 px-6 py-7 text-[13px] leading-[1.7] text-muted-foreground max-[700px]:p-5">
          Investigate the checkout failure. Verify the fix.
        </p>
        <ol className="grid list-none gap-[22px] p-6 text-xs">
          {[
            ["01 / INSTRUMENT", "Add a span around the payment call."],
            ["02 / RUN", "Reproduce the failing checkout locally."],
            ["03 / OBSERVE", "Query the request trace and related logs."],
            ["04 / FIX", "Handle the provider failure in the checkout flow."],
            [
              "05 / VERIFY",
              "Run it again. Inspect fresh telemetry and test results.",
            ],
          ].map(([label, body]) => (
            <li key={label} className="text-muted-foreground">
              <span className="mb-1.5 block text-[10px] text-primary">
                {label}
              </span>
              {body}
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-2.5 bg-primary/7 px-5 py-[15px] text-xs leading-[1.6] text-primary">
          Code → execution → evidence → next change
        </div>
        <p className="px-6 py-4 text-[10px] text-muted-foreground">
          Illustrative workflow
        </p>
      </div>
    </section>
  );
}

function AiAssistedSignals() {
  return (
    <div className="mx-auto flex max-w-[1176px] justify-between gap-6 border-y border-foreground/10 py-6 max-[900px]:mx-8 max-[700px]:mx-6 max-[700px]:flex-col max-[700px]:gap-4 [&>span]:flex [&>span]:items-center [&>span]:gap-3 [&>span]:text-[13px] [&>span]:text-muted-foreground [&_svg]:text-primary">
      <span>
        <Laptop size={18} /> Local feedback
      </span>
      <span>
        <GitBranch size={18} /> CI context
      </span>
      <span>
        <Radio size={18} /> Production evidence
      </span>
    </div>
  );
}

function AiAssistedWorkflow() {
  return (
    <LandingSection
      id="workflow"
      eyebrow="One change / Three environments"
      title="Keep runtime context in the conversation."
    >
      <p className="mt-6 max-w-[670px] text-[17px] leading-[1.7] text-muted-foreground">
        An agent can read the code and run tests. Everr adds queryable runtime
        signals so the next decision can draw on what actually happened.
      </p>
      <div className="mt-12">
        {[
          [
            "01",
            "LOCAL",
            "Start with evidence on your laptop.",
            "Your agent follows instrumentation skills, exercises the changed path, and queries fresh telemetry from the local collector. Feedback is available before a deployment.",
            "Run the checkout request. Find the failing payment span.",
          ],
          [
            "02",
            "CI",
            "Keep the context when the build fails.",
            "GitHub Actions runs become structured, queryable data. Your agent can inspect the failing run and use available history to investigate recurring failures.",
            "Inspect the failed job. Compare it with recent runs.",
          ],
          [
            "03",
            "PRODUCTION",
            "Bring production into the next change.",
            "Query deployed behavior, connect an affected trace to the code, and take that evidence into the next local reproduction and verification cycle.",
            "Find an affected release. Reproduce locally. Verify the change.",
          ],
        ].map(([number, label, title, body, example]) => (
          <article
            key={number}
            className="grid max-w-[900px] grid-cols-[64px_1fr] gap-7 pb-11 max-[700px]:grid-cols-[32px_1fr] max-[700px]:gap-[18px]"
          >
            <span className="border-t border-primary pt-[18px] font-mono text-xl text-primary">
              {number}
            </span>
            <div>
              <p className="my-4 text-[11px] font-bold uppercase tracking-[0.15em] text-primary">
                {label}
              </p>
              <h3 className="my-3 text-[28px] font-semibold leading-[1.3] tracking-[-0.02em] max-[700px]:text-2xl">
                {title}
              </h3>
              <p className="leading-[1.7] text-muted-foreground">{body}</p>
              <div className="mt-5 flex items-center gap-2.5 bg-primary/7 px-5 py-[15px] text-xs leading-[1.6] text-primary">
                {example}
              </div>
            </div>
          </article>
        ))}
      </div>
    </LandingSection>
  );
}

function AiAssistedRunbook() {
  return (
    <LandingSection
      eyebrow="Knowledge that stays with the code"
      title="Turn an investigation into a better runbook."
    >
      <div className="mt-10 grid grid-cols-2 gap-12 max-[700px]:grid-cols-1 max-[700px]:gap-6">
        <div>
          <p className="leading-[1.7] text-muted-foreground">
            Dashboard definitions, alerts, and runbooks live in your repository.
            Your team and agent can read the same instructions, review changes,
            and carry the lessons forward.
          </p>
          <p className="mt-5 leading-[1.7] text-muted-foreground">
            OpenTelemetry for signals. SQL for queries. Files for operational
            knowledge.
          </p>
          <div className="mt-[30px] flex flex-wrap gap-3">
            <LandingLink href="/docs/concepts/observability-as-code">
              Explore observability as code
            </LandingLink>
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-2xl border border-foreground/10 bg-card px-6 py-7 max-[700px]:p-5">
          <p className="text-[10px] tracking-[0.09em] text-muted-foreground">
            ILLUSTRATIVE RUNBOOK CHANGE
          </p>
          <pre className="mt-5 overflow-x-auto font-mono text-xs leading-[1.9] text-primary">
            <code>
              {[
                " checkout.runbook.md",
                "",
                " # Investigate payment failures",
                "",
                "+ Find a recent failed checkout trace.",
                "+ Inspect the payment provider span.",
                "+ Check related logs for the response.",
                "+ Reproduce the failure locally.",
                "+ Verify the fix with fresh telemetry.",
                "",
                " Reviewed alongside the application.",
              ].join("\n")}
            </code>
          </pre>
        </div>
      </div>
    </LandingSection>
  );
}

function AiAssistedTools() {
  return (
    <LandingSection
      eyebrow="Your tools / A shared source of evidence"
      title="Work with the coding agent you already use."
    >
      <div className="mt-10 grid grid-cols-3 gap-8 max-[700px]:grid-cols-1">
        {[
          [
            "Skills that guide the work",
            "Framework guidance, OpenTelemetry conventions, and verification steps help the agent set up useful instrumentation.",
          ],
          [
            "Queryable local and cloud data",
            "Use SQL from the CLI to explore signals. Discover the available schema and attributes for each environment.",
          ],
          [
            "An interface for people, too",
            "Explore traces, logs, and dashboards in Everr while your agent works with the underlying telemetry.",
          ],
        ].map(([title, body]) => (
          <article key={title}>
            <h3 className="my-3 text-[21px] font-semibold leading-[1.3] tracking-[-0.02em]">
              {title}
            </h3>
            <p className="text-sm leading-[1.7] text-muted-foreground">
              {body}
            </p>
          </article>
        ))}
      </div>
    </LandingSection>
  );
}

function AiAssistedInstall() {
  return (
    <section
      id="install"
      className="mx-auto max-w-[1240px] scroll-mt-[70px] px-8 py-[100px] text-center max-[700px]:px-6 max-[700px]:py-14"
    >
      <p className="mb-6 text-[11px] font-bold uppercase tracking-[0.15em] text-primary">
        Start with a real question
      </p>
      <h2 className="mx-auto mb-8 max-w-[790px] text-[clamp(30px,3.5vw,46px)] font-[550] leading-[1.12] tracking-[-0.035em]">
        Run it. Observe it.
        <br />
        Verify the next change.
      </h2>
      <div className="mx-auto max-w-[570px] text-left">
        <InstallCommand />
      </div>
      <div className="mt-[30px] flex flex-wrap justify-center gap-3">
        <LandingLink href="/docs/learn/install">
          Follow the local setup
        </LandingLink>
        <LandingLink href="/docs/reference/skills" secondary>
          Connect your coding agent
        </LandingLink>
      </div>
      <a
        className="mx-auto mt-8 block w-fit text-[13px] text-muted-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-primary"
        href="/small-teams"
      >
        New to observability? Explore Everr for small teams →
      </a>
    </section>
  );
}
