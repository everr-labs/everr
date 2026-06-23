# Product

> Scope: the **public landing page / marketing site** (`packages/docs` — the `@everr/docs` homepage and surrounding brand pages). This file governs the brand surface, not the in-app product UI. The product app lives in `packages/app`.

## Register

brand

## Users

Pragmatic application developers on **small teams that can't afford a dedicated SRE or observability team**. They build and ship their own product, and when something breaks in CI or production, they're the ones debugging it — at 11pm, with no platform team to lean on.

Their context when they land here: they've felt the pain (a prod incident with no signal, a slow endpoint they can't explain, a user error they don't know how to fix) and they're scanning for a way out that doesn't mean standing up Datadog, learning Grafana, or hiring someone to run it. They evaluate fast and bounce the moment setup looks like a project. The job they're doing on this page is *decide in under a minute whether EVERR solves my problem and whether I can try it right now.*

## Product Purpose

EVERR is **the observability app for developers**. Local feedback (a native app surfaces your own telemetry as you work), everything-as-code (configure in git, query in SQL), built on open standards (OpenTelemetry), and the same loop for you and your coding agents — wherever your code runs: locally, in CI, inside remote sandboxes.

The landing page exists to convert an under-resourced developer from *"I have an observability problem"* to *"I'm trying EVERR right now."* Success = the page makes two things undeniable: **(1) EVERR fixes the problems this developer actually faces** (concrete capabilities, real product, not a thesis), and **(2) trying it takes about one minute** (zero-friction, install-and-go). The primary action is *try it / install*, not "request a demo" and not "read the vision." Keep just enough "why now" to give the page a spine — no more.

## Brand Personality

**Bold, technical, confident.** Builder-credible, opinionated, sharp. The visual identity is already committed and should be preserved: signature lime (`#DEFF00`) on pure black, the `EVERR_` terminal cursor, Space Grotesk display + Inter body, highlighted key phrases. The voice is direct and declarative, names incumbents (Datadog, Grafana) without flinching, and lets typography and a single saturated accent carry the design. Confident, not loud; technical, not dense. To a developer it should read as *made by people who ship*, never as marketing.

The tone should be direct. Like me talking directly to the user

## Anti-references

- **The abstract vision page.** No thesis-slide cadence, no market-size framing, no "the shift is happening" grand-narrative as the lede. This page sells a tool, not a story.
- **Enterprise-observability heaviness.** Datadog/Grafana's dashboard-maze, sales-gated, "talk to us" energy. The whole point is that you *don't* need that.
- **"AI integration" theater.** Legacy tooling with a ChatGPT wrapper bolted on. EVERR's agent story is real plumbing, not a chatbot in the corner.
- **Generic AI-generated dev-tool landing pages.** Identical icon-card grids, gradient text, monospace-as-costume, the hero-metric template, eyebrow kickers above every section. If it could be any YC dev-tool homepage, it's failed.

## Design Principles

1. **Show the product, don't pitch it.** Real UI, real SQL, real config, real terminal output. A developer trusts a screenshot and a code block over an adjective. Demonstrate the fix; don't assert it.
2. **One minute to value, and the page proves it.** The install/try path is never more than a glance away, and the page itself feels as zero-friction as the product claims to be — fast, unfussy, no gates. Practice what you preach.
3. **Speak to the team with no SRE.** Every claim answers "does this save me from standing up an observability platform myself?" Frame capabilities as problems-solved for someone who has to do it all.
4. **One accent, used with conviction.** Lime marks the single thing that matters in each section — never decoration. Black + white/grey type + lime is the whole system.
5. **Earn technical trust through specificity.** OpenTelemetry-native, open standards, query in real SQL, no black boxes, no lock-in. Credibility comes from concrete detail, not from saying "powerful" or "enterprise-grade."

## Accessibility & Inclusion

- Target **WCAG AA**: body text ≥4.5:1, large/display text ≥3:1. The contrast risk is muted grey body copy on black or on tinted-near-black surfaces — keep meaningful copy at the bright ink end, not the `--muted` grey.
- Lime-on-black and white-on-black are the safe pairs. Never set grey type on the lime band; use near-black ink there.
- Don't rely on color alone to convey meaning (e.g. lime "good" vs grey "bad" in diagrams/charts) — back it with labels or shape.
- Entrance choreography is welcome (brand permission), but every animation needs a `prefers-reduced-motion: reduce` alternative, and content must be visible by default — never gated behind a scroll/class-triggered reveal.
