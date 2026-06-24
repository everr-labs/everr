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
  - **Named design partner: SkillVue**, with a **quote from their CTO.** We have
    the quote — fill in the exact words + the CTO's name.
  - **A second proof leg (CTO: one partner reads as pre-traction):** OSS adoption
    — live **GitHub stars** / downloads / contributors. Two independent legs
    (a named partner *and* community traction) beat one.
  - **A consolidation-TCO before/after artifact, not just a number** — something a
    buyer can paste into a budget deck: *"6 tools → 1, ~X% cut — here's the math,"*
    with the line items. Must be real/sourced — never invent it.
  - Plus the production number from Pillar 2 (currently a blocker — see below).

### Three pillars — everything else is *proof* under these

**Pillar 1 — Agent-native (the wedge — the hook). Lead with this.**
Your coding agents become a first-class *consumer* of observability: one query
surface that returns ground truth — real error rates, latencies, the spans that
actually fired — so an agent stops guessing. It's the freshest, most resonant
story and what newcomers connect with, so lead with it. Frame it as a
data/integration shift, **not** a chatbot "AI assistant" (keeps the "only 15% buy
on AI" nuance honest: "your agents can finally see runtime truth," not "we added
AI features").
- **Anchor the causality correctly (Architect's catch — the moat is backwards as
  written).** The agent *endpoint* is **not** the moat — an MCP/query endpoint is
  a quarter of an incumbent's roadmap, easily cloned. The durable moat is the
  **unified, open store that humans, CI, and agents all query the same way**; the
  agent surface is the most differentiated *expression* of that store, not the
  source of defensibility. Lead with the agent hook, but make the unified store
  the thing that's hard to copy.

**Pillar 2 — One system, full lifecycle. SUBSTANTIATE it — load-bearing and the
least believed.**
Dev → agents → CI → production, one open store, one query surface. Senior infra
buyers push hardest here, so **demonstrate, don't assert**:
- **Show the tiering — don't hand-wave it (the #2 universal weak point).** Dev/CI
  and prod telemetry have opposite design centers; the page must *show* how one
  store serves both — the **retention / sampling / cardinality / downsampling
  knobs per tier**. "Different design centers, handled like this →" converts the
  biggest technical risk into a managed one. Asserting "one system" without the
  tiering reads as naïve to the people who'd operate it.
- **Engine is table stakes, not the differentiator.** Name it (ClickHouse-backed)
  *for the experts*, but don't sell it as the moat — SigNoz/Uptrace are
  ClickHouse-backed too. The differentiator is the unified store + one query
  surface across the lifecycle (Pillar 1's moat), not the DB brand.
- **Query surface:** what speaks **PromQL** (metrics) and what queries traces/logs.
- **Platform basics, stated:** **multitenancy / RBAC / quota** (tenant isolation
  via row-level policies exists; surface access/quota too). Platform buyers fear
  *hidden* tradeoffs, not stated ones — don't ship "a single-team tool in a
  platform costume."
- **For experts (progressive disclosure — give operators MORE, not less):** behind
  a disclosure, provide the depth the SRE/Architect want — a **PromQL-compatibility
  matrix**, **ClickHouse schema/partitioning** notes, a **cost-at-scale curve**.
  Don't force this on newcomers; don't withhold it from operators.
- **⚠️ One real production number above the fold — and it DOESN'T EXIST YET (TOP
  BLOCKER).** Until it's real (active-series ceiling / p99 at a stated cardinality
  / cost-vs-Datadog), Pillar 2 is a **promissory note, not evidence** — and it's
  the box that matters most. Get the number; never invent it. See "Proof blockers."

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
- **Contain the migration risk you just surfaced (SRE/Architect).** Honest caveats
  alone expose risk without managing it. Convert "hidden risk" → "documented
  boundary": ship a **PromQL/Perses compatibility matrix** and a brief
  **Perses-vs-Grafana migration note** (what transfers, what doesn't, the path).

### Supporting proof (sits *under* the pillars, never as a peer list)

- **Plain-language category, at every layer — make it a GUARANTEE, not a promise
  (three reviewers flagged it's still just a promise).** Define "observability"
  and "SLO" in plain words, then don't bury the reader in the *second* layer:
  "spans," "trace context," "cardinality," "resource attributes" each get an
  inline gloss or a tooltip/disclosure. Concretely: any term beyond a small base
  vocabulary MUST carry inline plain language or a glossary affordance — that's
  the mechanism the bottom half of the audience relies on.
- **Pillar 2's vocabulary gets the same "for experts" disclosure as Pillar 3.**
  "ClickHouse," "PromQL," "active-series ceiling," "RBAC" make newcomers feel the
  tool is for senior ops and undercut "simple." Plain surface up top; the operator
  depth behind a disclosure.
- **Insider words are INTERNAL doc vocabulary, never page copy.** "Wedge,"
  "agent-native," "first-class consumers" belong in this doc, not on the site —
  on the page say it in plain language ("your coding agents can query what your
  software actually did").
- **Local-first = verify-before-ship on-ramp.** Agents instrument an app and
  verify both the instrumentation and the code locally, before production. One
  chapter; never "only local."
- **Don't prove "simple" with "plain SQL."** SQL/PromQL is power-user depth,
  mentioned *after* the simple promise lands — not as the proof of simplicity.
- **Open-source core + honest cost,** including cost at scale.

### Proof blockers (the page currently describes proof; THESE are the proof — fill them)

The latest review scored the positioning ~6.7/10 with one root cause: *"a page
about having proof rather than the proof itself."* Closing these moves every
persona +1.5–2. Until each is real, mark it clearly as a gap — never fake it.
1. **Production number (TOP).** Active-series ceiling / p99 at a stated cardinality
   / cost-vs-Datadog. Without it, Pillar 2 is a promissory note. Source it.
2. **Tiering architecture artifact.** The retention/sampling/cardinality knobs per
   tier that show one store serves dev→CI→prod. Without it, "one system" is asserted.
3. **TCO before/after artifact.** "6 tools → 1, ~X% cut, here's the math."
4. **Second proof leg.** OSS adoption / GitHub stars alongside SkillVue.
5. **Compatibility matrix + Perses↔Grafana migration note.** Converts conceded
   caveats into a documented boundary.

### Kill all pre-launch signals (unanimous)

Waitlist CTAs and the FAQ "Does Everr replace Datadog? — Not yet" directly
contradict "production in scope" — a CTO files a waitlist under "revisit in 12
months" and a developer bounces. **Remove pre-launch framing from the page:**
CTA → "Get started" / "Docs"; rewrite the FAQ answer to the credible
full-lifecycle version (no maximal claim). Affected live copy: `hero.tsx`,
`final-cta.tsx`, `faq.tsx` (see §4).

### Global do / don't
- **Do** lead with the agent wedge (the hook), but anchor defensibility to the
  unified open store (the moat) — not the agent endpoint.
- **Do** fold everything else into proof under the 3 pillars. A long pillar list
  is a backlog, not positioning.
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
- **Contain the risk:** ship a PromQL/Perses **compatibility matrix** + a
  **Perses↔Grafana migration note** (documented boundary, not hidden risk).
**Why:** 77% value open standards; vague "portable" gets called out by experts.

### Video demo — ✅ `video-section.tsx`
Autoplaying (muted, looped, in-view) product video in an `aspect-video` card.
Source: `public/demo.mp4` (placeholder — replace). Keep muted + `playsInline`.

### Features / capabilities grid — 🟧 `Features`
Outcome-framed cards — and the home for the **substantiation** that Pillar 2 needs:
- Full-stack (logs, traces, metrics, errors in one place).
- **Production with numbers, not adjectives:** cardinality, retention/downsampling,
  SLO depth (multi-window burn-rate), alert routing (dedup/escalation/on-call), HA.
- **Show the tiering** (retention/sampling/cardinality knobs per tier) — this is
  how "one store serves dev→CI→prod" stops being an assertion.
- **Architecture line:** name ClickHouse-backed *for experts* (table stakes, not
  the differentiator); query surface; multitenancy/RBAC/quota. Operator depth
  (PromQL-compat matrix, schema/partitioning, cost-at-scale curve) behind a "for
  experts" disclosure.
- Define "SLO" in plain words; link each card to docs.
**Why:** the SRE rates production on specifics; ClickHouse alone isn't a moat.
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
