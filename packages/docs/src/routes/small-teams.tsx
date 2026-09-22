import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@everr/ui/components/tabs";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  ChartNoAxesCombined,
  Code2,
  Fingerprint,
  Laptop,
  Workflow,
} from "lucide-react";
import { useId } from "react";
import otelLogo from "@/assets/logos/otel.svg?url";
import { LandingLink, LandingShell } from "@/components/landing-shell";
import "@/styles/production-monitoring.css";

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

const examples = [
  {
    id: "performance",
    label: "How your application performs",
    icon: Workflow,
    view: TraceExample,
    description:
      "A successful request can still be too slow. Follow its trace to see where time goes, from application code to database queries and external services.",
  },
  {
    id: "traffic",
    label: "How it handles traffic spikes",
    icon: ChartNoAxesCombined,
    view: TrafficExample,
    description:
      "More traffic is only part of the picture. Read request volume alongside response times and error rates to see how your application behaves under load.",
  },
  {
    id: "failures",
    label: "Why requests fail",
    icon: Fingerprint,
    view: ErrorExample,
    description:
      "An error message is a starting point. Read the stack trace and related logs in the context of the failed request to understand what happened and where to investigate.",
  },
];

function TraceExample() {
  return (
    <div className="monitor-demo">
      <div className="monitor-demo-bar">
        <span>Trace detail</span>
        <span>Illustrative example</span>
      </div>
      <div className="monitor-demo-body">
        <div className="monitor-request">
          <div>
            <span className="monitor-method">GET</span> <code>/projects</code>
          </div>
          <span>
            200 OK <strong>2.10 s</strong>
          </span>
        </div>
        <div className="monitor-waterfall">
          <div className="monitor-trace-row monitor-trace-axis">
            <span>Operation</span>
            <div>
              <span>0 s</span>
              <span>1 s</span>
              <span>2.1 s</span>
            </div>
            <span>Duration</span>
          </div>
          {[
            { label: "Request", duration: "2.10 s", start: 0, width: 100 },
            { label: "Authenticate", duration: "20 ms", start: 0, width: 0.95 },
            {
              label: "Database",
              duration: "2.04 s",
              start: 0.95,
              width: 97.14,
            },
            { label: "Response", duration: "40 ms", start: 98.09, width: 1.91 },
          ].map((row) => (
            <div
              className={`monitor-trace-row ${row.label === "Database" ? "monitor-trace-highlight" : ""}`}
              key={row.label}
            >
              <span>{row.label}</span>
              <div className="monitor-span-track">
                <span
                  style={{
                    marginLeft: `${row.start}%`,
                    width: `${row.width}%`,
                  }}
                />
              </div>
              <span>{row.duration}</span>
            </div>
          ))}
        </div>
        <div className="monitor-demo-insight">
          <Activity size={16} aria-hidden="true" /> The database accounts for
          97% of request time.
        </div>
      </div>
    </div>
  );
}

