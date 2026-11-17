---
name: verify-docs
description: Drive the Everr docs and landing site (`packages/docs`, public pages plus the documentation website) the way a visitor does, on a throwaway loopback server with analytics pointed at a dead port, and capture proof. Use when a change touches `packages/docs` (landing components, pricing, demos, MDX under `content/`, routes, Markdown negotiation, `llms.txt`, sitemap, search, paraglide messages) or the `@everr/otel-web` browser SDK as the docs site loads it, or when you must prove the home page, a docs page, docs search, the product demos or the Markdown endpoints actually work.
user-invocable: true
metadata:
  internal: true
---

# Verify the Everr docs and landing site

`packages/docs` (`@everr/docs`) is one TanStack Start + fumadocs + Nitro app. It serves the landing pages (home with its two animated product demos, pricing, about, contact, each also in Italian), the documentation site (MDX under `content/docs`, sidebar, table of contents, search), the devlog, and machine-readable variants of the same pages (Markdown through `Accept: text/markdown` or a `.md` suffix, `llms.txt`, `sitemap.xml`). Everything runs offline except one request the page itself makes (see "Network").

Other surfaces have their own skills: the `everr` CLI and local stack in [verify-cli](../verify-cli/SKILL.md), App and Cloud in [verify-web-app](../verify-web-app/SKILL.md), the collector distributions in [verify-collector](../verify-collector/SKILL.md). Runs of different skills can coexist.

Not covered: the Vercel or Docker deploy (`Dockerfile`, `TRUST_PROXY`), the PostHog and Everr ingest backends (the run sends nothing to them), the `/everr-app/*` redirect target (a 307 to a release bucket, checked only up to the `Location` header), and the Open Graph image routes under `/api/og` (not driven). The pricing page has no calculator: it is static plan cards.

Everything goes through one helper: `.agents/skills/verify-docs/scripts/verify-docs.ts` (below: `V`), TypeScript that Node >= 24 runs directly (no build step or separate dependency install). Run it from anywhere; it resolves the repo from its own path.

```bash
V="$(git rev-parse --show-toplevel)/.agents/skills/verify-docs/scripts/verify-docs.ts"
```

## Launch

