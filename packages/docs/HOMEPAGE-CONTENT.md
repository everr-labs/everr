# Homepage Content Spec — `@everr/docs`

Refresh of the public homepage (`src/routes/index.tsx`) for the **developer** audience (small teams with no SRE), per `../../PRODUCT.md`. Grounded in the product narrative: local-first feedback while you build, dashboards/runbooks as code, agents as a way to experiment with real telemetry, and production data as the basis for alerts that actually catch downtime.

**Identity preserved:** lime `#DEFF00` on near-black, Space Grotesk + Inter, the `EVERR_` voice. A content/emphasis refresh, not a redesign.

**Primary action:** copy + run the install command (now live). Documentation secondary, GitHub tertiary. Waitlist removed.

**Voice:** direct, builder-to-builder. No em-dashes in body copy (house style).

**Section order (as shipped):** Hero → How it works → See the real thing → Bring your own everything → FAQ → Community → Final CTA → Footer.

---

## 1 · Hero  — `hero.tsx`

**H1:** Observability is <span class="lime">damn hard</span>.

**Subtitle:**
> After experiencing it ourselves, many times, we decided to build something that makes doing observability **as easy as building a web app**.
>
> Write a dashboard like you write **HTML**, and runbooks the same way you write **docs**. Test everything **locally**, before going in production.

(Bold spans render as brighter `--foreground` inside the muted subtitle.)

**Install box (live, primary CTA):**
```
curl -fsSL https://everr.dev/install.sh | sh
```
Caption: `macOS & Linux`. Copy-to-clipboard with copied-state feedback (shared `InstallCommand` component).

**Buttons:** `Documentation` (outline) · `GitHub` (ghost).

---

## 2 · How it works  — `how-it-works.tsx`

**Headline:** Give Everr a try. You’ll love it.
**Lead:** Your observability setup should go through the same loop as your code: run it, inspect it, fix it, repeat.

Numbered loop (01–04), each with a real artifact where it helps:

1. **Setup OpenTelemetry** — Tell your agent to use the Everr skill and instrument the app properly, with the right spans, logs, and metrics for your stack.
   *Artifact:* agent prompt `> /everr-setup-telemetry`
2. **Run locally** — Generate real traffic on your machine and make sure the traces, logs, metrics, and errors land where you expect, before any of it ships.
3. **Interrogate it** — Query Everr yourself using SQL, or have your agent investigate what's slow, noisy, or missing.
   *Artifact:* `$ everr cloud query "SELECT trace.name, duration_ms FROM traces ORDER BY duration_ms DESC LIMIT 10"`
4. **Ship what works** — Turn the useful signals into dashboards, runbooks, and alerts. Keep only the monitoring that earns its place.

*(No closing line; the section ends on step 04. Numbered rail with a connecting line conveys the loop.)*

---

## 3 · See the real thing  — `product-showcase.tsx`

Real product screenshots, **no section header**: the screenshots speak for themselves. Each beat is a title plus caption beside a framed shot, alternating sides, scroll-revealed (reduced-motion safe).

**Beat 1 — Dashboards <span class="lime">as-code</span>** *(pays off "write a dashboard like you write HTML")*
- **Image:** `/home/dashboard.png` (Node.js Runtime dashboard: event-loop delay, V8 heap by space, GC pause, worker jobs).
- **Caption:** We use Perses, an open standard to write dashboards. Your LLM already knows it, the same way it knows HTML.

**Beat 2 — Runbooks are just <span class="lime">markdown</span>** *(pays off "runbooks the same way you write docs")* · reversed layout
- **Image:** `/home/runbook.png` (Resource pressure runbook: prose plus live Node CPU and memory panels inline).
- **Caption:** Explain what to check, then put the live panel beside it. The answer sits where the question is.

**Beat 3 — Test it <span class="lime">locally</span>** *(pays off "test everything locally, before going in production")*
- **Image:** `/home/native-app.png` (native app Traces view, a five-minute trace flagged before it shipped).
- **Caption:** Our desktop app has a built-in OpenTelemetry collector. Use it to validate the telemetry you have just added, or to debug what's happening in your app. Traces work way better than console.log.

**Beat 4 — Versioned in <span class="lime">git</span>** *(everything-as-code, reviewed in the repo)* · reversed layout
- **Image:** `/home/as-code.png` (an Everr notebook defined as a YAML file in the editor, with ClickHouse SQL queries, tracked in git).
- **Caption:** Your observability lives in the repo: review it, edit it, and hand it to agents like any other part of the codebase.

