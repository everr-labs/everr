/**
 * Homepage placeholder sections.
 *
 * These are scaffolding stubs — NOT final components. Each one documents what
 * the real section should contain and why, grounded in the market study:
 *
 *  - CNCF observability microsurvey: tool sprawl is the norm (72% use 1–9
 *    tools, 23% use 10–15). Top challenges: complexity, lack of documentation,
 *    lack of skills, lack of strategy.
 *  - Grafana 2026 survey: cost and ease of use are the top buying criteria.
 *    ~50% track business-related metrics via observability. Full-stack
 *    observability, SLOs, and business observability are all rising.
 *
 * GTM thesis for the page: lead with complexity reduction + time to value.
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

/** Social proof immediately below the hero — logos of users/adopters. */
export function LogoCloud() {
  return (
    <PlaceholderSection
      title="Logo cloud / social proof"
      purpose="Establish instant credibility with a row of recognizable company or project logos right under the hero."
      todos={[
        "Grayscale logo strip (6–10 logos), responsive wrap on mobile",
        '"Trusted by teams at…" or "Used in production by…" eyebrow',
        "Use real adopters / GitHub stars / notable OSS users — no placeholder logos at launch",
        "Optional: link to a case studies or users page",
      ]}
      evidence="Buyers de-risk new tools with proof others rely on them; social proof is table stakes for a modern observability homepage."
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
        "Frame each around complexity reduction & time to value, not raw features",
        "Each card links to the relevant docs page",
      ]}
      evidence="Grafana 2026: full-stack observability and SLOs are rising; ease of use is a top buying criterion — features should read as outcomes, not a spec sheet."
    />
  );
}

/** Business observability spotlight — beyond infra metrics. */
export function BusinessObservability() {
  return (
    <PlaceholderSection
      title="Business observability spotlight"
      purpose="Show that Everr connects technical telemetry to business outcomes (revenue, conversions, usage), not just infra health."
      todos={[
        "Concrete examples: track business KPIs alongside technical metrics on one timeline",
        "Show a business-metric dashboard mock or example query",
        "Speak to both engineers and the business stakeholders who fund tooling",
        "Tie into the marketing thesis: business AND technical data, simply",
      ]}
      evidence="Grafana 2026: ~50% of respondents already track business-related metrics with observability and business observability is rising — a real differentiator to feature prominently."
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

/** Integrations — works with the stack you already have. */
export function Integrations() {
  return (
    <PlaceholderSection
      title="Integrations / works with your stack"
      purpose="Reassure buyers Everr fits their existing tooling (OpenTelemetry-native) so adoption isn't a rip-and-replace."
      todos={[
        "Emphasize OpenTelemetry-native ingestion (no vendor lock-in)",
        "Grid of supported languages, frameworks, and exporters",
        "Show CI / agent / dev-machine ingestion paths",
        "Link to integrations catalog in docs",
      ]}
      evidence="Tool sprawl means buyers won't replace everything at once; OTel-native compatibility lowers the switching cost and counters lock-in fears."
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
      evidence="Grafana 2026: cost is a top buying criterion — transparent pricing and the OSS angle are direct levers on the purchase decision."
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
      evidence="Peer validation is a core trust signal; quotes that echo the page's complexity/ease thesis reinforce the GTM message."
    />
  );
}