Prerequisites: Node 24 and `pnpm install` done at the repo root (the helper needs `packages/docs/node_modules/.bin/vp`), `lsof` (macOS) or `ss` (Linux), and the [`agent-browser`](https://www.npmjs.com/package/agent-browser) CLI for every rendered step (`npm install -g agent-browser && agent-browser install`; `doctor` checks it). Tested with 0.34.0.

```bash
$V launch            # dev server (the primary target); or: $V launch <RUN_ID>
$V launch --prod     # production build, then node .output/server/index.mjs
```

The dev launch is the repo's own `vp dev`, the same server as `pnpm dev:docs`, with three differences. It binds `127.0.0.1` only. It takes a free port per run (never the default 3000, which may be your own dev server) with `--strictPort`. And it gets three environment variables:

- `VITE_POSTHOG_PROJECT_TOKEN=phc_verify_disabled`. The app refuses to start without a token (`src/env.ts`), so a fake one is set.
- `VITE_POSTHOG_HOST=http://127.0.0.1:9` and `VITE_EVERR_INGEST_ENDPOINT=http://127.0.0.1:9`. Port 9 (discard) has no listener, so a request fails at once and leaves the machine. Without the second variable a dev build sends the browser SDK's log and trace records to `127.0.0.1:54418`, which may be a real Everr instance. `VITE_EVERR_PUBLIC_INGEST_KEY` is forced empty.

The helper starts the server in its own process group (`vp dev` forks the vite process that owns the port), records the pid, and waits until `GET /` returns 200 with the home page title and `GET /docs/learn/install` returns 200 with `Installation`. A listening port alone is not ready: the dev server compiles each route on its first request. Output:

```
first render: / 4.8s, /docs/learn/install 0.0s; later routes compile on first visit
DOCS READY run=<RUN_ID> origin=http://127.0.0.1:<port>
```

Measured on macOS arm64 with a warm Vite cache: ready in 5 to 7s. Server-rendered routes after that answer in under 0.2s; the first browser visit loads client modules on demand (a few seconds at most, then fast). The helper allows 120s per probe.

`--prod` runs `vp build` first (about 5s here; the baked-in `VITE_*` values are the same dead-port ones, set before the build), then serves `.output/server/index.mjs` on the free port. It overwrites `packages/docs/.output` (gitignored). Use it for what only a built server does: `server.ts` Markdown negotiation as shipped, and no dev-only overlays. The dev server implements the `.md` URLs through a Vite middleware (`docsMarkdownDevRequests` in `vite.config.ts`), the build through `middleware/docs-markdown.ts`, so a change to either deserves a run in both modes.

Isolation: the port, the process group and the scratch and evidence directories are per run. The helper refuses a second `launch` in the same checkout while a run is live (`.verify-everr/current-docs`), because two dev servers would share `packages/docs/node_modules/.vite` and the generated `.source` and `src/paraglide` files. Never point the helper at a server it did not start.

Teardown is `$V cleanup` (see Cleanup).

## Doctor

Read-only. Run first, and whenever anything looks off:

```bash
$V doctor
```

Checks: the recorded process is still the group leader running our command, the port is held only by that process group, `GET /` is 200 with the home title, `GET /docs/learn/install` renders, `GET /docs.md` is Markdown, the run's analytics sinks are still the dead port, `agent-browser` is on PATH, and (dev) the server log has no server-side errors (`Internal server error`, pre-transform or SSR errors; the browser's forwarded PostHog `Failed to fetch` is expected). Ends with `DOCS DOCTOR OK` or `DOCS DOCTOR FAILED`. On failure read `docs.log` in the scratch dir (`/tmp/verify-everr/docs-<RUN_ID>/`) before `$V cleanup`, which copies it into the evidence.

## Drive

Pick the feature file from [`features/README.md`](features/README.md) and follow it. Primitives:

- Non-browser endpoints, with evidence recorded and expectations checked:

  ```bash
  $V http <label> <path> [--accept <type>] [--head] [--status <n>] [--contains <text>]...
  # e.g. $V http pricing-md /pricing --accept text/markdown --status 200 --contains "# Pricing that grows with you"
  ```

  Sends the request without following redirects, prints status, `content-type`, `vary`, `location`, and the first 12 lines of the body, records `http/<label>/{command.txt,status,headers,body,verdict.txt}`, and exits 1 when `--status` or any `--contains` fails. Node's `fetch` sends `Accept: */*` unless `--accept` is given.
- Rendered pages: `agent-browser` (see "Browser" below) at `$DOCS` from `eval "$($V browser-env)"`.
- Network audit of the browser session (see "Network"): `$V net [label]`.

### Browser

Every rendered step uses the `agent-browser` CLI directly, in the run's own session:

```bash
eval "$($V browser-env)"       # AGENT_BROWSER_SESSION=verify-everr-docs-<RUN_ID>, DOCS=<origin>, SHOTS=<evidence>/web, HYDRATED, ab_save
agent-browser set viewport 1280 800
```

Run the `eval` in the shell you drive from. With `AGENT_BROWSER_SESSION` set, every `agent-browser` command targets this run's browser, never another agent's, until cleanup closes the session. `AGENT_BROWSER_DEFAULT_TIMEOUT` is 30000 ms: pass `--timeout 90000` to a `wait` that follows a first visit. The commands the recipes use:

