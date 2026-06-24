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
 *    Full-stack observability and SLOs are rising. (Business observability is
 *    rising in the survey too, but it's NOT shipped for Everr — kept off the page.)
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
 * GTM thesis: identity stays "observability made simple"; lead with the AGENT
 * WEDGE and fold everything else into proof under three
 * pillars (see HOMEPAGE.md §1 for the full version):
 *   1. Agent-native — coding agents are first-class consumers (the wedge, lead).
 *   2. One system, full lifecycle — SUBSTANTIATE: name the engine (ClickHouse),
 *      query surface, multitenancy/RBAC; one REAL production number above the fold.
 *   3. Open & portable — one plain sentence, acronyms behind a disclosure; state
 *      which signals are portable (per-signal scope).
 * Guardrails: numbers over adjectives; "portable" only per named open format;
 * define jargon at every layer; no maximal "replace Datadog" claim beside a hedge;
 * never invent figures. NOTE: business observability / business-KPI joins are NOT
 * shipped and buyers are skeptical — keep them off the page entirely.
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
      title="Open by default — open standards, low lock-in"
      purpose="Lead with ONE plain sentence — 'your data stays in standard formats, so you're never locked in' — and put the acronyms behind a 'for experts' disclosure."
      todos={[
        "Plain-language lead first; acronym wall (OTLP, PromQL, Perses, Prometheus rules) behind a 'for the experts' disclosure",
        "State per-signal portability: metrics + alerts + dashboards in open formats (PromQL / Prometheus rules / Perses); traces + logs via OTLP export (raw-export only)",
        "Don't overstate: PromQL ingest ≠ identical recording-rule/histogram_quantile/subquery semantics; Perses ≠ Grafana's ecosystem",
        "Grid of languages/frameworks/exporters; dev / agent / CI / prod paths; link to repo",
      ]}
      evidence="Grafana 2026: 77% value open standards. Reviewers: 'portable' floats unless scoped per-signal — state which signals are fully portable (metrics/alerts/dashboards) vs. raw-export only (traces/logs)."
    />
  );
}

/** Core capabilities grid — the 'what you get' section. */
export function Features() {
  return (
    <PlaceholderSection
      title="Features / capabilities grid"
      purpose="Outcome-framed cards — and the home for the substantiation Pillar 2 needs (architecture + production numbers)."
      todos={[
        "Full-stack observability (logs, traces, metrics, errors in one place)",
        "Production with NUMBERS not adjectives: cardinality, retention/downsampling, SLO depth (multi-window burn-rate), alert routing (dedup/escalation/on-call), HA",
        "Architecture line: ClickHouse-backed store, the query surface, and a multitenancy/RBAC/quota mention (platform buyers fear hidden tradeoffs)",
        "No business-observability / business-KPI cards — not shipped, buyers skeptical",
        "Define 'SLO' in plain words on first use; link each card to docs",
      ]}
      evidence="Reviewers: the load-bearing 'one system, full lifecycle' claim is least substantiated — name the engine, query surface, multitenancy and one real number. The SRE rates production on specifics."
    />
  );
}

/** Agents as first-class consumers — the wedge, mid-page. Never the headline. */
export function AIAssistant() {
  return (
    <PlaceholderSection
      title="Agents as first-class consumers (the wedge)"
      purpose="Frame AI as a category wedge, not a feature: your coding agents are now a primary consumer of observability, and Everr gives them ground truth on demand instead of letting them guess."
      todos={[
        "Lead with the wedge: agents query Everr (one structured API + query surface) for real error rates, latencies, the spans that actually fired",
        "Position assistive in-product uses (query/dashboard generation, anomaly surfacing, root-cause) as supporting detail, not the headline",
        "Keep reasoning transparent: sources, query logic, confidence — never a black box",
        "Address the 'manual context' blocker — the agent already has your telemetry context",
        "Assist, not autopilot; keep it mid-page — do NOT move AI into the hero headline",
      ]}
      evidence="Grafana 2026 AI: valued in-product (92% dashboards/queries, 91% root cause) but only 15% buy on AI; 95% demand explainable reasoning; trust drops for autonomy (77%). Agent-as-consumer (a data/integration wedge) satisfies both the survey data and the seniority split — newcomer's hook, senior's credibility — where a generic 'AI assistant' gets a shrug."
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
      purpose="Address the buying criterion head-on — open-source core, transparent pricing, and an explicit answer on cost at scale."
      todos={[
        "Clear, simple pricing tiers or a 'free & open-source core' lead",
        "Self-host vs. managed comparison",
        "Explicitly address COST AT SCALE — the SRE rated this low; show the model, don't just say 'no surprise bills'",
        "Primary CTA to pricing page / get started",
      ]}
      evidence="Grafana 2026: cost is a top buying criterion and the SRE rated cost-at-scale low — transparent pricing plus a concrete at-scale cost model (not vague 'no surprise bills') is the lever."
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
