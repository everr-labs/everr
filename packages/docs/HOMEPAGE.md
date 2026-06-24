# Homepage section guide

Grounding doc for anyone (human or agent) filling in or implementing homepage
sections. **Read this before touching a section** and keep changes within the
scope described here. The goal is a coherent page, not a pile of independently
"optimized" blocks.

Page route: `src/routes/index.tsx` (controls section order).
Section components: `src/components/*.tsx`.
Placeholder stubs live in `src/components/placeholder-sections.tsx` — replace
each with a real component and delete its stub.

---

## 1. Product truth & guardrails (do not contradict)

Everr's positioning — keep all copy consistent with this:

- **Full-lifecycle observability.** One OpenTelemetry pipeline across the whole
  lifecycle: dev machines, AI coding agents, CI runs, **and production**. This
  is **not** a pre-prod-only / "upstream" tool — production is fully in scope.
  Don't use "pre-prod vs prod" as a framing axis.
- **We aim to replace the incumbents.** Everr is positioned to replace the
  Datadog / Grafana / Honeycomb-class stack across that lifecycle — same
  primitives, same data model, same answers everywhere. State this ambition;
  just keep specific feature claims honest about current maturity.
- **Open standards everywhere, low lock-in by design.** This goes far beyond
  telemetry. OpenTelemetry-native is the baseline (if your runtime speaks OTel,
  you're done), but the same principle applies to **dashboards, notebooks,
  alerts — and everything that comes next**: build on an open standard where one
  exists, and where it doesn't, minimize lock-in. The default escape hatch is
  **as-code** — dashboards, notebooks, alerts, etc. live in *your* codebase
  (versioned, portable, yours), so you're never trapped in a proprietary UI's
  database. Frame lock-in avoidance as a product-wide promise, not an
  ingestion-only feature.
- **AI-agent-native.** Agents query Everr via one structured API + plain SQL
  (Claude Code, Cursor, Codex, Copilot, …). Telemetry is the ground truth that
  stops agents from guessing. Agents are a prominent co-thesis, **not** the
  headline.
- **Local-first is one chapter, not the whole story.** It's a real
  differentiator, but it's a means to an end: it lets agents (and humans)
  **instrument an app and verify both the instrumentation and the code they
  wrote — locally, before shipping to production.** That verify-before-you-ship
  loop is the point; data staying on the device and the optional hosted/shared
  cluster are how it works. Never frame Everr as "only local" or position
  local-first as the headline — it's the on-ramp to the same observability that
  runs all the way through production.
- **Covers business AND technical data.** Lead with simple, frictionless
  observability spanning both; AI is the enabler.
- **Pricing:** open-source core, free for local use; paid for hosted clusters,
  scale/retention, premium support. Keep tiers consistent with reality.
- **Pre-launch:** the primary CTA is the **waitlist** (`/waitlist`); install
  commands are intentionally hidden until launch (see commented blocks in
  `final-cta.tsx`). Don't surface install snippets as the main CTA yet.

**Honesty vs. ambition:** state the full-lifecycle, replace-the-incumbents
vision confidently. Where a specific capability (e.g. a particular production
feature, SLO depth, tiered pricing) isn't fully shipped, describe it truthfully
— but **do not** disclaim production as out of scope. The vision is the frame;
maturity nuance lives in the details.

> ⚠️ `faq.tsx` currently answers "Does Everr replace Datadog/Grafana/Honeycomb?"
> with "Not yet… currently focused on local observability." That copy
> contradicts this positioning and should be revised — see the FAQ note in §4.

### Global do / don't

- **Don't** put AI in the hero or headline. Only ~15% pick a tool because of AI.
  AI is an _enabler_, shown mid-page, framed around transparency.
- **Don't** invent logos, customer quotes, or statistics. Use real,
  attributable assets only — or leave the stub until they exist.
- **Do** lead the page with complexity reduction, cost/ease, and openness.
- **Do** keep business + technical framing (Everr covers both), per the
  marketing thesis.
- **Do** reuse existing section conventions (see §3).

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
  much manual input of context" (26%).

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
Headline "Observability made simple. For Real." + subcopy + waitlist CTA, with
the animated `HoleBackground` and a tilted product screenshot (`/screenshot.png`).
Responsive: stacks on mobile, two-column tilt on `md+`.
**Scope:** lead with simplicity/openness — never AI. Keep the screenshot honest.

### Logo cloud / social proof — 🟧 `LogoCloud`
Adopter logos + an open-source proof signal (GitHub stars badge, "Open source"
pill) directly under the hero.
**Why:** social proof is table stakes; OSS is the #4 buying criterion (25%).
**Scope:** real adopters/logos only. No placeholder brands at launch.

### Species (value-prop statement) — ✅ `species.tsx`
Big typographic statement: "A new kind of observability. Built where the work
actually happens. Your laptop, CI, and the agents shipping alongside you."
**Scope:** this is the thesis line. The current copy reads pre-prod-leaning —
it should also land **production** as part of "where the work happens" so it
matches the full-lifecycle positioning (§1).

### The problem: tool sprawl & complexity — 🟧 `ProblemToolSprawl`
Name the pain before the cure: too many disconnected tools, too much glue.
Lead stat: 72% use 1–9 tools, 23% use 10–15. Costs: complexity, skills gap, no
strategy. Contrast "wall of dashboards" vs. one unified pipeline.
**Why:** CNCF — complexity is the #1 challenge, so the page leads with it.

### Open by default (open standards, low lock-in) — 🟧 `OpenStandards`
Top-tier openness promise spanning the **whole product**, not just ingestion:
- **Telemetry:** OTel-native, Prometheus-compatible, freedom to switch backends,
  self-host.
- **Dashboards, notebooks, alerts — and whatever comes next:** built on open
  standards where they exist; where they don't, lock-in is minimized via
  **as-code** — these artifacts live in *your* codebase (versioned, portable,
  reviewable), not locked inside a proprietary UI.
Include the ingestion grid (languages/frameworks/exporters; CI / agent / dev /
prod paths) and link to the repo. The headline is "your observability is yours —
your data, your dashboards, your alerts, all portable."
**Why:** 77% value open standards; 58% select on them; 37% adopt OTel to avoid
lock-in — and product-wide openness (not just telemetry) is core to Everr's
identity. Keep it high on the page.

### Video demo — ✅ `video-section.tsx`
Autoplaying (muted, looped, in-view) product video framed in an `aspect-video`
card. Source: `public/demo.mp4` (placeholder file — replace).
**Scope:** show the real product; keep it muted + `playsInline` for autoplay.

### Features / capabilities grid — 🟧 `Features`
3–6 outcome-framed cards: full-stack (logs, traces, metrics, errors in one
place), SLOs/alerting as first-class, complexity reduction, time to value.
Thread transparency/explainability through the cards. Link each to docs.
**Why:** full-stack + SLOs rising; ease of use is top; 95% want the "why".
**Scope:** outcomes, not a spec sheet. Cover the full lifecycle including
production (alerting, SLOs, retention all matter); keep maturity claims honest.

### AI assistant (enabler, not headline) — 🟧 `AIAssistant`
Mid-page. AI as a transparent assistant: query/dashboard generation, anomaly
detection, forecasting, root-cause, onboarding — reasoning always visible
(sources, query logic, confidence). Address the "manual context" blocker (AI
already has your telemetry context). Assist, not autopilot.
**Why:** AI valued in-product but only 15% buy on it; 95% want explainability;
trust drops for autonomy (77%). **Never move this into the hero.**

### Tools explainer — ✅ `tools-explainer.tsx`
"Your tools. Your rules." — editor/agent-agnostic, orbiting tool icons
(VS Code, Cursor, Zed, JetBrains, Claude Code, Codex, Copilot, …).
"Everr doesn't replace your stack, it improves it."
**Scope:** keep the agnostic, non-prescriptive message.

### Time to value / quick start — 🟧 `TimeToValue`
Fast path to first insight: one-command install (tabbed by runtime), "first
trace in N minutes" with a real number, sensible defaults / auto-instrumentation,
link to quickstart.
**Why:** counters the skills/complexity blockers; ease of use is a top criterion.
**Scope:** pre-launch the headline CTA stays the waitlist; an install snippet
here is fine as illustration but coordinate with launch state.

### How it works — ✅ `how-it-works.tsx`
"Your agent shouldn't have to guess." Reading the codebase tells half the story;
Everr captures what the code actually does at runtime, behind a query the agent
already knows. (Note: a 3-step grid + SVG illustrations are commented out for
later — see the file.)
**Scope:** keep the ground-truth-for-agents narrative.

### Pricing / cost transparency — 🟧 `PricingTeaser`
Address the #1 buying criterion: lead with "free & open-source / local forever",
self-host vs. managed, no surprise-bill anxiety, CTA. Keep consistent with the
FAQ pricing answer.
**Why:** cost is the top buying criterion; OSS/self-host is a direct lever.
**Scope:** don't invent tiers/prices that don't exist — match shipped pricing.

### Testimonials — 🟧 `Testimonials`
2–4 quote cards (name, role, company, avatar) reinforcing complexity reduction
and time saved; optionally a standout metric.
**Why:** peer validation; quotes should echo the page thesis.
**Scope:** real, attributable quotes only. Leave the stub until they exist.

### FAQ — ✅ `faq.tsx`
Collapsible Q&A covering: replaces incumbents?, storage (local-first),
instrumentation (OTel), CI, how agents query, cost. Links to Discord.
**Scope:** ⚠️ the "Does Everr replace Datadog/Grafana/Honeycomb? — Not yet…
currently focused on local observability" answer now **contradicts** the
full-lifecycle, replace-the-incumbents positioning in §1 and should be rewritten
to affirm production is in scope (with honest maturity nuance). Keep the rest of
the FAQ as the source of truth for honest answers.

### Community — ✅ `community.tsx`
Discord CTA band on a `primary` background. "Talk to the team. Shape what ships
next." Links to `DISCORD_URL`.

### Final CTA — ✅ `final-cta.tsx`
"Stop guessing. Start observing." Waitlist + Documentation buttons. (Install
command box is commented out until launch.)
**Scope:** keep waitlist primary pre-launch.

### Footer — ✅ `footer.tsx`
Site footer (nav, links). Update links as pages get added.

---

## 5. When you implement a section

1. Build a real component in its own `src/components/<name>.tsx`.
2. Swap the import + usage in `src/routes/index.tsx`.
3. Delete the corresponding stub from `placeholder-sections.tsx`.
4. Verify against the conventions in §3 and the guardrails in §1.
5. Keep this file in sync — flip the status and trim notes that no longer apply.