- `agent-browser open <url>`: navigate. Exits 1 with `Navigation failed: net::ERR_...` when the origin is down. It returns when the server HTML has loaded, before React hydrates: follow it with `agent-browser wait --fn "$HYDRATED"` (true once hydrated, measured at under 1s after the HTML on the dev server), or the next click does nothing and still prints `Done`.
- `agent-browser wait --text "<text>" [--timeout <ms>]`, `wait --fn "location.pathname === '/pricing'"`: exit 1 on timeout. Always wait for the text you expect before capturing. `wait --text` matches rendered text, so a heading split over lines needs a prefix: the home headline `Know before your customers do` is two block spans, wait for `Know before`.
- `agent-browser find role <role> click --name "<accessible name>"` (substring match; when a name appears in both header and footer, such as `Language: English`, it reported `Done` but opened no menu in 0.34.0, so scope with a CSS selector such as `header#nd-nav button[aria-label^='Language']`), `click "<css>"`, `fill "<css>" "<value>"`, `press <key>`. `fill` with an empty string does not reach React state: `fill "x"` then `press Backspace` instead.
- `agent-browser snapshot -i`: interactive elements with `@eN` refs, to find a handle when a recipe's selector no longer matches.
- `agent-browser eval '<js>'`: evaluate in the page and print the result. Prefer it for state assertions (`aria-expanded`, `aria-current`, `location`).
- `agent-browser network requests [--clear]`: requests since the last `--clear`, one per line.
- `agent-browser --json errors`: page errors with their text. In 0.34.0 the call works but errors accumulate across navigations, so compare counts before and after an action instead of asserting emptiness.
- Evidence: `ab_save <label> ["<caption>"]` (defined by the `eval`) saves `$SHOTS/<label>.png`, `.url`, `.txt` (`get text body`) and, with a second argument, `.caption`. Labels are flat (`docs-search-02-results`): `screenshot` does not create directories. Assert on the `.txt`, not on the screenshot.
- The TanStack devtools button (a round icon at the bottom right) exists only in dev. It can sit over a screenshot's corner and shows as `Open TanStack Devtools` in snapshots. Use `launch --prod` when a claim is about the page's own corner.

Stable handles (from source): route paths `/`, `/pricing`, `/about`, `/contact`, `/devlog`, `/devlog/<slug>`, `/docs`, `/docs/<section>/<page>` (sections `learn`, `concepts`, `guides`, `reference`), Italian `/it`, `/it/prezzi`, `/it/chi-siamo`, `/it/contatti`; machine endpoints `/llms.txt`, `/sitemap.xml`, `/robots.txt`, `/api/search?query=<text>`, `/docs.md`, `/docs/<page>.md`, `/everr-app/<artifact>`. Header: `navigation` named `Main` with links `Docs`, `Pricing`, `Devlog`, `Everr home`, button `Search the docs`, link `Everr on GitHub`, button `Language: English` (translated pages only), link `Get started`. Search is a `dialog` named `Search` with a `textbox` named `Search`. Demo players: buttons `Pause demo` or `Play demo` and `Play: <chapter label>`. FAQ rows are `button`s with `aria-expanded`. Docs sidebar groups are buttons (`Getting started`, `Concepts`, `Guides`, `Reference`) and pages are links.

### Network

The page makes requests besides its own origin: PostHog (`VITE_POSTHOG_HOST`), the browser SDK's OTLP export (`/v1/logs`, `/v1/traces` on `VITE_EVERR_INGEST_ENDPOINT`), and one real call, `https://api.github.com/repos/everr-labs/everr` for the star count in the header. That last one is a public read-only GET, not analytics, and the helper cannot turn it off; it is the only request allowed to leave the machine.

```bash
$V net <label>       # after the page has been idle for about 10s
```

