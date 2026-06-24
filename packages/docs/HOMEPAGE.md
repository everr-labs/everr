# Homepage section guide

Grounding doc for anyone (human or agent) filling in or implementing homepage
sections. **Read this before touching a section** and keep changes within the
scope described here. The goal is a coherent, *convincing* page — not a pile of
independently "optimized" blocks, and not slogans a skeptical SRE will bounce
off.

Page route: `src/routes/index.tsx` (controls section order).
Section components: `src/components/*.tsx`.
Placeholder stubs live in `src/components/placeholder-sections.tsx` — replace
each with a real component and delete its stub.

---

## 1. Positioning (the spine — keep all copy consistent)

### North star vs. what we prove on the page

- **North star (the direction, not a headline claim):** Everr becomes the single
  system teams consolidate their observability onto across the whole lifecycle —
  dev machines, AI agents, CI, and production — collapsing the fragmented
  Datadog/Grafana/Honeycomb-era stack into one.
- **How we earn it: proof, not slogans.** Do **not** put a maximal "replace
  Datadog" claim on the page, and *never* next to maturity hedges or a waitlist.
  Every buyer persona flagged that combination as the single biggest
  trust-killer — a grand claim beside "not fully shipped" nukes credibility on
  *everything else*. Lead with the wedge we can defend; let the trajectory imply
  the destination.
- **The defensible wedge today:** one OTel-native pipeline, **agents as
  first-class consumers** of telemetry, verify-before-ship, open and low-lock-in.
  Sell the wedge; don't oversell the endgame.

### Core pillars

