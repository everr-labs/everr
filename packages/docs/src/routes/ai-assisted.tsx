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
      <section className="landing-hero">
        <div>
          <p className="landing-eyebrow">
            ● Observability for AI-assisted development
          </p>
          <h1>
            Your coding agent
            <br />
            is in the loop.
            <br />
            <span>
              Bring observability
              <br />
              into it.
            </span>
          </h1>
          <p className="landing-lead">
            Give your agent access to what your software actually does.
            Instrument, investigate, and verify changes across local
            development, CI, and production.
          </p>
          <div className="landing-actions">
            <LandingLink href="#install">Try Everr locally</LandingLink>
            <LandingLink href="#workflow" secondary>
              Explore the workflow
            </LandingLink>
          </div>
        </div>
        <div className="landing-card landing-console">
          <div className="landing-card-bar">
            <span>CHECKOUT / INVESTIGATION</span>
            <span>LOCAL</span>
          </div>
          <p className="landing-card-body">
            Investigate the checkout failure. Verify the fix.
          </p>
          <ol>
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
              <li key={label}>
                <span>{label}</span>
                {body}
              </li>
            ))}
          </ol>
          <div className="landing-signal">
            Code → execution → evidence → next change
          </div>
          <p className="landing-caption">Illustrative workflow</p>
        </div>
      </section>
      <div className="landing-strip">
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
      <LandingSection
        id="workflow"
        eyebrow="One change / Three environments"
        title="Keep runtime context in the conversation."
      >
        <p className="landing-intro">
          An agent can read the code and run tests. Everr adds queryable runtime
          signals so the next decision can draw on what actually happened.
        </p>
        <div className="landing-journey">
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
            <article key={number}>
              <span className="landing-step">{number}</span>
              <div>
                <p className="landing-eyebrow">{label}</p>
                <h3>{title}</h3>
                <p>{body}</p>
                <div className="landing-signal">{example}</div>
              </div>
            </article>
          ))}
        </div>
      </LandingSection>
      <LandingSection
        eyebrow="Knowledge that stays with the code"
        title="Turn an investigation into a better runbook."
      >
        <div className="landing-two-col">
          <div>
            <p>
              Dashboard definitions, alerts, and runbooks live in your
              repository. Your team and agent can read the same instructions,
              review changes, and carry the lessons forward.
            </p>
            <p>
              OpenTelemetry for signals. SQL for queries. Files for operational
              knowledge.
            </p>
            <div className="landing-actions">
              <LandingLink href="/docs/concepts/observability-as-code">
                Explore observability as code
              </LandingLink>
            </div>
          </div>
          <div className="landing-card landing-card-body">
            <p className="landing-label">ILLUSTRATIVE RUNBOOK CHANGE</p>
            <pre className="landing-code">
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
      <LandingSection
        eyebrow="Your tools / A shared source of evidence"
        title="Work with the coding agent you already use."
      >
        <div className="landing-three-col">
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
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </LandingSection>
      <section id="install" className="landing-closing">
        <p className="landing-eyebrow">Start with a real question</p>
        <h2>
          Run it. Observe it.
          <br />
          Verify the next change.
        </h2>
        <div className="landing-install">
          <InstallCommand />
        </div>
        <div className="landing-actions">
          <LandingLink href="/docs/learn/install">
            Follow the local setup
          </LandingLink>
          <LandingLink href="/docs/reference/skills" secondary>
            Connect your coding agent
          </LandingLink>
        </div>
        <a className="landing-crosslink" href="/small-teams">
          New to observability? Explore Everr for small teams →
        </a>
      </section>
    </LandingShell>
  );
}
