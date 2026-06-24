# Homepage section guide

Grounding doc for anyone (human or agent) filling in or implementing homepage
sections. **Read this before touching a section** and keep changes within the
scope described here. The goal is a coherent, *convincing* page — not a pile of
independently "optimized" blocks, and not slogans a skeptical SRE bounces off.

Page route: `src/routes/index.tsx` (controls section order).
Section components: `src/components/*.tsx`.
Placeholder stubs live in `src/components/placeholder-sections.tsx` — replace
each with a real component and delete its stub.

---

## 1. Positioning (the spine — keep all copy consistent)

### Identity (does not change)
Brand voice leads with **"observability made simple"**; AI/agents are the
enabler. That stays. What changes per review: stop listing many pillars (a
backlog isn't positioning), lead with the one **un-cloned** story, and **prove**
every claim with a real number, a real architecture, and an honest portability
boundary.

> **Not on the page (deliberate):** business observability / the
> business↔technical "join" is **not shipped** and buyers are skeptical of it —
> keep it **off** the homepage entirely. Don't claim "business + technical data,"
> revenue-by-deploy joins, or business KPIs as a differentiator until it ships.

### One-liner
Simple, open observability across the whole lifecycle — built so your **coding
agents** can use it too.

> **Identity guard / open decision:** reviewers (4/5) pushed to make the agent
> wedge the *literal* H1. We keep "Observability made simple. For Real." as the
> H1 (identity) and elevate the agent wedge to the **lead pillar + hero subhead**
> — prominent, top-of-page, not buried mid-page. Going to a literal agent-first
> H1 is a deliberate identity change, not a default; raise it with Gio first.

### Lead with the wedge — demonstrably, in human words (before the pillars)

Reviewers were unanimous: open with the differentiator *shown*, not asserted, and
before any pillar list.
- **Make the agent wedge demonstrable in the hero:** a real **agent-query
  snippet** — the call an agent makes to Everr **and the JSON it gets back**. The
  developer wants to see the actual request/response, not a claim. Keep it
  human-readable (one short query → a compact JSON answer). Plain-language lead
  first, snippet as the proof. *(Note: this is the agent wedge made concrete —
  not the removed business "join".)*
- **Above-the-fold proof — this is what turns a CTO's "let's meet" into a POC:**
  - **One named design partner / reference: SkillVue**, with a **quote from their
    CTO.** We have the quote — fill in the exact words + the CTO's name. A real
    logo + attributed quote up top is the single biggest credibility lever here.
  - **A consolidation-TCO number:** e.g. "replaced N tools / cut observability
    spend ~X%." Must be real/sourced — never invent it.
  - Plus the production number from Pillar 2.

### Three pillars — everything else is *proof* under these

**Pillar 1 — Agent-native (the wedge). Lead with this.**
Your coding agents are now first-class *consumers* of observability. Everr gives
them one API + query surface to pull ground truth — real error rates, latencies,
the spans that actually fired — instead of guessing. It's the only story
competitors haven't cloned and the one newcomers connect with. Frame it as a
data/integration/category shift, **not** a chatbot "AI assistant" (that keeps the
"only 15% buy on AI" nuance honest: this is "your agents can finally see runtime
truth," not "we added AI features").

**Pillar 2 — One system, full lifecycle. SUBSTANTIATE it — this is load-bearing
and the least believed.**
Dev → agents → CI → production, one store, one query surface. Senior infra buyers
push hardest here, so back it with architecture, not adjectives:
- **Name the engine:** the telemetry store is **ClickHouse-backed** (that's what
  carries the high-cardinality / high-volume story). Say it.
- **Name the query surface:** what speaks **PromQL** (metrics) and what queries
  traces/logs — don't leave "one query surface" abstract.
- **Platform basics, stated:** a **multitenancy / RBAC / quota** line. Tenant
  isolation exists (row-level policies); surface the access/quota story too.
  Platform buyers fear *hidden* tradeoffs, not stated ones — don't ship "a
  single-team tool in a platform costume."
- **⚠️ One real production number above the fold (top priority).** Active-series
  ceiling, p99 at a stated cardinality, or a concrete cost-vs-Datadog scenario.
  ONE real figure outweighs the entire "no adjectives" pledge as a credibility
  signal. It **must be real and sourced — never invent it.**
- Dev/CI and prod telemetry have different design centers; say how one model
  serves both rather than hand-waving "same everywhere."

**Pillar 3 — Open & portable. One plain sentence; honest, per-signal scope.**
Lead in plain language: *"Your data stays in standard formats, so you're never
locked in."* Push the acronyms (OTLP, PromQL, Perses, Prometheus rules) behind a
"for the experts" disclosure — to a newcomer the acronym wall reads as the
opposite of simple.
- **Say which signals are portable — don't let the word float:** metrics +
  alerts + dashboards in open formats (PromQL / Prometheus alerting rules /
  Perses); traces + logs via **OTLP export**. Fully portable for the first set;
  raw-export only for the second. Note honestly: PromQL-compatible ingest ≠
  identical recording-rule / `histogram_quantile` / subquery semantics, and
  Perses ≠ Grafana's ecosystem — don't overstate.

### Supporting proof (sits *under* the pillars, never as a peer list)

- **Plain-language category, at every layer.** Define "observability" and "SLO"
  in plain words — then don't bury the reader in the *second* layer. "Spans,"
  "trace context," "cardinality," "resource attributes" each need a gloss or
  progressive disclosure. One layer explained isn't enough.
- **Local-first = verify-before-ship on-ramp.** Agents instrument an app and
  verify both the instrumentation and the code locally, before production. One
  chapter; never "only local."
- **Don't prove "simple" with "plain SQL."** SQL/PromQL is power-user depth,
  mentioned *after* the simple promise lands — not as the proof of simplicity.
- **Open-source core + honest cost,** including cost at scale.

### Global do / don't
- **Do** lead with the agent wedge; fold everything else into proof under the 3
  pillars. A long pillar list is a backlog, not positioning.
- **Do** put one real production number above the fold — and **never invent it.**
- **Do** name which signals are portable, name the storage engine, and include a
  multitenancy/RBAC line.
- **Do** define jargon at every layer, not just the first.
- **Do** keep the "simple" brand voice — identity stays.
- **Don't** make a maximal "replace Datadog today" claim — and never beside a
  hedge, "coming soon," or a waitlist.
- **Don't** frame AI as a vague "AI assistant" feature, or let "portable" float
  across all signals, or use adjectives where the buyer wants numbers.
- **Don't** invent logos, customer quotes, or statistics.

> ⚠️ Live-copy follow-ups (not yet done): `faq.tsx` ("Does Everr replace
> Datadog…? — Not yet…") and the waitlist-as-primary-CTA framing in `hero.tsx` /
> `final-cta.tsx` predate this positioning — reconcile per §4 notes.

---

## 2. Market evidence (the "why" behind the sections)

- **CNCF observability microsurvey** — tool sprawl is the norm (72% use 1–9
  tools, 23% use 10–15). Top challenges: complexity, lack of documentation,
  lack of skills, lack of strategy.
- **Grafana 2026 (core)** — cost and ease of use are the top buying criteria;
  full-stack observability and SLOs are rising. (Business observability is also
  rising in the survey, but it's **not shipped** for Everr — intentionally not a
  homepage angle; see §1.)
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
H1 "Observability made simple. For Real." (identity) + subcopy + primary CTA, with
the animated `HoleBackground` and a tilted product screenshot (`/screenshot.png`).
**Scope:**
- Subhead leads with the **agent wedge** (Pillar 1) in human words, made
  **demonstrable** with an **agent-query snippet** (the call + the JSON back) —
  prominent at the top, not mid-page.
- **Above the fold, add the proof that converts a meeting into a POC:** the
  **SkillVue** design-partner logo + **CTO quote** (fill in the real words), a
  **consolidation-TCO number** ("replaced N tools / ~X% spend cut"), and **one
  real production number** (active-series ceiling / p99 at cardinality /
  cost-vs-Datadog). All must be real; mark any placeholder clearly.
- Define the category in plain language; don't lead with AI-as-feature.
- ⚠️ CTA currently points at the waitlist — drop the pre-launch framing
  (→ "Get started" / "Docs").

### Logo cloud / social proof — 🟧 `LogoCloud`
Adopter logos + an open-source proof signal (GitHub stars badge, "Open source"
pill) directly under the hero. Anchor with the **SkillVue** design-partner logo.
**Why:** social proof is table stakes; OSS is the #4 buying criterion (25%).
**Scope:** real adopters/logos only (SkillVue is real). No placeholder brands.

### Species (value-prop statement) — ✅ `species.tsx`
Big typographic thesis line.
**Scope:** should land **production** as part of "where the work happens" to match
the one-system/full-lifecycle pillar; keep the agent wedge audible here too.

### The problem: tool sprawl & complexity — 🟧 `ProblemToolSprawl`
Name the pain before the cure. Lead stat: 72% use 1–9 tools, 23% use 10–15.
Contrast "wall of dashboards" vs. one unified pipeline (dev → agents → CI → prod).
**Why:** CNCF — complexity is the #1 challenge. Sets up the **consolidation**
story (the credible version of "replace the stack").

### Open by default (open standards, low lock-in) — 🟧 `OpenStandards`
**Lead with ONE plain sentence** — "your data stays in standard formats, so you're
never locked in" — and put the acronyms behind a "for experts" disclosure (it's
an acronym wall to newcomers otherwise).
- **Per-signal portability:** metrics + alerts + dashboards in open formats
  (PromQL / Prometheus rules / Perses); traces + logs via OTLP export. State which
  is fully portable vs. raw-export; don't overstate PromQL/Perses parity.
**Why:** 77% value open standards; vague "portable" gets called out by experts.

### Video demo — ✅ `video-section.tsx`
Autoplaying (muted, looped, in-view) product video in an `aspect-video` card.
Source: `public/demo.mp4` (placeholder — replace). Keep muted + `playsInline`.

### Features / capabilities grid — 🟧 `Features`
Outcome-framed cards — and the home for the **substantiation** that Pillar 2 needs:
- Full-stack (logs, traces, metrics, errors in one place).
- **Production with numbers, not adjectives:** cardinality, retention/downsampling,
  SLO depth (multi-window burn-rate), alert routing (dedup/escalation/on-call), HA.
- **Architecture line:** ClickHouse-backed store; query surface; a
  multitenancy/RBAC/quota mention.
- Define "SLO" in plain words; link each card to docs.
**Why:** the SRE rates production on specifics, not adjectives.
**Scope:** no business-observability / business-KPI cards — it isn't shipped (§1).

### Agents as first-class consumers — 🟧 `AIAssistant`
The wedge in long form (seeded in the hero, deep-dived here). Coding agents pull
ground truth via one API + query surface instead of guessing. Assistive in-product
uses (query/dashboard generation, anomaly surfacing, root-cause) are supporting
detail; keep reasoning transparent (sources, query logic, confidence); address the
"manual context" blocker; assist, not autopilot.
**Why:** only 15% buy on AI and 95% want explainability — agent-as-consumer (a
data/integration wedge) satisfies the survey data and the seniority split.

### Tools explainer — ✅ `tools-explainer.tsx`
"Your tools. Your rules." — editor/agent-agnostic. "Everr doesn't replace your
stack, it improves it."
**Scope:** keep agnostic; this is about *editors/agents*, not observability
vendors — keep that distinct from the consolidation story.

### Time to value / quick start — 🟧 `TimeToValue`
One-command install (tabbed by runtime), "first trace in N minutes" with a real
number, sensible defaults / auto-instrumentation, link to quickstart.
**Why:** counters skills/complexity blockers; ease of use is top.
**Scope:** install snippet fine as illustration; no waitlist hedging.

### How it works — ✅ `how-it-works.tsx`
"Your agent shouldn't have to guess." The agent-as-consumer narrative in long form
(a 3-step grid + SVGs are commented out for later). Keep it.

### Pricing / cost transparency — 🟧 `PricingTeaser`
Open-source core, transparent pricing, self-host vs. managed, and explicitly
**cost at scale** (the SRE rated this low — show the model, not "no surprise
bills"). Keep consistent with the FAQ pricing answer; don't invent tiers.

### Testimonials — 🟧 `Testimonials`
2–4 real, attributable quote cards reinforcing consolidation, simplicity, and time
saved. **Anchor with the SkillVue CTO quote** (we have it — fill in exact words +
name); the same quote also runs above the fold (see Hero). Leave the other slots
until real quotes exist.

### FAQ — ✅ `faq.tsx`
**Scope:** ⚠️ the "Does Everr replace Datadog…? — Not yet…" answer contradicts §1.
Rewrite to the credible version: full-lifecycle / one-system / production in scope,
*without* a maximal "replace Datadog today" claim. Keep the rest as the source of
truth for honest answers.

### Community — ✅ `community.tsx`
Discord CTA band on `primary`. "Talk to the team. Shape what ships next."

### Final CTA — ✅ `final-cta.tsx`
"Stop guessing. Start observing." Primary + Documentation buttons.
**Scope:** ⚠️ currently waitlist-primary — drop the pre-launch framing
(→ "Get started" / "Docs").

### Footer — ✅ `footer.tsx`
Site footer (nav, links). Update links as pages get added.

---

## 5. When you implement a section

1. Build a real component in its own `src/components/<name>.tsx`.
2. Swap the import + usage in `src/routes/index.tsx`.
3. Delete the corresponding stub from `placeholder-sections.tsx`.
4. Verify against §3 conventions and the §1 pillars — especially: lead with the
   agent wedge, one real production number above the fold, per-signal portability,
   architecture named (engine + multitenancy), jargon defined at every layer, no
   business-observability claims (not shipped), and no maximal claim beside a
   hedge.
5. Keep this file in sync — flip the status and trim notes that no longer apply.