**Treatment:** each shot framed (2px `--border` + shadow + faint lime halo on desktop) so the dark product UI separates from the page. Lazy-loaded with intrinsic dimensions (no CLS). WebP export is still a build follow-up.

---

## 4 · Built on standards, no lock-in  — `tools-explainer.tsx`

Centered headline + body, then three standards pillars (icon, title, blurb). No orbital visual.

**Headline:** Built on standards, <span class="lime">no lock-in</span>

**Body:** Standards make the whole system easier to work with. Everr builds on the ones you and your agents already know, so nothing here is yours to be trapped in.

**Pillars:**
1. **OpenTelemetry** — the standard already supports the languages and frameworks you run. No proprietary agent, no rewrite.
2. **SQL** — query all your telemetry with plain SQL. Agents already speak it, and it's expressive enough for real telemetry work.
3. **Perses & Markdown** — dashboards are Perses, runbooks are Markdown. Plain files your LLM already understands

---

## 5 · FAQ  — `faq.tsx`

Six collapsible questions; left column kicker + "Ask us on Discord" link, right column accordions. Answers should stay short enough for homepage scanning, but specific enough to answer the objection.

1. **Does Everr replace Datadog / Grafana / Honeycomb?**
   Yes! Those tools are built for platform and SRE teams. Everr is built for people like us that have to move fast and don't have the time to learn a new complicated tool.
2. **Where is my telemetry stored?**
   Local telemetry stays on your machine. The desktop app and local collector are designed for that fast feedback loop. Production and shared team telemetry goes to Everr Cloud, backed by ClickHouse, so you can query it with the same SQL shape without running storage yourself.
3. **Do I have to instrument my code?**
   Yes, because useful observability needs real spans, logs, metrics, and errors from your app. We make that setup small: Everr is OpenTelemetry-native, the SDKs already exist for your stack, and the Everr agent skill can wire the right instrumentation into your codebase.
4. **Does it work in CI?**
   Yes. Install the Everr GitHub App, run Everr in your workflows, and CI becomes another telemetry source instead of a black box. You can inspect slow jobs, flaky tests, failing steps, and resource usage with the same SQL and dashboards you use locally.
5. **How do AI agents query Everr?**
   With SQL through the CLI. Agents are good at SQL, and SQL is very expressive for real telemetry work: filtering traces, grouping logs, comparing runs, spotting regressions, and drafting dashboards from the same data you see.
6. **What does it cost?**
   Local telemetry is free. Everr Cloud has a generous free plan for hosted and shared telemetry, then usage-based billing as you grow. You pay for cloud storage, retention, and usage, not for validating telemetry on your own machine.

---

## 6 · Community  — `community.tsx`

Unchanged. Lime-drenched section, oversized Discord mark, "Talk to the team. Shape what ships next." → Join on Discord.

---

## 7 · Final CTA  — `final-cta.tsx`

**Headline:** <span>Everr</span>y second counts
**CTA:** install box **primary**, `Documentation` + `GitHub` secondary. Caption `Try it yourself · macOS & Linux`. Waitlist removed.

---

## 8 · Footer  — `footer.tsx`

**Tagline:** Software delivery intelligence for developers and AI agents.

---

## Asset checklist
Real assets in `packages/docs/public/home/` (served from `/home/...`):
- [x] `dashboard.png` — Node.js Runtime dashboard (§3 beat 1).
- [x] `runbook.png` — Resource pressure runbook (§3 beat 2).
- [x] `native-app.png` — native app Traces view, five-minute trace flagged (§3 beat 3).
- [x] `as-code.png` — notebook YAML in the editor, under git (§3 beat 4).
- [ ] *(build task)* export WebP versions; verify legibility / crops at mobile widths.

## Open follow-ups
1. **Footer tagline** — currently the deck line; "Observability made simple." (the app's own tagline) is the stronger alternative if you want simpler.
2. **`how-it-works.tsx` container** lost its `px-6` in a manual edit, so its content can run flush to the viewport edge on narrow screens. Re-add `px-6` unless intentional.

## Scope
Production-ready · whole surface · existing component skeleton + TanStack Start · copy + emphasis + live install box. Verified: `tsc`, Biome, and production build all pass; deterministic design scan clean.