1. **One system, full lifecycle.** Dev → agents → CI → production, same data
   model and query surface everywhere. Production is fully in scope (not
   pre-prod-only; don't use "pre-prod vs prod" as a framing axis).
   - **Production must be credible to an SRE — use numbers, not adjectives.**
     Words like "first-class" or "enterprise-grade" read as empty to this buyer.
     Where production is claimed, address the things they actually evaluate:
     **cardinality** handling, **retention/downsampling**, **SLO depth**
     (multi-window burn-rate, not just a gauge), **alert routing** (dedup,
     grouping, escalation, on-call integrations), **HA/replication**, and
     **cost at scale**. If we don't have the concrete number/capability yet, get
     it or omit the claim — do not paper over it with an adjective.
2. **Agents as first-class consumers (the wedge — not an "AI feature").** Frame
   AI as: your coding agents are now a primary *consumer* of observability data,
   and Everr is built for that — one structured API + query surface an agent can
   drive to get ground truth instead of guessing. This is a category wedge, and
   it resolves the seniority split: it's the newcomer's hook *and* survives the
   senior's "AI is a gimmick" shrug because it's an integration/data argument,
   not a chatbot. Keep the literal hero headline off "AI" (only 15% buy on AI),
   but agents-as-consumer is a strong co-thesis through the back half.
3. **Open standards + low lock-in, product-wide — name the formats.** This spans
   telemetry *and* dashboards, notebooks, alerts, and whatever comes next.
   - Be precise: **as-code ≠ portable.** Perses, Grafana-as-code, and Terraform
     already do as-code; a dashboard bound to Everr's query semantics is only
     "portable to another Everr." Credible portability means **open formats**:
     **OTLP in/out**, **PromQL** / **Prometheus alerting rules**, **Perses**
     dashboards — formats another tool can actually read. Claim "portable" only
     where you can name such a format; otherwise say "as-code / versioned in your
     repo," which is a real (different) benefit.
4. **Business + technical data — show the join, don't assert it.** "Covers
   business and technical data" is a cliché every vendor with a dashboard makes;
   on its own it's worthless. The differentiator is the **join**: one store +
   shared OpenTelemetry context means a business event (signup, purchase) carries
   the same trace/resource attributes as the technical spans — so you can join
   revenue/conversion to the exact request, deploy, or agent run. Always lead
   with a concrete join example, never the bare claim.
5. **Simple on the surface, powerful underneath — and define the category.**
   "Made simple" breaks the moment we lead with jargon. Newcomers don't know what
   "observability" or "SLO" even mean. Define them in plain language on first use
   (observability ≈ "see what your software is actually doing, from the outside
   in"; SLO ≈ "the reliability target you promise — e.g. 99.9% of requests
   succeed"). **Do not prove "simple" with "plain SQL"** — SQL/PromQL is
   power-user depth, mentioned *after* the simple promise lands, not as the
   simplicity proof.
6. **Local-first is the on-ramp (one chapter).** Its job: let agents (and humans)
   instrument an app and verify both the instrumentation and the code they wrote
   — locally, before shipping to production. Verify-before-ship is the point; not
   the headline, never "only local."
7. **Pricing: open-source core + honest cost.** Open-source core, transparent
   pricing, and explicitly address **cost at scale** (the SRE rated this low —
   don't dodge it). Keep tiers consistent with reality.

### Global do / don't

- **Don't** make a maximal "replace Datadog/Grafana today" claim — and never
  place ambition next to hedges, "coming soon," or a waitlist.
- **Don't** frame AI as a vague "AI assistant" feature; frame **agents as
  consumers**. Keep AI out of the literal hero headline.
- **Don't** say "portable" without naming an open format (OTLP, PromQL, Perses…).
- **Don't** use adjectives where the buyer wants numbers — especially for
  production/SRE claims.
- **Don't** assert "business + technical" without a concrete join example.
- **Don't** lead with jargon; define observability/SLO in plain words once.
- **Don't** invent logos, customer quotes, or statistics.
- **Do** lead with simplicity + openness + consolidation, and **prove each with
  specifics**.

> ⚠️ Live-copy follow-ups (not yet done): `faq.tsx` ("Does Everr replace
> Datadog…? — Not yet, currently focused on local observability") and the
> waitlist-as-primary-CTA framing in `hero.tsx` / `final-cta.tsx` both predate
> this positioning. They need reconciling — affirm full-lifecycle without a
> maximal claim, and drop the pre-launch hedging — see §4 notes.

---

## 2. Market evidence (the "why" behind the sections)

- **CNCF observability microsurvey** — tool sprawl is the norm (72% use 1–9
  tools, 23% use 10–15). Top challenges: complexity, lack of documentation,
  lack of skills, lack of strategy.
- **Grafana 2026 (core)** — cost and ease of use are the top buying criteria;
  ~50% track business-related metrics; full-stack, SLOs, and business
  observability are rising.
- **Grafana 2026 (open source)** — 77% say open source/open standards matter
  (61% "very important/essential"); OSS is the #4 selection criterion (25%),
  interoperability #2 (26%); 58% select on ≥1 open-standards criterion;
  OpenTelemetry adopted to avoid lock-in (37%) and for ease of adoption (41%).
- **Grafana 2026 (AI)** — AI broadly valued _in-product_ (dashboards/queries
  92%, anomaly detection 92%, forecasting 91%, root cause 91%, onboarding 89%)
  but only 15% choose a tool _because_ of AI; 95% demand AI that explains its
  reasoning; trust drops for autonomous action (77%); biggest blocker is "too
  much manual input of context" (26%). → favors **agent-as-consumer**, not
  "AI assistant."

Sources:
- https://grafana.com/blog/observability-survey-AI-2026/
- https://grafana.com/blog/observability-survey-OSS-open-standards-2026/

---

## 3. Shared conventions (match these when implementing)

- Container: `mx-auto max-w-7xl px-6` with vertical rhythm `py-24 md:py-36`
  (or `py-20 md:py-24` for tighter sections).
- Color tokens: `fd-background`, `fd-foreground`, `fd-muted-foreground`,
  `fd-border`, `fd-card`, `primary` / `primary-foreground`. Surface tint:
  `bg-fd-muted/50`.
- Section eyebrow: `font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60`.
- Headings: `font-heading`, large responsive sizes (`text-4xl … md:text-6xl`).
- Scroll reveal: `motion` + `useInView(ref, { once: true, margin: "-15% 0px" })`,
  `transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}` (see `species.tsx`).
- Section dividers: `border-y-2 border-fd-border` between contrasting bands.
- Buttons: `@everr/ui/components/button` (`variant="cta" | "outline"`, `size="xl"`).

---

## 4. Sections, in page order

Status legend: ✅ implemented · 🟧 placeholder stub (in `placeholder-sections.tsx`).

### Hero — ✅ `hero.tsx`
Headline "Observability made simple. For Real." + subcopy + primary CTA, with the
animated `HoleBackground` and a tilted product screenshot (`/screenshot.png`).
Responsive: stacks on mobile, two-column tilt on `md+`.
**Scope:** lead with simplicity + openness + consolidation ("one system"). Never
lead with AI; agents-as-consumer is a co-thesis, not the headline. Define the
category in plain language (don't assume the reader knows "observability"). ⚠️ CTA
currently points at the waitlist — drop the pre-launch framing (→ "Get started" /
"Docs") per §1.

### Logo cloud / social proof — 🟧 `LogoCloud`
Adopter logos + an open-source proof signal (GitHub stars badge, "Open source"
pill) directly under the hero.
**Why:** social proof is table stakes; OSS is the #4 buying criterion (25%).
**Scope:** real adopters/logos only. No placeholder brands at launch.

### Species (value-prop statement) — ✅ `species.tsx`
Big typographic statement ("A new kind of observability. Built where the work
actually happens…").
**Scope:** the thesis line. Current copy reads pre-prod-leaning — it should land
**production** as part of "where the work happens" to match the one-system,
full-lifecycle positioning (§1, pillar 1).

### The problem: tool sprawl & complexity — 🟧 `ProblemToolSprawl`
Name the pain before the cure: too many disconnected tools, too much glue.
Lead stat: 72% use 1–9 tools, 23% use 10–15. Costs: complexity, skills gap, no
strategy. Contrast "wall of dashboards" vs. one unified pipeline (dev → agents →
CI → prod).
**Why:** CNCF — complexity is the #1 challenge, so the page leads with it. This
section also sets up the **consolidation** story (the credible version of
"replace the stack").

### Open by default (open standards, low lock-in) — 🟧 `OpenStandards`
Top-tier openness promise spanning the **whole product**, with **named formats**:
- **Telemetry:** OTel-native, **OTLP in/out**, **PromQL** / Prometheus
  compatibility, freedom to switch backends, self-host.
- **Dashboards, notebooks, alerts — and what's next:** open formats where they
  exist (**Perses** dashboards, **Prometheus alerting rules**); otherwise
  **as-code in your repo** (versioned, reviewable).
**Be precise:** claim "portable" only when naming an open format another tool can
read; as-code alone is "versioned & yours," not portability. Include the
ingestion grid (languages/frameworks/exporters; dev / agent / CI / prod paths)
and link to the repo.
**Why:** 77% value open standards; 58% select on them; 37% adopt OTel to avoid
lock-in. The expert's catch: vague "portable" claims get called out — name
formats or don't claim it.

### Video demo — ✅ `video-section.tsx`
Autoplaying (muted, looped, in-view) product video framed in an `aspect-video`
card. Source: `public/demo.mp4` (placeholder file — replace).
**Scope:** show the real product; keep it muted + `playsInline` for autoplay.

### Features / capabilities grid — 🟧 `Features`
3–6 outcome-framed cards: full-stack (logs, traces, metrics, errors in one
place), SLOs/alerting, the **business↔technical join**, complexity reduction.
**Use numbers for production claims** (cardinality, retention, SLO depth, alert
routing, HA) — not adjectives. Define "SLO" in plain words on first use. Link
each card to docs.
**Why:** full-stack + SLOs rising; ease of use is top; the SRE rates production
on specifics, not "first-class."
**Scope:** outcomes, not a spec sheet; honest maturity. There's no standalone
business-observability section anymore, so the **business↔technical join story**
(pillar 4) should live here as a concrete card — or be split into its own section
later.

### Agents as first-class consumers — 🟧 `AIAssistant`
(Reframed from "AI assistant.") Mid-page. The wedge: coding agents are now a
primary *consumer* of observability — Everr gives them one structured API + query
surface to pull ground truth (real error rates, latencies, the spans that
actually fired) instead of guessing. Assistive in-product uses (query/dashboard
generation, anomaly surfacing, root-cause) are supporting detail; keep reasoning
transparent (sources, query logic, confidence). Address the "manual context"
blocker (the agent already has your telemetry context). Assist, not autopilot.
**Why:** AI valued in-product but only 15% buy on it; 95% want explainability;
trust drops for autonomy (77%). Agent-as-consumer satisfies both the survey data
and the seniority split. **Never move this into the hero headline.**

### Tools explainer — ✅ `tools-explainer.tsx`
"Your tools. Your rules." — editor/agent-agnostic, orbiting tool icons.
"Everr doesn't replace your stack, it improves it."
**Scope:** keep the agnostic, non-prescriptive message. (Note the gentle tension
with the consolidation story — this is about *editors/agents*, not observability
vendors; keep that distinction clear.)

### Time to value / quick start — 🟧 `TimeToValue`
Fast path to first insight: one-command install (tabbed by runtime), "first
trace in N minutes" with a real number, sensible defaults / auto-instrumentation,
link to quickstart.
**Why:** counters the skills/complexity blockers; ease of use is a top criterion.
**Scope:** an install snippet here is fine as illustration; no waitlist hedging.

### How it works — ✅ `how-it-works.tsx`
"Your agent shouldn't have to guess." Reading the codebase tells half the story;
Everr captures what the code actually does at runtime, behind a query the agent
already knows. (A 3-step grid + SVG illustrations are commented out for later.)
**Scope:** this is the agent-as-consumer narrative in long form — keep it.

### Pricing / cost transparency — 🟧 `PricingTeaser`
Address the buying criterion head-on: open-source core, transparent pricing,
self-host vs. managed, and explicitly **cost at scale** (the SRE rated this low).
Keep consistent with the FAQ pricing answer.
**Why:** cost is a top buying criterion; OSS/self-host is a direct lever, but
vague "no surprise bills" isn't enough — show the model.
**Scope:** don't invent tiers/prices that don't exist — match reality.

### Testimonials — 🟧 `Testimonials`
2–4 quote cards (name, role, company, avatar) reinforcing complexity reduction,
consolidation, and time saved; optionally a standout metric.
**Why:** peer validation; quotes should echo the page thesis.
**Scope:** real, attributable quotes only. Leave the stub until they exist.

### FAQ — ✅ `faq.tsx`
Collapsible Q&A: replaces incumbents?, storage (local-first), instrumentation
(OTel), CI, how agents query, cost. Links to Discord.
**Scope:** ⚠️ the "Does Everr replace Datadog/Grafana/Honeycomb? — Not yet,
currently focused on local observability" answer contradicts §1. Rewrite to the
credible version: full-lifecycle / one-system / production in scope, *without* a
maximal "we replace Datadog today" claim — affirm the direction, be honest about
maturity. Keep the rest of the FAQ as the source of truth for honest answers.

### Community — ✅ `community.tsx`
Discord CTA band on `primary`. "Talk to the team. Shape what ships next."

### Final CTA — ✅ `final-cta.tsx`
"Stop guessing. Start observing." Primary + Documentation buttons. (Install
command box is commented out.)
**Scope:** ⚠️ currently waitlist-primary — drop the pre-launch framing per §1
(→ "Get started" / "Docs").

### Footer — ✅ `footer.tsx`
Site footer (nav, links). Update links as pages get added.

---

## 5. When you implement a section

1. Build a real component in its own `src/components/<name>.tsx`.
2. Swap the import + usage in `src/routes/index.tsx`.
3. Delete the corresponding stub from `placeholder-sections.tsx`.
4. Verify against the conventions in §3 and the pillars/guardrails in §1 —
   especially: numbers over adjectives, named formats over "portable," a join
   example over "business + technical," and no maximal claim beside a hedge.
5. Keep this file in sync — flip the status and trim notes that no longer apply.
