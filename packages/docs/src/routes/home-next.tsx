import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  Citrus,
  Copy,
  Plus,
} from "lucide-react";
import { useState } from "react";
import desktop from "@/assets/desktop-app.webp?url";
import marcello from "@/assets/testimonials/marcello.jpeg?url";
import { INSTALL_COMMAND } from "@/components/ui/install-command";
import { useCopyToClipboard } from "@/lib/use-copy";
import "@/styles/home-next.css";

export const Route = createFileRoute("/home-next")({
  head: () => ({
    meta: [
      { title: "Everr | Less guesswork. More shipping." },
      {
        name: "description",
        content:
          "Understand what your app is doing. OpenTelemetry observability for your laptop, CI, and production, built for you and your coding assistant.",
      },
    ],
  }),
  component: HomeNext,
});

const examples = [
  {
    name: "Slow request",
    route: "GET /projects",
    total: "2.10 s",
    finding: "97% of the wait is in the database.",
    detail:
      "Follow the request across services. See exactly where the time goes.",
    spans: [
      { name: "Request", start: 0, width: 100, time: "2.10 s" },
      { name: "Authenticate", start: 0, width: 2, time: "20 ms" },
      { name: "Database", start: 2, width: 97, time: "2.04 s" },
      { name: "Response", start: 98, width: 2, time: "40 ms" },
    ],
  },
  {
    name: "Failed request",
    route: "POST /checkout",
    total: "840 ms",
    finding: "The payment provider timed out.",
    detail:
      "A failed request, its logs, and the service behind it. One connected story.",
    spans: [
      { name: "Request", start: 0, width: 100, time: "840 ms" },
      { name: "Validate", start: 0, width: 5, time: "42 ms" },
      { name: "Payment API", start: 5, width: 90, time: "756 ms" },
      { name: "Error logged", start: 95, width: 5, time: "42 ms" },
    ],
  },
  {
    name: "CI pipeline",
    route: "ci.yml / run #1842",
    total: "4m 18s",
    finding: "Tests take half of the build time.",
    detail:
      "Read workflows, jobs, and steps with the same clarity as an application trace.",
    spans: [
      { name: "Build", start: 0, width: 50, time: "2m 04s" },
      { name: "Install", start: 6, width: 20, time: "48 s" },
      { name: "Test", start: 26, width: 24, time: "1m 02s" },
      { name: "Deploy", start: 74, width: 26, time: "1m 00s" },
    ],
  },
];

const capabilities = [
  [
    "01",
    "Every signal. One story.",
    "Logs, traces, metrics, and errors, connected through OpenTelemetry. Go from a symptom to the request behind it.",
  ],
  [
    "02",
    "Your workflow, uninterrupted.",
    "Explore in the app or query with plain SQL from the CLI. The same telemetry, on your laptop and in your shared cloud workspace.",
  ],
  [
    "03",
    "Context for your coding assistant.",
    "Bundled skills help your assistant investigate real runtime behavior and connect a failing trace to the code that caused it.",
  ],
  [
    "04",
    "Knowledge that lives in your repo.",
    "Dashboards, alerts, and runbooks as code. Review them, version them, and give your whole team a shared starting point.",
  ],
];
const faqs = [
  [
    "Where does my telemetry live?",
    "During development, the collector runs on your machine and your data stays local. In production, services send OpenTelemetry over OTLP into your organization's shared Everr cloud workspace.",
  ],
  [
    "Do I need to instrument my code?",
    "If your runtime already speaks OpenTelemetry, you're most of the way there. Bundled skills help your coding assistant add instrumentation straight from your repository.",
  ],
  [
    "How does my coding assistant use Everr?",
    "Bundled skills teach it when to investigate telemetry. It can query local and cloud data through the CLI using plain SQL, then connect the results to your code.",
  ],
  [
    "Am I locked in?",
    "Everr uses OpenTelemetry for ingestion, Perses for dashboards, and ClickHouse SQL for queries. Your dashboards, alerts, and runbooks can live as portable files in your repository.",
  ],
];

