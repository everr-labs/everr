import { cn } from "@everr/ui/lib/utils";

/**
 * Homepage placeholder sections.
 *
 * These are scaffolding stubs — NOT final components. Each captures the INTENT of
 * the real section (its intended lead copy, what it must include, what to avoid,
 * and why) so an implementer can build it without drifting. Full positioning lives
 * in HOMEPAGE.md; this file is the on-page projection of it.
 *
 * Market grounding (2026):
 *  - CNCF microsurvey: tool sprawl is the norm (72% use 1–9 tools, 23% use 10–15);
 *    top challenges are complexity, docs, skills, strategy.
 *  - Grafana 2026 (core): cost + ease of use are the top buying criteria;
 *    full-stack + SLOs rising. (Business observability is rising in the survey but
 *    is NOT shipped for Everr — kept off the page entirely.)
 *  - Grafana 2026 (open source): 77% value open source/open standards (61%
 *    essential); OSS is the #4 selection criterion (25%); 37% adopt OTel to avoid
 *    lock-in.
 *  - Grafana 2026 (AI): valued in-product (92% dashboards/queries, 91% root cause)
 *    but only 15% buy on AI; 95% demand explainable reasoning; trust drops for
 *    autonomy (77%).
 *
 * GTM thesis: identity stays "observability made simple"; lead with the AGENT
 * WEDGE and fold everything else into proof under three pillars (HOMEPAGE.md §1):
 *   1. Agent-native — coding agents query ground truth (the wedge/HOOK, lead).
 *      The moat is NOT a "hard-to-copy store" (it's open by design). Stance:
 *      openness = adoption wedge (easy to leave); the moat is the unified semantic
 *      contract + workflow — "leaving is easy, staying is better." Own a CATEGORY
 *      NOUN in the H1 region (e.g. "lifecycle observability", Gio to confirm).
 *   2. One system, full lifecycle — SUBSTANTIATE: SHOW the tiering (retention/
 *      sampling/cardinality per tier); ClickHouse is table stakes, not a moat; one
 *      REAL production number above the fold (DOESN'T EXIST YET — top blocker).
 *   3. Open & portable — one plain sentence, acronyms behind a disclosure; state
 *      which signals are portable; add a compat matrix + migration note.
 * Guardrails: numbers over adjectives; "portable" only per named open format;
 * define jargon at every layer; no maximal "replace Datadog" claim beside a hedge;
 * never invent figures; insider words ("wedge", "agent-native") stay off the page.
 *
 * Replace each <PlaceholderSection> with a purpose-built component, then delete
 * its stub here.
 */

type PlaceholderSectionProps = {
  /** Short working name for the section. */
  title: string;
  /** One-line statement of what this section must accomplish. */
  purpose: string;
  /** Intended on-page lead — the headline/copy direction (placeholder values ok). */
  draft: string;
  /** Render the draft in monospace (for code/query snippets). */
  draftMono?: boolean;
  /** Concrete things the real section MUST include. */
  todos: string[];
  /** Guardrails / anti-patterns to avoid. */
  avoid?: string[];
  /** Why this section earns its place — tie back to evidence/review. */
  evidence: string;
};

