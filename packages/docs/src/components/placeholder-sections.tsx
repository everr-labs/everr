/**
 * Homepage placeholder sections.
 *
 * These are scaffolding stubs — NOT final components. Each documents what the
 * real section should contain and why, grounded in the 2026 market evidence:
 *
 *  - CNCF observability microsurvey: tool sprawl is the norm (72% use 1–9
 *    tools, 23% use 10–15). Top challenges: complexity, lack of documentation,
 *    lack of skills, lack of strategy.
 *  - Grafana 2026 (core): cost and ease of use are the top buying criteria.
 *    ~50% track business-related metrics. Full-stack, SLOs, and business
 *    observability are rising.
 *  - Grafana 2026 (open source): 77% say open source/open standards matter
 *    (61% "very important/essential"); OSS is the #4 selection criterion (25%),
 *    interoperability #2 (26%), and 58% select on at least one open-standards
 *    criterion. OpenTelemetry adopted to avoid vendor lock-in (37%) and for
 *    ease of adoption (41%).
 *  - Grafana 2026 (AI): AI is broadly valued in-product (dashboards/queries
 *    92%, anomaly detection 92%, forecasting 91%, root cause 91%, onboarding
 *    89%) BUT only 15% pick a tool based on AI, and 95% demand AI that explains
 *    its reasoning. Trust drops for autonomous action (77%). Biggest blocker:
 *    26% "too much manual input of context."
 *
 * GTM thesis: lead with complexity reduction, cost/ease, and openness. AI is an
 * enabler shown mid-page, never the headline.
 *
 * Replace each <PlaceholderSection> with a purpose-built component, then delete
 * its stub here.
 */

type PlaceholderSectionProps = {
  /** Short working name for the section. */
  title: string;
  /** One-line statement of what this section must accomplish. */
  purpose: string;
  /** Concrete things the real section should include. */
  todos: string[];
  /** Why this section earns its place — tie back to the market evidence. */
  evidence: string;
};

function PlaceholderSection({
  title,
  purpose,
  todos,
  evidence,
}: PlaceholderSectionProps) {
  return (
    <section className="border-b-2 border-dashed border-fd-border bg-fd-background">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="rounded-xl border-2 border-dashed border-fd-border/70 p-6">
          <p className="mb-1 font-mono text-xs uppercase tracking-widest text-fd-muted-foreground">
            Placeholder section
          </p>
          <h2 className="font-heading text-2xl text-fd-foreground">{title}</h2>
          <p className="mt-2 max-w-3xl text-fd-muted-foreground">{purpose}</p>

          <p className="mt-6 font-mono text-xs uppercase tracking-widest text-fd-muted-foreground">
            TODO
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fd-muted-foreground">
            {todos.map((todo) => (
              <li key={todo}>{todo}</li>
            ))}
          </ul>

          <p className="mt-6 max-w-3xl rounded-md bg-fd-muted/50 p-3 text-xs text-fd-muted-foreground">
            <span className="font-semibold text-fd-foreground">Why: </span>
            {evidence}
          </p>
        </div>
      </div>
    </section>
  );
}

/** Social proof immediately below the hero — logos + open-source credibility. */
export function LogoCloud() {
  return (
    <PlaceholderSection
      title="Logo cloud / social proof"
      purpose="Establish instant credibility under the hero with adopter logos and an open-source proof signal (GitHub stars)."
      todos={[
        "Grayscale logo strip (6–10 logos), responsive wrap on mobile",
        '"Trusted by teams at…" / "Used in production by…" eyebrow',
        "Add a live GitHub stars badge + 'Open source' pill — OSS is itself a trust + buying signal",
        "Use real adopters / notable OSS users only — no placeholder logos at launch",
      ]}
      evidence="Social proof is table stakes, and Grafana 2026 shows open source is the #4 selection criterion (25%) with 77% saying open standards matter — so OSS credibility belongs in the trust strip, not buried."
    />
  );
}

/** Names the pain: tool sprawl and complexity. Sets up Everr as the consolidation. */
export function ProblemToolSprawl() {
  return (
    <PlaceholderSection
      title="The problem: tool sprawl & complexity"
      purpose="Name the buyer's pain before pitching the cure — too many disconnected tools, too much glue, too little insight."
      todos={[
        "Lead stat: most teams juggle many tools (72% use 1–9, 23% use 10–15)",
        "Call out the real costs: complexity, onboarding/skills gap, no unified strategy",
        "Contrast 'wall of dashboards' vs. one unified pipeline (laptop → CI → agents → prod)",
        "Transition line into how Everr collapses the stack",
      ]}
      evidence="CNCF microsurvey: tool sprawl is the norm and the top challenges are complexity, lack of documentation, lack of skills, and lack of strategy — so the page must lead with complexity reduction."
    />
  );
}