Classifies every request in the session as `app` (this run's origin), `dead-sink` (`http://127.0.0.1:9`), `github-stars` (the URL above) or `unexpected`, writes `net/<label>.{requests,summary}.txt`, and exits 1 if anything is `unexpected` or if a line of the request log does not parse (a changed `agent-browser` output format must not read as "no requests"). A pass needs `dead-sink` greater than zero: that shows the SDKs are live and aimed at the dead port (measured on the home page: PostHog `config.js`, `config` and `flags`, plus OTLP `OPTIONS` and `POST` to `/v1/logs` and `/v1/traces` within about 8s of load). On a `launch --prod` server only the PostHog requests reached the dead sink within 12s (no OTLP `POST`s; measured), which still shows the sink is wired. Zero dead-sink requests prints a NOTE and proves nothing yet. Run it at the end of every browser feature, before cleanup.

## Evidence

Location: `$REPO/.verify-everr/artifacts/docs-<RUN_ID>/` (gitignored, outside the scratch dir, so cleanup never deletes it). Layout:

- `run.txt` (run id, mode, origin, command, server pid, git HEAD and branch, launch time), `run.env`
- `web/<label>.{png,txt,url,caption}` saved with `agent-browser` (see Browser)
- `http/<label>/{command.txt,status,headers,body,verdict.txt}` per `$V http` call
- `net/<label>.{requests,summary}.txt` from `$V net`
- `docs.log` (dev server or Node server output) and `build.log` (`--prod`), copied at cleanup; `cleanup.stop.txt`

Proof standards:

- Exercise the real user path: click the link, type in the search box, open the URL. Do not call route loaders, server functions (`/_serverFn/*`) or paraglide internals directly.
- Capture the action and the resulting state: the step that was taken and a second view of its outcome (a `.txt` with the expected text, the URL after navigation, a reload that shows the same state, or the Markdown twin of the page).
- A UI claim needs a screenshot taken after the asserted text rendered (`wait --text`, then `ab_save <label> "<claim>"`), at the 1280x800 viewport. `ab_save` sleeps 0.7s before the screenshot: right after a client-side navigation the DOM updates before the compositor paints. Open each image (Read the PNG) and confirm it shows what its caption claims before reporting.
- A claim about motion or timing (a demo advancing, a menu opening) needs state read twice with a wait between, for example the demo clock from `eval` at two moments; a still shows one instant.
- A layout claim carries a measured value in the caption (`getBoundingClientRect()`, `getComputedStyle()` through `agent-browser eval`).
- Dev-only vs shipped: a claim about the built site (`vp build` output) needs a `launch --prod` run.
- No mocks: the site is fully local. The no-analytics claim rests on `$V net`, never on the variable names.

## Cleanup

```bash
$V cleanup
```

Stops the recorded process group (SIGTERM, then SIGKILL after 10s) if the recorded pid is still the group leader running our command, or if that leader has exited and members of its group survive (a pid is not reused while its group has members). A reused pid or a server someone else started is never touched. It closes this run's `agent-browser` session, copies the logs into the evidence dir, deletes `/tmp/verify-everr/docs-<RUN_ID>/` and `.verify-everr/current-docs`, then lists the evidence that survived. If the port is still held after that, by a process outside the group, it leaves that process alone, exits 1 and keeps the scratch dir. Run it after every attempt, including failed ones. Never kill by process name or by port alone: other agents and you run their own dev servers, including `vp dev` for this package.

## Helpers

- `scripts/verify-docs.ts` (executable TypeScript entry, run by Node). Subcommands: `launch [--prod] [RUN_ID]`, `doctor`, `env`, `http <label> <path> [flags]`, `net [label]`, `browser-env`, `cleanup`. Run it with no args for usage. Env knobs: `EVERR_VERIFY_SCRATCH` (scratch root, default `/tmp/verify-everr`) and `RUN_ID` to target a run other than the current one.
- `../verify-shared/common.ts`: paths, run-id validation, scratch-root containment, ports, process helpers, browser session helpers. Shared with the other `verify-*` skills, so a change there needs a run of each.
- `scripts/package.json`: only `"type": "module"`, so Node loads the `.ts` files as ES modules without a warning.

Maintain the feature map with `/maintain-verification-skill` when routes, components or content change.
