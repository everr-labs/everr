# Everr docs and landing site verification map

This directory is the maintained source for verifying the user-facing behavior of the Everr docs and landing site (`packages/docs`). Read the index before driving, then use the matching feature file as the recipe. `V` below is `.agents/skills/verify-docs/scripts/verify-docs.ts`.

## Baseline preconditions

- One isolated dev server per run, started with `$V launch` on a free loopback port. The port, the process group and the scratch dir are per run; the default port 3000 and any server you did not start are off limits.
- `$V doctor` ends with `DOCS DOCTOR OK` before any recipe.
- Analytics (PostHog and the Everr browser SDK) are pointed at the dead port `http://127.0.0.1:9` by `launch`. Browser recipes end with `$V net <label>`.
- There is no seed data: pages and content come from the checkout (`content/`, `messages/`). Recipes read expected titles and headings from there, so a content change can move an expectation.
- Browser recipes start with `eval "$($V browser-env)"` and `agent-browser set viewport 1280 800` in the shell that drives. Every command below that says `agent-browser` runs in that shell.
- Use `launch --prod` for claims about the built site; the recipes work in both modes unless they say otherwise.

## Driving conventions

- Run non-browser requests through `$V http <label> <path> [--accept ...] [--status N] [--contains TEXT]`. Labels name the evidence folder, so keep them unique within a run.
- Prefer ARIA roles and accessible names, then ids and route paths. When one accessible name occurs twice (header and footer), scope with a CSS selector.
- After every `agent-browser open`, run `agent-browser wait --fn "$HYDRATED"` (set by `browser-env`). The server HTML shows its text before React hydrates, and a click before hydration does nothing while still reporting `Done`.
- Wait for text, not time: `agent-browser wait --text "<text>"` or `wait --fn "<js>"`. Use `eval` for state (`aria-expanded`, `aria-current`, `location`) and read it twice, with a wait between, for anything that moves.
- Headless Chrome produces animation frames only on a screenshot or input. Anything drawn by `requestAnimationFrame` (the demo clocks) or removed by an exit animation (a closed dialog) updates after `agent-browser screenshot "$SHOTS/_frame.png"`. Never call `requestAnimationFrame` inside `agent-browser eval`: it hangs until the timeout.
- A route compiles on its first visit in dev, so a `wait` right after the first `open` of a page can time out at 30s. Repeat it with `--timeout 90000` before calling it a failure.
- Treat commands as literal. Keep quoting, especially JavaScript inside single quotes.
- The sign-up and booking links point at production hosts: assert their `href`, never follow them.

## Proof and skip reporting

- HTTP proof: `http/<label>/` with the command, status, headers, body and the `--status`/`--contains` verdicts.
- UI proof: `web/<label>.png` plus `web/<label>.txt` containing the asserted text (`ab_save <label> "<claim>"`), taken after `wait --text`.
- Network proof: `net/<label>.summary.txt` with `unexpected=0` and at least one `dead-sink` request.
- Record the feature ID (sub-feature IDs below) in each artifact label.
- Report an unreachable path with the attempted command and the unmet precondition. Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, then exactly four H2 sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-docs` (starts with `Preconditions:`, then labeled bullets pairing each action with an exact command and observable result), `Gotchas`.

## Features

- [Landing page](./landing.md): home render, header navigation, tour anchor, FAQ, "ask your AI" prompt, Italian version, external links, analytics audit.
- [Product demos](./product-demos.md): the two animated demos on the home page, their play, pause and chapter controls, autoplay.
- [Pricing](./pricing.md): plan cards, sign-up and booking links, pricing FAQ, the Italian page.
- [Docs pages](./docs-pages.md): docs home, sidebar, an MDX page with table of contents and next page, 404, devlog and site pages.
- [Docs search](./docs-search.md): the search dialog from the header and the keyboard, results, opening a result, the `/api/search` endpoint.
- [Markdown and machine-readable endpoints](./machine-endpoints.md): `Accept: text/markdown` negotiation, `.md` docs URLs, `llms.txt`, `sitemap.xml`, `robots.txt`, the CLI release redirect.

## Changed path -> features

Pick recipes from the paths a change touches (`git diff --name-only origin/main...`). Always run Launch and Doctor first.

| Changed path | Run |
| --- | --- |
| `packages/docs/src/components/{hero,site-header,faq,final-cta,ask-ai-*,footer,language-switch}.tsx`, `src/routes/index.tsx` | `landing.md` |
| `packages/docs/src/components/{demo-player,monitoring-*,agent-demo,alerts-demo,hero-watch}/**`, `monitoring-section.tsx`, `how-it-works.tsx` | `product-demos.md` (+ `landing.md`) |
| `packages/docs/src/components/pricing-cards.tsx`, `self-hosted-banner.tsx`, `src/routes/pricing.tsx` | `pricing.md` (+ `machine-endpoints.md` for the Markdown twin) |
| `packages/docs/content/docs/**`, `src/routes/docs/**`, `source.config.ts`, `src/lib/source.ts`, `src/lib/layout.shared.tsx` | `docs-pages.md` (+ `docs-search.md` when titles or headings change) |
| `packages/docs/content/devlog/**`, `content/pages/**`, `src/routes/devlog/**`, `src/routes/$page.tsx` | `docs-pages.md` (+ `machine-endpoints.md`) |
| `packages/docs/src/lib/{agent-response,negotiation,llms,markdown-pages,site-markdown,not-found-markdown,sitemap}.ts`, `server.ts`, `middleware/**`, `routes/**` (llms, sitemap), `vite.config.ts` | `machine-endpoints.md` in dev and with `launch --prod` |
| `packages/docs/src/routes/api/search.ts`, search components | `docs-search.md` |
| `packages/docs/messages/**`, `project.inlang/**`, `src/lib/translated.ts` | `landing.md` (Italian), `pricing.md` (Italian), `machine-endpoints.md` |
| `packages/docs/src/lib/{telemetry,posthog}.ts`, `src/env.ts`, `packages/otel-web/**` | `landing.md` (analytics audit) |