function TrafficExample() {
  const chartTitle = useId();
  return (
    <div className="monitor-demo">
      <div className="monitor-demo-bar">
        <span>Traffic overview</span>
        <span>Illustrative example</span>
      </div>
      <div className="monitor-demo-body">
        <div className="monitor-request">
          <strong>
            Request rate <small>req/s</small>
          </strong>
          <span>10:00 - 10:15</span>
        </div>
        <div className="monitor-traffic-grid">
          <svg
            className="monitor-chart"
            viewBox="0 0 600 230"
            role="img"
            aria-labelledby={chartTitle}
          >
            <title id={chartTitle}>
              Request rate from 10:00 to 10:15, with two spikes reaching
              approximately 400 and 800 requests per second.
            </title>
            {[30, 110, 190].map((y) => (
              <line
                key={y}
                x1="45"
                y1={y}
                x2="580"
                y2={y}
                className="monitor-chart-grid"
              />
            ))}
            <text x="0" y="35">
              800
            </text>
            <text x="0" y="115">
              400
            </text>
            <text x="20" y="195">
              0
            </text>
            <path
              d="M45 187 L80 185 L110 184 L145 185 L175 180 L195 112 L215 172 L240 182 L275 174 L300 30 L325 86 L345 178 L380 183 L415 179 L450 184 L490 181 L535 185 L580 182 L580 190 L45 190 Z"
              className="monitor-chart-area"
            />
            <path
              d="M45 187 L80 185 L110 184 L145 185 L175 180 L195 112 L215 172 L240 182 L275 174 L300 30 L325 86 L345 178 L380 183 L415 179 L450 184 L490 181 L535 185 L580 182"
              className="monitor-chart-line"
            />
            <text x="45" y="220">
              10:00
            </text>
            <text x="310" y="220" textAnchor="middle">
              10:07
            </text>
            <text x="580" y="220" textAnchor="end">
              10:15
            </text>
          </svg>
          <div className="monitor-metrics">
            <div>
              <p>P95 response time</p>
              <strong>
                420 <span>ms</span>
              </strong>
              <meter
                min={0}
                max={1000}
                value={420}
                aria-label="P95 response time: 420 milliseconds on a 0 to 1000 millisecond scale"
              />
              <div className="monitor-meter-scale">
                <span>0 ms</span>
                <span>1,000 ms</span>
              </div>
            </div>
            <div>
              <p>Error rate</p>
              <strong>
                0.7<span>%</span>
              </strong>
              <meter
                min={0}
                max={10}
                value={0.7}
                aria-label="Error rate: 0.7 percent on a 0 to 10 percent scale"
              />
              <div className="monitor-meter-scale">
                <span>0%</span>
                <span>10%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorExample() {
  return (
    <div className="monitor-demo">
      <div className="monitor-demo-bar">
        <span>Error detail</span>
        <span>Illustrative example</span>
      </div>
      <div className="monitor-demo-body">
        <div className="monitor-request">
          <div>
            <span className="monitor-error-label">ERROR</span>{" "}
            <code>POST /checkout</code>
          </div>
          <span>10:12:08</span>
        </div>
        <div className="monitor-stack">
          <strong>PaymentProviderError: upstream returned 503</strong>
          <pre>
            <code>
              {
                "at chargeCustomer (payments.ts:84)\nat checkout       (checkout.ts:37)"
              }
            </code>
          </pre>
        </div>
        <div className="monitor-log-heading">
          <span>Related logs</span>
          <code>req_demo_42</code>
        </div>
        <div className="monitor-log-row">
          <time>10:12:07</time>
          <span>Payment request started</span>
        </div>
        <div className="monitor-log-row">
          <time>10:12:08</time>
          <span>Payment provider returned 503</span>
        </div>
      </div>
    </div>
  );
}

function ProductionMonitoringPage() {
  return (
    <LandingShell>
      <div className="production-monitoring">
        <section className="monitor-hero">
          <h1>
            Monitoring should be part of shipping.
            <br />
            <span>Not a project of its own.</span>
          </h1>
          <div className="monitor-hero-footer">
            <p>
              Understand how your application performs, how it handles traffic
              spikes, and why requests fail. Everr turns established
              observability practices into a guided workflow, from AI-assisted
              setup to everyday monitoring and investigation.
            </p>
            <div className="landing-actions">
              <LandingLink href="#start-local">
                Start monitoring your app
              </LandingLink>
              <LandingLink href="#how-everr-works" secondary>
                See how Everr works
              </LandingLink>
            </div>
          </div>
        </section>

        <section
          className="monitor-section monitor-examples"
          aria-labelledby="monitor-examples-title"
        >
          <h2 id="monitor-examples-title">
            An app can be up and still let users down.
          </h2>
          <p className="monitor-intro">
            Monitoring goes beyond error reporting. See where your app slows
            down, how it responds to demand, and what led to a failure.
          </p>
          <Tabs
            defaultValue="performance"
            orientation="vertical"
            className="monitor-tabs"
          >
            <TabsList
              className="monitor-tab-list"
              aria-label="Explore production monitoring"
            >
              {examples.map(({ id, label, icon: Icon }, index) => (
                <TabsTrigger className="monitor-tab" key={id} value={id}>
                  <span className="monitor-tab-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="monitor-tab-label">
                    <span className="monitor-tab-number" aria-hidden="true">
                      0{index + 1}
                    </span>
                    {label}
                  </span>
                  <ArrowRight
                    className="monitor-tab-arrow"
                    aria-hidden="true"
                  />
                </TabsTrigger>
              ))}
            </TabsList>
            {examples.map(({ id, description, view: View }) => (
              <TabsContent className="monitor-tab-panel" key={id} value={id}>
                <figure>
                  <View />
                  <figcaption>{description}</figcaption>
                </figure>
              </TabsContent>
            ))}
          </Tabs>
        </section>

        <section
          className="monitor-section monitor-standards"
          aria-labelledby="monitor-standards-title"
        >
          <a
            className="monitor-otel"
            href="https://opentelemetry.io/docs/what-is-opentelemetry/"
          >
            <img src={otelLogo} alt="" width="32" height="32" />
            OpenTelemetry
          </a>
          <h2 id="monitor-standards-title">
            The foundations are established.
            <br />
            You don't have to reinvent them.
          </h2>
          <p className="monitor-intro">
            Monitoring has established practices, and OpenTelemetry provides a
            shared, vendor-neutral foundation for generating, collecting, and
            exporting traces, metrics, and logs.
          </p>
          <p className="monitor-intro">
            The building blocks exist. Adopting them is where the work begins.
          </p>
          <p className="monitor-question">So why aren't you monitoring yet?</p>
        </section>

        <section
          className="monitor-section monitor-barrier"
          aria-labelledby="monitor-cost-title"
        >
          <h2 id="monitor-cost-title">
            Because the tools are only part of the cost.
          </h2>
          <p className="monitor-intro">
            The subscription is one cost. Learning what to collect, deciding
            what matters, and keeping the setup useful are others.
          </p>
          <div className="monitor-decisions">
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
              <article key={title}>
                <span className="monitor-step-number">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <p className="monitor-intro">
            Those decisions take experience. Keeping them useful takes time. It
            is understandable to put monitoring off when getting value from it
            looks like a project of its own.
          </p>
          <p className="monitor-answer">
            That's why Everr exists: to make that experience part of the
            product, so you don't have to figure everything out yourself.
          </p>
        </section>

        <section
          id="how-everr-works"
          className="monitor-section"
          aria-labelledby="monitor-guidance-title"
        >
          <h2 id="monitor-guidance-title">
            You shouldn't have to become an observability expert to get useful
            answers.
          </h2>
          <p className="monitor-intro">
            Everr condenses years of observability experience into an
            opinionated getting-started flow. From AI-assisted instrumentation
            to dashboards and alerting, established practices guide the
            decisions that would otherwise be yours to research and maintain.
          </p>
          <ol className="monitor-journey">
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
              <li key={title}>
                <div className="monitor-journey-top">
                  <Icon size={24} aria-hidden="true" />
                  <span>0{index + 1}</span>
                </div>
                <h3>{title}</h3>
                {items.map((item) => (
                  <p key={item}>{item}</p>
                ))}
                {index < 2 && (
                  <ArrowRight
                    className="monitor-journey-arrow"
                    size={20}
                    aria-hidden="true"
                  />
                )}
              </li>
            ))}
          </ol>
        </section>

        <section
          id="start-local"
          className="monitor-section monitor-local"
          aria-labelledby="monitor-local-title"
        >
          <div className="monitor-local-header">
            <div>
              <h2 id="monitor-local-title">
                Start locally.
                <br />
                <span>Start for free.</span>
              </h2>
              <p className="monitor-intro">
                Try Everr Local on your local environment. Collect and explore
                your telemetry on your machine, for free. No account required.
              </p>
              <div className="landing-actions">
                <LandingLink href="/docs/learn/install">
                  Try Everr for free
                </LandingLink>
              </div>
            </div>
            <div className="monitor-local-badge">
              <Laptop size={42} strokeWidth={1.2} aria-hidden="true" />
              <strong>Everr Local</strong>
              <span>Free. No account required.</span>
            </div>
          </div>
          <div className="monitor-local-details">
            <article>
              <h3>See it working before you deploy.</h3>
              <p>
                Let your coding assistant guide the instrumentation, run your
                app, and query the telemetry locally. Check what you are
                capturing, investigate real requests, and verify the setup
                before taking it to production.
              </p>
            </article>
            <article>
              <h3>Take it to production with Hobby.</h3>
              <p>
                When you are ready,{" "}
                <a href="https://app.everr.dev">create an account</a> and start
                monitoring in production with the Hobby plan's generous free
                allowance. Put monitoring to work before committing to a paid
                plan.
              </p>
            </article>
          </div>
        </section>

        <section className="monitor-closing">
          <h2>
            Everr, <span>observability made easy.</span>
          </h2>
        </section>
      </div>
    </LandingShell>
  );
}