function PlaceholderSection({
  title,
  purpose,
  draft,
  draftMono,
  todos,
  avoid,
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
            Intended lead
          </p>
          <div
            className={cn(
              "mt-2 max-w-3xl whitespace-pre-line border-l-2 border-primary pl-4 text-fd-foreground",
              draftMono
                ? "font-mono text-sm leading-relaxed"
                : "font-heading text-xl leading-snug",
            )}
          >
            {draft}
          </div>

          <p className="mt-6 font-mono text-xs uppercase tracking-widest text-fd-muted-foreground">
            Must include
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fd-muted-foreground">
            {todos.map((todo) => (
              <li key={todo}>{todo}</li>
            ))}
          </ul>

          {avoid && avoid.length > 0 ? (
            <>
              <p className="mt-6 font-mono text-xs uppercase tracking-widest text-fd-muted-foreground">
                Avoid
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fd-muted-foreground">
                {avoid.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}

          <p className="mt-6 max-w-3xl rounded-md bg-fd-muted/50 p-3 text-xs text-fd-muted-foreground">
            <span className="font-semibold text-fd-foreground">Why: </span>
            {evidence}
          </p>
        </div>
      </div>
    </section>
  );
}

/** Trust strip under the hero — named design partner + open-source traction. */
export function LogoCloud() {
  return (
    <div>
      <PlaceholderSection
        title="Trust strip / social proof"
        purpose="Instant credibility under the hero: a named design partner plus independent community traction."
        draft={
          "Design partner: SkillVue   ·   ⭐ {GitHub stars} on GitHub   ·   Open source"
        }
        draftMono
        todos={[
          "Anchor with the SkillVue design-partner logo (named reference)",
          "Second proof leg: live GitHub stars / downloads / contributors",
          "Logo strip (6–10 logos), responsive wrap on mobile; 'Design partner' eyebrow + 'Open source' pill",
        ]}
        avoid={[
          "Placeholder/invented logos",
          "Relying on a single partner — one reference reads as pre-traction",
        ]}
        evidence="CTO: one design partner reads as pre-traction — pair the named SkillVue reference with OSS adoption as a second, independent proof leg. OSS is the #4 selection criterion (25%)."
      />
    </div>
  );
}

/** Names the pain — tool sprawl — and sets up the consolidation story. */
export function ProblemToolSprawl() {
  return (
    <PlaceholderSection
      title="The problem: tool sprawl & complexity"
      purpose="Name the buyer's pain before the cure, and set up consolidation as the credible version of 'replace the stack'."
      draft={
        "Answering one question shouldn't take seven tools.\n72% of teams run 1–9 observability tools. 23% run 10–15."
      }
      todos={[
        "Lead with the sprawl stat (72% use 1–9, 23% use 10–15)",
        "Name the real costs: complexity, onboarding/skills gap, no unified strategy",
        "Contrast 'wall of dashboards' vs. one pipeline (dev → agents → CI → prod)",
        "Transition into consolidation onto one system",
      ]}
      avoid={[
        "A maximal 'replace Datadog today' claim here (or anywhere beside a hedge)",
        "Jargon without a plain-language gloss",
      ]}
      evidence="CNCF: tool sprawl is the norm and complexity is the #1 challenge — the page must lead with complexity reduction."
    />
  );
}

/** Open by default — openness as the adoption wedge, honest per-signal scope. */
export function OpenStandards() {
  return (
    <PlaceholderSection
      title="Open by default — open standards, low lock-in"
      purpose="Openness is the adoption wedge (easy to enter and leave); say it plainly, scope portability per signal, and take the explicit stance."
      draft={
        "Your data stays in standard formats. You're never locked in.\nWe'd rather you stay because leaving is easy — and staying is better."
      }
      todos={[
        "Plain-language lead; acronyms (OTLP, PromQL, Perses) behind a 'for experts' disclosure",
        "Per-signal portability: metrics + alerts + dashboards in open formats (PromQL / Prometheus rules / Perses); traces + logs via OTLP export (raw-export only)",
        "Containment: a PromQL/Perses compatibility matrix + a Perses↔Grafana migration note (documented boundary, not hidden risk)",
        "Voice the stance: openness = on-ramp; the unified semantic contract + workflow is why staying is better",
      ]}
      avoid={[
        "Letting 'portable' float across all signals",
        "An acronym wall up top",
        "Claiming the open store itself is the moat — it's open by design (contradiction); don't overstate PromQL/Perses parity",
      ]}
      evidence="77% value open standards; experts call out vague 'portable'. The openness↔moat stance dissolves the contradiction instead of hiding it."
    />
  );
}

/** Full-stack capabilities + the production substantiation Pillar 2 needs. */
export function Features() {
  return (
    <PlaceholderSection
      title="Features / capabilities — and the production proof"
      purpose="Outcome-framed cards, and the home for the substantiation Pillar 2 needs: shown tiering, real production numbers, and operator depth behind a disclosure."
      draft={
        "Logs, traces, metrics, errors — one store, one query surface,\nfrom your laptop to production."
      }
      todos={[
        "Full-stack cards (logs, traces, metrics, errors in one place)",
        "Production in NUMBERS: cardinality, retention/downsampling, SLO depth (multi-window burn-rate), alert routing (dedup/escalation/on-call), HA",
        "SHOW the tiering (retention/sampling/cardinality knobs per tier) — turns 'one store, dev→prod' from assertion into demonstration",
        "Operator depth behind a 'for experts' disclosure: ClickHouse-backed, query surface, multitenancy/RBAC, PromQL-compat matrix, cost-at-scale curve",
        "Define 'SLO' in plain words on first use; link each card to docs",
      ]}
      avoid={[
        "Adjectives without numbers ('first-class', 'enterprise-grade')",
        "Selling ClickHouse as the moat — it's table stakes (SigNoz/Uptrace too)",
        "Business-observability / business-KPI cards (not shipped, buyers skeptical)",
        "Forcing operator jargon on newcomers",
      ]}
      evidence="Reviewers: 'one system, full lifecycle' is the least-substantiated, load-bearing claim — SHOW the tiering. The production number is still empty (TOP blocker); the SRE rates production on specifics."
    />
  );
}

/** Agents as first-class consumers — the wedge, made demonstrable. */
export function AIAssistant() {
  return (
    <PlaceholderSection
      title="Agents as first-class consumers (the wedge)"
      purpose="Make the wedge demonstrable: an agent queries Everr for ground truth and acts on it. Anchor defensibility to the unified store, not the endpoint."
      draftMono
      draft={
        '> agent asks Everr:  { service: "checkout", since: "15m", where: "status >= 500" }\n' +
        '< Everr returns:     { errors: 37, p99_ms: 1840, top_trace: "…", deploy: "v812" }\n\n' +
        "Your agents query what your software actually did — and stop guessing."
      }
      todos={[
        "Show the agent-query snippet: the call + the JSON back (the dev wants request/response, not a claim)",
        "Anchor the MOAT: the unified semantic contract + workflow that humans + CI + agents share — the endpoint is its expression, not the defensibility",
        "Position assistive uses (query/dashboard gen, anomaly, root-cause) as supporting detail",
        "Keep reasoning transparent (sources, query logic, confidence); address the 'manual context' blocker; assist, not autopilot",
      ]}
      avoid={[
        "Framing this as a chatbot 'AI assistant', or AI-as-feature in the hero headline",
        "Insider words on the page ('wedge', 'agent-native', 'first-class consumers') — say it plainly",
        "Claiming the agent endpoint is the moat — it's a quarter of an incumbent's roadmap",
      ]}
      evidence="Grafana 2026 AI: only 15% buy on AI, 95% demand explainable reasoning, trust drops for autonomy (77%). Architect: the agent surface alone is cloneable — the unified store is the moat."
    />
  );
}

/** Time to value — fast path to first insight. */
export function TimeToValue() {
  return (
    <PlaceholderSection
      title="Time to value / quick start"
      purpose="Prove how fast a team goes from zero to first insight — the strongest counter to 'observability is hard'."
      draft={
        "From install to first trace in ~{N} minutes.\nOne command. Sensible defaults. No yak-shaving."
      }
      todos={[
        "One-command install snippet with a tabbed language/runtime switcher",
        "'First trace in N minutes' with a REAL number",
        "Minimal-config story — sensible defaults, auto-instrumentation",
        "Link to the full quickstart in docs",
      ]}
      avoid={[
        "Waitlist / pre-launch hedging",
        "Inventing the 'N minutes' figure",
        "Proving 'simple' with raw SQL/PromQL (that's power-user depth)",
      ]}
      evidence="CNCF: skills/complexity are top blockers; Grafana: ease of use is a top buying criterion — a visible fast path to value addresses both."
    />
  );
}

/** Pricing / cost — open-source core, transparent, sane at scale. */
export function PricingTeaser() {
  return (
    <PlaceholderSection
      title="Pricing / cost transparency"
      purpose="Address cost head-on: open-source core, transparent pricing, and an explicit, credible answer on cost at scale."
      draft={
        "Open-source core. Transparent pricing that stays sane at scale.\n{N} tools → 1, ~{X}% cut — here's the math."
      }
      todos={[
        "Lead with the open-source core (free local); self-host vs. managed comparison",
        "Show the cost-at-scale MODEL — not just 'no surprise bills'",
        "A consolidation-TCO before/after artifact a buyer can paste into a budget deck",
        "Primary CTA to pricing / get started",
      ]}
      avoid={[
        "Inventing tiers/prices that don't exist",
        "Vague 'no surprise bills' with no model",
        "Pre-launch hedging",
      ]}
      evidence="Cost is a top buying criterion and the SRE rated cost-at-scale low; the CTO wants a pasteable TCO artifact. Transparent pricing + a real at-scale model is the lever."
    />
  );
}

/** Testimonials — anchored by the SkillVue CTO quote. */
export function Testimonials() {
  return (
    <PlaceholderSection
      title="Testimonials"
      purpose="Back the claims with real practitioner voices, anchored by the SkillVue CTO quote (which also runs above the fold)."
      draft={
        '"[SkillVue CTO quote — paste the exact words]"\n— [Name], CTO, SkillVue'
      }
      todos={[
        "ANCHOR: the SkillVue CTO quote — fill in exact words + name (we have it)",
        "2–4 quote cards: name, role, company, avatar",
        "Choose quotes that reinforce consolidation, simplicity & fast time to value",
      ]}
      avoid={[
        "Invented or unattributable testimonials",
        "Off-thesis quotes that don't echo consolidation/simplicity",
      ]}
      evidence="A named reference + CTO quote is the single biggest credibility lever — it converts a CTO's 'let's meet' into a POC."
    />
  );
}