function HomeNext() {
  const [selected, setSelected] = useState(0);
  const example = examples[selected];
  const { copied, copy } = useCopyToClipboard(INSTALL_COMMAND);

  return (
    <div className="hn">
      <a className="hn-skip" href="#hn-main">
        Skip to content
      </a>
      <header className="hn-nav hn-wrap">
        <a href="/home-next" className="hn-brand" aria-label="Everr home">
          <Citrus aria-hidden="true" />
          everr
        </a>
        <nav aria-label="Main navigation">
          <a href="#platform">Platform</a>
          <a href="/docs">Docs</a>
          <a href="/devlog">Devlog</a>
        </nav>
        <a href="https://app.everr.dev" className="hn-signin">
          Sign in <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </header>
      <main id="hn-main">
        <section className="hn-hero hn-wrap">
          <p className="hn-eyebrow">
            <span className="hn-dot" /> OBSERVABILITY, WITHOUT THE OVERHEAD
          </p>
          <h1>
            Less guesswork.
            <br />
            More <span>shipping.</span>
            <span className="hn-period">*</span>
          </h1>
          <div className="hn-hero-bottom">
            <p>
              Understand what your app is doing.
              <br />
              From the first local trace to production,
              <br className="hn-desktop-break" /> Everr puts the answers within
              reach.
            </p>
            <div>
              <a className="hn-cta" href="https://app.everr.dev">
                Get started <ArrowUpRight size={20} aria-hidden="true" />
              </a>
              <p className="hn-footnote">*No observability team required.</p>
            </div>
          </div>
          <div className="hn-hero-index">
            <span>BUILT FOR YOU. AND YOUR CODING ASSISTANT.</span>
            <a href="#see-it">
              FOLLOW THE SIGNAL <ArrowDown size={14} aria-hidden="true" />
            </a>
          </div>
        </section>

        <section
          className="hn-demo hn-wrap"
          id="see-it"
          aria-labelledby="demo-title"
        >
          <div className="hn-demo-heading">
            <h2 id="demo-title">Every request tells a story.</h2>
            <span className="hn-mono">ILLUSTRATIVE EXAMPLES / 01</span>
          </div>
          <div className="hn-demo-layout">
            <div className="hn-demo-aside">
              <fieldset className="hn-scenarios" aria-label="Choose an example">
                {examples.map((item, index) => (
                  <button
                    type="button"
                    key={item.name}
                    aria-pressed={selected === index}
                    onClick={() => setSelected(index)}
                  >
                    <span>0{index + 1}</span>
                    {item.name}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </fieldset>
              <p>{example.detail}</p>
            </div>
            <div className="hn-trace" aria-live="polite">
              <div className="hn-trace-title">
                <code>{example.route}</code>
                <span>{example.total}</span>
              </div>
              <div className="hn-trace-scale">
                <span>OPERATION</span>
                <span>ELAPSED TIME</span>
              </div>
              <div key={selected}>
                {example.spans.map((span, index) => (
                  <div
                    className={`hn-span ${index === 2 ? "hn-span-accent" : ""}`}
                    key={span.name}
                  >
                    <span>{span.name}</span>
                    <div className="hn-track">
                      <i
                        style={{
                          marginLeft: `${span.start}%`,
                          width: `${span.width}%`,
                          animationDelay: `${index * 100}ms`,
                        }}
                      />
                    </div>
                    <span>{span.time}</span>
                  </div>
                ))}
              </div>
              <p className="hn-finding">
                <span>↳</span>
                {example.finding}
              </p>
            </div>
          </div>
        </section>

        <section id="platform" className="hn-section hn-wrap">
          <div className="hn-section-heading">
            <p className="hn-eyebrow">01 / A CLEARER PICTURE</p>
            <h2>
              All the depth.
              <br />
              <span>None of the detours.</span>
            </h2>
            <p>
              Observability should help you build better software. It shouldn’t
              become another thing you have to build.
            </p>
          </div>
          <div className="hn-capabilities">
            {capabilities.map(([number, title, body]) => (
              <article key={number}>
                <span className="hn-mono">{number}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <div className="hn-inventory">
            <span>THE ESSENTIALS, ALL HERE</span>
            <ul>
              {[
                "Metrics",
                "Logs",
                "Traces",
                "Alerting",
                "Frontend observability",
              ].map((label) => (
                <li key={label}>
                  {label}
                  <Check size={14} aria-hidden="true" />
                </li>
              ))}
              <li>
                Session replay <small>PLANNED</small>
              </li>
            </ul>
          </div>
        </section>

        <section className="hn-local">
          <div className="hn-wrap hn-local-grid">
            <div>
              <p className="hn-eyebrow">02 / START CLOSE TO HOME</p>
              <h2>
                Your laptop.
                <br />
                Your first <span>answer.</span>
              </h2>
              <p>
                Install the desktop app and see what’s happening while you
                build. A local collector, real telemetry, and an immediate
                feedback loop.
              </p>
              <a className="hn-text-link" href="#install">
                Try Everr locally <ArrowUpRight size={18} aria-hidden="true" />
              </a>
              <p className="hn-footnote">macOS & Linux. No account required.</p>
            </div>
            <figure>
              <img
                src={desktop}
                alt="Everr desktop app with local telemetry exploration"
                loading="lazy"
                width="1000"
                height="666"
              />
              <figcaption>LOCAL FIRST. PRODUCTION READY.</figcaption>
            </figure>
          </div>
        </section>

        <section className="hn-section hn-wrap hn-stack">
          <div>
            <p className="hn-eyebrow">03 / ALREADY SPEAKS YOUR LANGUAGE</p>
            <h2>
              Fits your stack.
              <br />
              <span>And your standards.</span>
            </h2>
            <p>
              Built on OpenTelemetry, with open standards all the way through.
              Keep the tools and languages you know.
            </p>
            <a href="/docs" className="hn-text-link">
              Explore the documentation{" "}
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
          <div className="hn-stack-lists">
            <div>
              <h3>Languages & runtimes</h3>
              <p>
                Elixir · Node.js · Rust · Go
                <br />
                Python · TypeScript · PHP · Java
              </p>
            </div>
            <div>
              <h3>Frameworks</h3>
              <p>
                Symfony · Laravel · TanStack · Next.js
                <br />
                Express · NestJS · Django · FastAPI
              </p>
            </div>
            <div className="hn-standards">
              <span>OpenTelemetry</span>
              <span>Perses</span>
              <span>ClickHouse</span>
            </div>
          </div>
        </section>

        <section className="hn-quote hn-wrap">
          <p className="hn-eyebrow">LESS BABYSITTING. MORE BUILDING.</p>
          <figure>
            <blockquote>
              “Everr is the first one the whole team actually uses. And it’s not
              a watered-down version, it does everything we need without anyone
              babysitting it.
              <br />
              <span>It’s how we work now.</span>”
            </blockquote>
            <figcaption>
              <img
                src={marcello}
                width="44"
                height="44"
                alt=""
                loading="lazy"
              />
              <div>
                Marcello Roherssen<span>CTO, SkillVue</span>
              </div>
            </figcaption>
          </figure>
        </section>

        <section className="hn-section hn-wrap hn-faq">
          <div>
            <p className="hn-eyebrow">A FEW MORE THINGS</p>
            <h2>
              Good questions.
              <br />
              <span>Straight answers.</span>
            </h2>
            <a href="https://discord.gg/hd6yYDjAuw" className="hn-text-link">
              Talk to us on Discord{" "}
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
          <div>
            {faqs.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <Plus size={18} aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="hn-closing hn-wrap" id="install">
          <p className="hn-eyebrow">YOUR NEXT “OH, THAT’S WHY.” STARTS HERE.</p>
          <h2>
            Make sense
            <br />
            of <span>your software.</span>
            <ArrowUpRight aria-hidden="true" />
          </h2>
          <div className="hn-closing-bottom">
            <p>
              Start local. Follow a trace.
              <br />
              Get back to building.
            </p>
            <div className="hn-install">
              <div>
                <span aria-hidden="true">$</span>
                <code>{INSTALL_COMMAND}</code>
                <button
                  type="button"
                  onClick={copy}
                  aria-label={copied ? "Copied" : "Copy install command"}
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </button>
              </div>
              <p aria-live="polite">
                {copied
                  ? "Copied to clipboard."
                  : "One command. No account required."}
              </p>
              <a href="/docs" className="hn-text-link">
                Read the setup guide <ArrowRight size={15} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
      </main>
      <footer className="hn-footer hn-wrap">
        <a href="/home-next" className="hn-brand">
          <Citrus aria-hidden="true" />
          everr
        </a>
        <span>© {new Date().getFullYear()} Everr</span>
        <nav aria-label="Footer navigation">
          <a href="https://github.com/everr-labs/everr">GitHub</a>
          <a href="https://discord.gg/hd6yYDjAuw">Discord</a>
          <a href="https://x.com/everrlabs">X</a>
          <a href="/docs">Docs</a>
        </nav>
        <span>KEEP BUILDING.</span>
      </footer>
    </div>
  );
}