/** Open standards / OTel-native / no lock-in — elevated near the top. */
export function OpenStandards() {
  return (
    <PlaceholderSection
      title="Open by default — OpenTelemetry-native, no lock-in"
      purpose="Make openness a top-tier promise: OTel-native ingestion, Prometheus-compatible, and freedom to switch backends — no rip-and-replace, no lock-in."
      todos={[
        "Headline the OTel-native + Prometheus-compatible story (drop-in for existing pipelines)",
        "Explicit 'no vendor lock-in' message + self-host option",
        "Grid of supported languages, frameworks, exporters; CI / agent / dev-machine ingestion paths",
        "Reinforce the open-source angle (link to repo); link to integrations catalog",
      ]}
      evidence="Grafana 2026: 77% value open source/open standards (61% essential), 58% select on an open-standards criterion, and 37% adopt OpenTelemetry specifically to avoid lock-in — openness is a top differentiator and must sit high, not as a footnote."
    />
  );
}

/** Core capabilities grid — the 'what you get' section. */
export function Features() {
  return (
    <PlaceholderSection
      title="Features / capabilities grid"
      purpose="Show the breadth (full-stack: logs, traces, metrics, errors) without overwhelming — organized around outcomes, not plumbing."
      todos={[
        "3–6 feature cards with icon + headline + one-line benefit",
        "Cover full-stack observability (logs, traces, metrics, errors in one place)",
        "Highlight SLOs / alerting as first-class (rising in demand)",
        "Thread transparency/explainability through the cards (95% want to see the 'why')",
        "Frame each around complexity reduction & time to value; link each to docs",
      ]}
      evidence="Grafana 2026: full-stack observability and SLOs are rising, ease of use is a top buying criterion, and 95% want tools to explain their reasoning — features should read as transparent outcomes, not a spec sheet."
    />
  );
}

/** AI as an assistant — enabler, mid-page, transparent. Never the headline. */
export function AIAssistant() {
  return (
    <PlaceholderSection
      title="AI assistant (enabler, not headline)"
      purpose="Show AI as a transparent assistant that removes toil — generating queries/dashboards, surfacing anomalies, accelerating root cause — with its reasoning always visible."
      todos={[
        "Lead with the valued, assistive use cases: query/dashboard generation, anomaly detection, forecasting, root-cause, onboarding",
        "Make transparency the hero of the section: show sources, query logic, confidence — never a black box",
        "Address the 'manual context' blocker — AI that already has your telemetry context",
        "Frame as assist, not autopilot; avoid over-promising autonomous remediation",
        "Keep it mid-page and supporting — do NOT move AI into the hero",
      ]}
      evidence="Grafana 2026 AI: AI is broadly valued in-product (92% dashboards/queries, 92% anomalies, 91% root cause) but only 15% choose a tool because of AI, 95% demand explainable reasoning, and trust drops for autonomous action (77%) — so AI belongs mid-page, transparent, and assistive."
    />
  );
}

/** Time-to-value / ease-of-use proof — quick start. */
export function TimeToValue() {
  return (
    <PlaceholderSection
      title="Time to value / quick start"
      purpose="Prove how fast a team goes from zero to first insight — the single strongest counter to 'observability is hard'."
      todos={[
        "Copy-paste install snippet (one command) with a tabbed language/runtime switcher",
        "'From install to first trace in N minutes' claim with a real number",
        "Minimal config story — sensible defaults, auto-instrumentation",
        "Link to the full quickstart in docs",
      ]}
      evidence="CNCF lists lack of skills/strategy and complexity as top blockers; Grafana ranks ease of use as a top buying criterion — a visible fast path to value directly addresses both."
    />
  );
}

/** Pricing transparency / cost-efficiency. */
export function PricingTeaser() {
  return (
    <PlaceholderSection
      title="Pricing / cost transparency"
      purpose="Address the #1 buying criterion head-on — predictable, transparent cost (and the open-source/self-host story)."
      todos={[
        "Clear, simple pricing tiers or a 'free & open-source' lead",
        "Self-host vs. managed comparison",
        "Avoid usage-based surprise-bill anxiety — state the model plainly",
        "Primary CTA to pricing page / get started",
      ]}
      evidence="Grafana 2026: cost is the top buying criterion — transparent pricing and the OSS/self-host angle are direct levers on the purchase decision."
    />
  );
}

/** Testimonials / quotes from real users. */
export function Testimonials() {
  return (
    <PlaceholderSection
      title="Testimonials"
      purpose="Back the claims with the voices of real practitioners — quotes that speak to simplicity and time saved."
      todos={[
        "2–4 quote cards: name, role, company, avatar",
        "Pick quotes that reinforce complexity reduction & fast time to value",
        "Optional: pull a standout metric ('cut our tools from 8 to 1')",
        "Only use real, attributable quotes at launch",
      ]}
      evidence="Peer validation is a core trust signal; quotes that echo the page's complexity/ease/openness thesis reinforce the GTM message."
    />
  );
}
