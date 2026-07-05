# Product

## Register

product

## Users

Developers and the AI coding agents working alongside them, plus the teams that
run their software in CI and production. They show up mid-task — a test just
failed, a span went missing, a workflow is flaky, a regression landed — and they
need the runtime answer fast, without leaving the flow they're in. They are
fluent in their tools (editors, terminals, SQL) and impatient with anything that
makes them click through chrome to reach a fact. Context spans three places that
are usually siloed: their laptop, CI, and production.

## Product Purpose

Everr is software delivery intelligence: one OpenTelemetry pipeline that exposes
the same signals — logs, traces, metrics, errors, CI runs — across dev machines,
AI agents, CI, and production, behind a read-only SQL surface and a focused web
app. The app is where humans see what agents query: dashboards, a logs/traces
explorer, error and run analysis, cost breakdowns, and Clickety-Clack alerting
(alerts, silences, rules, receivers, routes, inhibitions, events). Success is a
user (or their agent) getting from "something's wrong" to the specific runtime
fact in seconds, with no dashboard-spelunking and no per-question custom
endpoint. Prod is in scope, not a separate tier — same primitives, same data,
same answers everywhere.

## Brand Personality

Energetic, opinionated, developer-native. The voice is sharp and anti-hype — it
says what most "AI observability" actually is (legacy tooling with a chatbot
slapped on) and refuses to play along. Terminal-native and a little playful,
speaking dev-to-dev, never enterprise-committee. Confident enough to be dense
where density serves the expert, never padded with marketing softness. The tool
should feel like it was built by people who are annoyed at their current tools.

## Anti-references

- **Legacy enterprise observability** (Datadog / Splunk / New Relic): walls of
  dashboards, cramped chrome, a thousand knobs, data you can look at but never
  query. The whole reason Everr exists is to not be this.
- **Generic shadcn SaaS template**: default card-grid-of-everything,
  rounded-everything, gradient-accented starter look that reads as boilerplate.
  Everr uses shadcn primitives but must not look like an untouched preset.
- **Consumer-y / over-animated**: bouncy or elastic motion, decorative
  gradients, marketing flourishes leaking into the actual tool. Motion conveys
  state, not personality, inside the app.
- **AI-gimmick wrapper**: a chatbot bolted onto old tooling, sparkles-everywhere
  "AI" badging. The AI story is about agents querying real data over SQL — never
  a mascot.

## Design Principles

- **The fact, not the dashboard.** Every screen earns its place by getting the
  user to a specific runtime answer faster than spelunking would. If a view only
  exists to be looked at, it's wrong.
- **Practice what we preach.** Everr is an observability tool; the app itself
  should feel fast, legible under load, and instrumented-grade precise. Sloppy
  states betray the pitch.
- **Density is a feature, for experts.** Tables with many rows, panels with many
  labels, dense signal — embraced when the user needs it, never dumbed down. But
  density must stay legible, never cramped-enterprise.
- **Earned familiarity, sharpened.** Use standard, trustworthy affordances
  (nav, tables, command palette, status badges) so the tool disappears into the
  task — then sharpen them past the default-preset look with deliberate
  type, color, and rhythm.
- **Same data, everywhere.** Local, CI, and production are one continuum, not
  three products. The UI should reinforce that unity, not silo it.

## Accessibility & Inclusion

No formal standard is mandated. Best-effort baseline: maintain readable contrast
on text and data (the dark theme's muted-foreground is the usual risk — keep
body/labels legible, not light-gray-for-elegance), keep full keyboard
navigation working, and honor `prefers-reduced-motion`. Because alert and run
status carry meaning, prefer pairing color with an icon, shape, or label rather
than relying on red/green alone.
