# Agent-consumable Recordings

**Date:** 2026-10-17
**Question:** An Agent cannot watch a video replay. What representations of a session Recording let an Agent reason about what the person did and saw? What does each cost in tokens per minute, and which ones also feed later Playwright e2e test generation?

## Answer

Use the shape of the Playwright trace CLI. Give the Agent a cheap **text timeline** first, then let it ask for an **accessibility snapshot at a chosen moment** (and a diff between two moments). Keep **screenshots** as an on-demand fallback for visual questions. Do not hand out raw rrweb JSON or a pre-written LLM summary as the main interface.

| Representation | Tokens per minute of Recording | Tells the Agent | Feeds Playwright e2e generation |
| --- | --- | --- | --- |
| Raw rrweb JSON | ~270,000 (measured) | everything, unreadably | no |
| Text timeline (navigations, clicks, inputs, errors, failed requests, trace ids) | ~300 to 2,000 (measured and estimated) | what the person did, and what broke | step order only; it needs role and name on each target |
| Accessibility snapshot at time T | 40 to 23,000 **per snapshot** (measured), paid only when asked | what was on screen, structurally | **yes**: role and name give `getByRole` locators, and the snapshot gives `toMatchAriaSnapshot` assertions |
| Accessibility diff between T1 and T2 | ~50 to 500 per action (estimated from measurement) | what changed because of an action | **yes**: the source for assertions |
| Screenshot at key moments | ~1,200 to 1,560 per frame (Claude standard tier), 3 to 6 frames a minute gives ~4,000 to 9,000 | how it looked: layout, overlap, visual bugs | no |
| Video to a multimodal model (PostHog Replay Vision) | ~6,000 (Gemini low resolution) to ~18,000 (high) | hesitation, confusion, visual cues | no; Claude does not accept video |
| Pre-written LLM summary (Sentry, legacy PostHog) | ~100 to 300 to read, plus a server-side LLM call | a narrative | no; the evidence is gone |

The rest of this note gives the evidence for each row.

## Prior art

### Sentry: a text log of breadcrumbs, built server-side, then summarised by Seer

Sentry's replay AI summary does **not** look at the DOM or at video. `rpc_get_replay_summary_logs` downloads the replay segments, joins errors from the same trace ids, and turns each event into one English line ([summarize.py](https://github.com/getsentry/sentry/blob/master/src/sentry/replays/usecases/summarize.py)):

```
User clicked on {target} at {timestamp}
User rage clicked on {target} but the triggered action was slow to complete at {timestamp}
User navigated to: {to} at {timestamp}
Logged: '{message}' at {timestamp}            (truncated to 200 chars)
Fetch request "GET host/path?q" failed with 500 (1234 bytes) at {timestamp}
User experienced an error: '{title}: {message}' at {timestamp}
User submitted feedback: '{message}' at {timestamp}
```

Details that matter for Everr:

- `EventType.MUTATIONS`, `CANVAS`, `SLOW_CLICK`, `UI_FOCUS`, `CLS`, image and script resources all map to `None`. Successful (2xx) requests are skipped. The log is mostly user actions plus failures.
- Errors are found by **trace id**, not only by direct link: `fetch_trace_connected_errors(trace_ids=...)`. They are merged into the timeline by timestamp.
- Input is capped at `MAX_SEGMENTS_TO_SUMMARIZE = 150` ([project_replay_summary.py](https://github.com/getsentry/sentry/blob/master/src/sentry/replays/endpoints/project_replay_summary.py)).
- The output is `{summary, time_ranges: [{period_start, period_end, period_title}]}` ([ai/utils.tsx](https://github.com/getsentry/sentry/blob/master/static/app/views/explore/replays/detail/ai/utils.tsx)). The docs call these "chapters": "Each chapter summarizes related sets of breadcrumbs, network requests, and console logs, ordered by time range" ([Replay Details](https://docs.sentry.io/product/explore/session-replay/replay-details/)). Shipped to early adopters on 2025-08-05 ([changelog](https://sentry.io/changelog/replay-ai-summaries--now-available-for-early-adopters/)).

Sentry's Agent surface is the `sentry` CLI, not MCP. `sentry replay list` and `sentry replay view` return metadata, `activity`, `clicks`, `trace_ids`, `relatedTraces` and `relatedIssues`. `sentry replay download` writes raw rrweb JSON ([CLI replay reference](https://github.com/getsentry/sentry-mcp/blob/main/packages/cli/plugins/sentry-cli/skills/sentry-cli/references/replay.md), [formatters/replay.ts](https://github.com/getsentry/sentry-mcp/blob/main/packages/cli/src/lib/formatters/replay.ts)). The MCP server has no replay tool. There is no snapshot-at-time command.

### PostHog: from an event table to video plus event lookups

PostHog tried both approaches. The history is the most useful signal in this survey.

1. **Legacy session summaries (removed 2026-08-13).** The input was a table of the session's analytics events. To save tokens, URLs and window ids were replaced by short aliases, and event UUIDs by short ids: "6 tokens vs 52 tokens per event" ([prompt_data.py at d58675c4f](https://github.com/PostHog/posthog/blob/d58675c4f/ee/hogai/session_summaries/session/prompt_data.py)). A second pass already used video: it sent clips around the flagged events to a model and updated the summary from those "visual observations" ([validation-prompt.djt](https://github.com/PostHog/posthog/blob/d58675c4f/ee/hogai/session_summaries/session/templates/video-validation/validation-prompt.djt)). The feature, its Max tool, and **5 MCP tools** were deleted because "Replay Vision summarizer scanners replaced session summarization" ([PR #80312](https://github.com/PostHog/posthog/pull/80312)).
2. **Replay Vision (current).** The workflow will "rasterize the recording to video, upload to Gemini, multi-turn scan" ([README](https://github.com/PostHog/posthog/blob/master/products/replay_vision/README.md)). The video runs at "about 3 frames per second", inactive time is cut, and a footer on each frame shows `REC_T`, `WINDOW`, `URL` and `STATUS` so the model can cite moments. After it watches, the model gets **one lookup round**: it names stretches of video and receives the events and the failed or slow requests in them ([preamble.jinja](https://github.com/PostHog/posthog/blob/master/products/replay_vision/backend/temporal/scanners/prompts/preamble.jinja)). The lookup is a bisect over a time index, ±60 s at most, with at most 50 events nearest the moment ([events_tool.py](https://github.com/PostHog/posthog/blob/master/products/replay_vision/backend/temporal/events_tool.py)). The price is 2 to 15 credits ($0.02 to $0.15) per scanned session, depending on the Gemini model ([billing.py](https://github.com/PostHog/posthog/blob/master/products/replay_vision/backend/billing.py)).

PostHog's prompt lists the ways a **reconstructed** page lies. These apply to any rrweb-based representation, including Everr's:

> "The replay rebuilds each page from DOM snapshots, so validation or error text hidden in the page's HTML can render visible, layouts can look broken while the user saw a normal page, and hover-only UI may not replay. Before treating an on-screen error as something the user experienced, corroborate it: an input, click, or submit around that moment ... or a failed request or an exception event."

The prompt adds that canvas, cross-origin iframes and video are "often not recorded at all", and that masked text shows as `*`. It also ranks events above pixels: "what the events record at a moment outranks how the video looks".

### Playwright: the trace CLI is the closest shape to what Everr needs

A Playwright trace keeps three DOM snapshots per action: **before**, **action** ("at the moment of the performed input") and **after**. It also keeps a screencast, network and console ([Trace viewer](https://playwright.dev/docs/trace-viewer)). Playwright now ships an Agent-facing CLI over trace files ([playwright-trace SKILL.md](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/skills/playwright-trace/SKILL.md); latest release v1.64.1, 2026-10-14):

```bash
npx playwright trace open trace.zip           # metadata: browser, viewport, duration, counts
npx playwright trace actions [--grep click] [--errors-only]
npx playwright trace action <id>              # params, logs, source, available snapshot phases
npx playwright trace requests [--failed] [--method POST]
npx playwright trace console [--errors-only]
npx playwright trace errors
npx playwright trace snapshot <id> [--phase before]          # accessibility snapshot by default
npx playwright trace snapshot <id> -- eval "document.querySelector('#error').textContent"
npx playwright trace snapshot <id> -- screenshot
```

"Without a browser command, it returns the accessibility snapshot." The flow is: list cheaply, drill into one action, and get the page state only for that action. That is the flow this note recommends.

**ARIA snapshots** are YAML: `- role "name" [attribute=value]`, nested by indentation ([ARIA snapshots](https://playwright.dev/docs/aria-snapshots)). `locator.ariaSnapshot({ mode: "ai" })` (v1.59+) adds `[ref=eN]` refs and includes iframes, and `boxes: true` (v1.60+) adds `[box=x,y,w,h]` ([Locator API](https://playwright.dev/docs/api/class-locator#locator-aria-snapshot)). The same YAML is the input to `expect(...).toMatchAriaSnapshot()`, with partial matching and regex. So one representation serves both reading and asserting.

**Playwright MCP** describes itself as "bypassing the need for screenshots or visually-tuned models". It has a `browser_find` tool that searches the snapshot "which is cheaper than capturing the whole snapshot", a locator generator tool, and `--codegen typescript`, which returns Playwright code for each action. The README also says: "CLI invocations are more token-efficient: they avoid loading large tool schemas and verbose accessibility trees into the model context" ([playwright-mcp README](https://github.com/microsoft/playwright-mcp/blob/main/README.md)).

**Playwright Test Agents**: the planner writes a Markdown plan in `specs/`, the generator turns it into tests and "verifies selectors and assertions live", and the healer fixes failing tests ([Test agents](https://playwright.dev/docs/test-agents)). A Recording-derived timeline could take the place of the planner's exploration.

### agent-browser and browser-use: compact trees, refs, and change markers

- **agent-browser** (v0.34.0, checked locally): "Accessibility-tree snapshots with compact `@eN` refs let agents interact with pages in ~200-400 tokens instead of parsing raw HTML." `snapshot -i` gives interactive elements only, `-c` is compact, `-d` caps depth and `-s` scopes to a selector. `diff snapshot` compares the current snapshot with the last one or a baseline. `screenshot --annotate` labels elements `[N]` to match refs, for multimodal models.
- **browser-use** serialises the DOM as `[index]<tag attr=value />`, with only interactive and visible elements indexed. It uses paint order and bounding boxes, so it needs live layout. "Elements tagged with a star `*[` are the new interactive elements that appeared on the website since the last step" ([system_prompt.md](https://github.com/browser-use/browser-use/blob/main/browser_use/agent/system_prompts/system_prompt.md), [serializer.py](https://github.com/browser-use/browser-use/blob/main/browser_use/dom/serializer/serializer.py)). That is a diff carried inside the snapshot.

### rrweb itself

- The rrweb roadmap lists a "Token efficient AI session replay format (in progress)" with no public design ([README](https://github.com/rrweb-io/rrweb/blob/master/README.md)). I found no open-source rrweb-to-text or DOM-diff summariser worth adopting. rrweb.com's glossary says pipelines "reduce first, extracting a structured digest", and that "semantically identified elements (the checkout button, not node 4127)" matter ([glossary](https://rrweb.com/glossary/session-summarization)).
- `replayer.pause(5000)` freezes the replay at a time offset ([guide](https://github.com/rrweb-io/rrweb/blob/master/guide.md)). This is the snapshot-at-time primitive. `rrdom-nodejs` replays in Node, but it has no layout and no accessibility computation, so an ARIA snapshot needs a real headless browser.
- `rrvideo` renders rrweb JSON to `.webm` with a headless browser ([rrvideo](https://github.com/rrweb-io/rrweb/tree/master/packages/rrvideo)), the same path as PostHog's rasterizer.
- Recorder options that change Agent quality: `userTriggeredOnInput` marks inputs the user made (it is off by default; see the noise in the measurement below). `maskAllInputs` masks values. `inlineStylesheet` defaults to true and inflates full snapshots ([guide](https://github.com/rrweb-io/rrweb/blob/master/guide.md)).

### Chrome DevTools Recorder

Recorder steps (`navigate`, `click`, `change`, `keyDown`, `waitForElement`, ...) carry a list of selectors. ARIA comes first, then test attributes, ids, CSS, XPath, pierce and text. Steps export to `@puppeteer/replay` JSON ([Recorder reference](https://developer.chrome.com/docs/devtools/recorder/reference)). This is prior art for a replayable step format that keeps several selector candidates for each step.

## Measurements

The method: rrweb `1.1.3` record build, injected with agent-browser into real pages, a scripted visit, then sizes at ~4 characters per token. Scripts and raw output were kept in the session scratchpad and are not committed. Scripted sessions have almost no mouse movement, so human sessions will be larger.

**Raw rrweb, Playwright docs page, 35 s, scrolling and one SPA navigation:** 49 events, 637 KB JSON, **~159,000 tokens** (~270,000 a minute). The full snapshot was 410 KB (the page HTML is 90 KB; inlined CSS accounts for most of the difference). Mutations from the one SPA navigation were 225 KB.

**Raw rrweb, TodoMVC, 12 s, 5 todos typed, 1 toggle, 3 filter clicks:** 79 events, 33 KB, ~8,200 tokens.

**Naive text timeline from the same streams** (my script: navigate, click, input, scroll bursts, labels from snapshot node text):
- Docs page: 12 lines, ~75 tokens. The SPA navigation produced **no** rrweb Meta event, so the timeline missed it. A navigation signal must come from the SDK (Everr's `everr.browser.page_view` already provides one).
- TodoMVC: 37 lines, ~360 tokens. Most lines were noise. rrweb emitted `Input` events for checkboxes that re-rendered, not only for the person's input. With `userTriggeredOnInput` and deduplication, it falls to about 12 lines (~100 tokens).

**Accessibility snapshot of one page state** (agent-browser; `-i -c` is interactive and compact):

| Page | HTML | Full a11y snapshot | Interactive only |
| --- | --- | --- | --- |
| TodoMVC, empty | 1 KB | 447 B (~110 tok) | 175 B (~45 tok) |
| TodoMVC, 5 todos | | 1.6 KB (~410 tok) | |
| Hacker News front page | 34 KB | 27 KB (~6,800 tok) | 13 KB (~3,300 tok) |
| Playwright docs page | 90 KB | 25 KB (~6,300 tok) | 8 KB (~2,000 tok) |
| Wikipedia article | 522 KB | 92 KB (~23,000 tok) | 17 KB (~4,300 tok) |

A diff from TodoMVC empty to 5 todos is about 1.2 KB (~300 tokens) for five list items. Diffs for single actions should usually be in the tens to low hundreds of tokens.

**Screenshots** (Anthropic docs: cost is `ceil(w/28) x ceil(h/28)` visual tokens): 1280x720 is 1,196 tokens. 1920x1080 is 1,560 tokens on the standard tier (after downscaling) or 2,691 on the high-resolution tier ([Vision](https://platform.claude.com/docs/en/build-with-claude/vision)). **Video** (Gemini): frames sampled at 1 fps, about 100 tokens a second at low media resolution or about 300 at high ([Video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)).

## Options in detail

### 1. Text timeline with trace ids (do this first)

What it is: one line per meaningful event, ordered by time, from the start of the Recording. Example:

```
t+00.0  page_view  /checkout            pv=3
t+04.2  click      button "Pay now"     [selector #pay > button]
t+04.3  request    POST /api/charge     500  812ms  trace=T1
t+04.4  exception  TypeError: cannot read 'id' of undefined   trace=T1
t+06.9  rage_click button "Pay now"
t+11.0  page_leave /checkout            dwell=11s
traces: T1=4bf92f3577b34da6a3ce929d0e0e4736
```

- **Most of this already exists in Everr's telemetry.** `@everr/otel-web` emits `everr.browser.page_view`, `page_leave`, `interaction.click`, `interaction.submit`, `exception`, `slow_interaction` spans and fetch/XHR CLIENT spans that carry `TraceId`. All of them carry `session.id` and `everr.page_view.id` ([browser-events.md](../skills/everr-use-telemetry/rules/browser-events.md)). The timeline can be a query over `logs` and `traces` filtered by `session.id`. The rrweb stream adds only what the SDK does not capture: inputs (masked), scrolls, and a readable name for each target.
- **Follow Sentry's filtering**: drop mutations, successful requests and resource loads. **Follow PostHog's compression**: replace repeated URLs and 32-hex trace ids with short aliases, and print a legend once.
- **Gap:** the SDK target is `everr.element.selector`, a CSS path, and "the SDK never captures element text or input values". An Agent reads `button "Pay now"` much better than `#pay > button`, and Playwright ranks CSS last. The accessible name can be found after the fact from the rrweb snapshot (see option 2), so the SDK does not have to change.
- Cost: ~300 to 2,000 tokens a minute for an active session. A 30-minute Recording fits easily in context.

### 2. Accessibility snapshot at a chosen moment (the main drill-down)

What it is: load the rrweb Recording in headless Chromium, `replayer.pause(t)`, then run `ariaSnapshot({ mode: "ai" })` on the replay iframe. Return Playwright ARIA YAML, optionally only interactive elements, scoped, or depth-limited.

- It answers "what did the person see when X happened", in text, at 40 to 23,000 tokens per call. It costs nothing until asked for.
- Phases, as in Playwright traces: `before`, `action` and `after` a timeline event. Each timeline event gets an id, so `snapshot <event-id> --phase after` makes sense.
- **Caveats** (PostHog's list): a reconstructed DOM can show hidden error text, lose hover state, and leave canvas, iframes and video blank. A snapshot only respects CSS visibility if the stylesheets were captured. Masked text appears as `*`. Every snapshot should say what it cannot show.
- It needs a rendering worker (Chromium plus the rrweb replayer) on the server side or in the CLI. `rrdom-nodejs` cannot compute roles or names.

### 3. Accessibility diff between two moments

What it is: compare two snapshots. Return added, removed and changed nodes (as in agent-browser `diff snapshot`), or mark new nodes inline (as browser-use's `*[`).

- It answers "what did the click do": a dialog opened, an error message appeared, a list grew. About 50 to 500 tokens per action.
- It is the source for test assertions: what appears after an action becomes `toBeVisible()` or a partial `toMatchAriaSnapshot()`.
- A cheap form: precompute a diff for each click and submit, keep only the nodes that changed, and attach the result to the timeline line as "effects". This is optional, because it costs two renders for each event.

### 4. Screenshots at key moments (fallback, on demand)

- Use it for questions a tree cannot answer: overlap, layout shift, contrast, "the button was off screen". About 1,200 to 1,560 tokens a frame at standard resolution.
- Render it from the same paused replayer as option 2 (Playwright's trace CLI does the same with `snapshot <id> -- screenshot`). Add PostHog's footer idea (time, URL, tab) so the Agent can tie the frame to the timeline.
- Do not push frames automatically. PostHog's prompt says events outrank pixels, and Claude-based Agents cannot take video.

### 5. Video to a multimodal model, and pre-written summaries (not recommended as the Agent surface)

- PostHog's move to video shows that visual cues (hesitation, confusion) matter for **product analytics** at scale. Everr's Agents are coding agents that debug and write tests. They need evidence they can query, not a narrative. Video needs a Gemini-class model on Everr's side, so Everr would pay for inference that the person's own Agent cannot check.
- A summary (Sentry's chapters) is useful for **humans** in the UI. For Agents, it is at most a table of contents: `time_ranges` with titles that point into the timeline.

## Proposed tool shapes

The CLI is the main surface. Playwright MCP's README says CLI plus skills is more token-efficient for coding agents. The MCP surface mirrors the CLI. Names are illustrative.

```bash
everr recordings list [--user <id>] [--route /checkout] [--has-error] [--since 24h]
everr recordings events <recording> [--kinds click,request,exception] [--errors-only] [--around <t> --window 30s]
everr recordings event <recording> <event-id>          # full detail: element, request, linked trace ids, snapshot phases
everr recordings snapshot <recording> --at <t|event-id> [--phase before|action|after] [--interactive] [--scope <selector>] [--find "Pay now"]
everr recordings diff <recording> --from <t|event-id> --to <t|event-id>
everr recordings screenshot <recording> --at <t|event-id> [--out file.png]
```

| MCP tool | Returns | Notes |
| --- | --- | --- |
| `list_recordings` | id, duration, page count, error count, rage clicks, trace ids | matches `sentry replay list` fields |
| `get_recording_events` | timeline text with aliases and a legend | filters by kind, time window and errors only, as in `trace actions` |
| `get_recording_snapshot` | ARIA YAML at a moment or event phase, with a limitations header | `find` mode to save tokens, as in `browser_find` |
| `diff_recording_snapshots` | added, removed and changed nodes | |
| `get_recording_screenshot` | one image | on demand only |

Since the MCP server already exposes read-only SQL, `list` and `events` could start as documented queries in the `everr-use-telemetry` skill. Only `snapshot`, `diff` and `screenshot` need new server code (the renderer).

## Path to e2e tests from Recordings

What Playwright needs for each step, and where it comes from:

| Need | Source |
| --- | --- |
| Step sequence (goto, click, fill, press, select) | text timeline |
| Locator: `getByRole(role, { name })` first, CSS last ([Locators](https://playwright.dev/docs/locators)) | accessibility snapshot at the `action` phase; refs map the clicked rrweb node to role and name. Keep `everr.element.selector` as a fallback, as Chrome Recorder does |
| Input values | **not available**: rrweb masks them and the SDK does not capture them. The generator must write fixtures or placeholders. This is a gap by design, not a bug |
| Assertions | the diff between `before` and `after`, written as `toBeVisible()`, `toHaveText()` or partial `toMatchAriaSnapshot()` |
| Network failures to reproduce | failed request lines with trace ids, which give the backend spans for mocks or `page.route` |

The steps: the timeline becomes a Markdown plan in the Playwright Test Agents `specs/` format. The generator agent then turns that plan into a spec and verifies locators live against a running app. Snapshots and diffs make that plan precise. Screenshots and summaries add nothing to this path.

## Open questions

1. **Where the renderer runs.** Running it on the server keeps Recordings private and gives one implementation. Running it in the CLI lets local dev Recordings work offline. Playwright's trace CLI runs locally.
2. **Accessible names and privacy.** Resolving `button "Pay now"` from a snapshot puts page text into Agent output. Masked text stays masked, but unmasked text that names a person (for example `link "Jane Doe"`) gets through. PostHog's prompt has a whole section that tells the model not to repeat personal data. Everr needs a rule here.
3. **Joining rrweb with OTel.** The join is `session.id` plus the browser timestamp, since both come from the same clock. Should the SDK also write rrweb custom events that carry `everr.page_view.id`, or a span id for each click, so that the join is exact? Any new attribute goes under `everr.*`.
4. **Glossary.** "Recording" is not in `CONTEXT.md` yet.

## Sources

- Sentry: [summarize.py](https://github.com/getsentry/sentry/blob/master/src/sentry/replays/usecases/summarize.py), [project_replay_summary.py](https://github.com/getsentry/sentry/blob/master/src/sentry/replays/endpoints/project_replay_summary.py), [ai/utils.tsx](https://github.com/getsentry/sentry/blob/master/static/app/views/explore/replays/detail/ai/utils.tsx), [Replay Details docs](https://docs.sentry.io/product/explore/session-replay/replay-details/), [AI summaries changelog](https://sentry.io/changelog/replay-ai-summaries--now-available-for-early-adopters/), [sentry CLI replay reference](https://github.com/getsentry/sentry-mcp/blob/main/packages/cli/plugins/sentry-cli/skills/sentry-cli/references/replay.md)
- PostHog: [Replay Vision README](https://github.com/PostHog/posthog/blob/master/products/replay_vision/README.md), [preamble.jinja](https://github.com/PostHog/posthog/blob/master/products/replay_vision/backend/temporal/scanners/prompts/preamble.jinja), [events_tool.py](https://github.com/PostHog/posthog/blob/master/products/replay_vision/backend/temporal/events_tool.py), [billing.py](https://github.com/PostHog/posthog/blob/master/products/replay_vision/backend/billing.py), [PR #80312 (legacy summaries removed)](https://github.com/PostHog/posthog/pull/80312), [legacy prompt_data.py](https://github.com/PostHog/posthog/blob/d58675c4f/ee/hogai/session_summaries/session/prompt_data.py), [legacy video validation prompt](https://github.com/PostHog/posthog/blob/d58675c4f/ee/hogai/session_summaries/session/templates/video-validation/validation-prompt.djt), [docs: session summaries](https://posthog.com/docs/session-replay/session-summaries-ai)
- Playwright: [Trace viewer](https://playwright.dev/docs/trace-viewer), [playwright-trace SKILL.md](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/skills/playwright-trace/SKILL.md), [ARIA snapshots](https://playwright.dev/docs/aria-snapshots), [Locator.ariaSnapshot](https://playwright.dev/docs/api/class-locator#locator-aria-snapshot), [Locators](https://playwright.dev/docs/locators), [Test agents](https://playwright.dev/docs/test-agents), [playwright-mcp README](https://github.com/microsoft/playwright-mcp/blob/main/README.md)
- agent-browser: `agent-browser skills get core --full` and `agent-browser diff --help`, v0.34.0
- browser-use: [system_prompt.md](https://github.com/browser-use/browser-use/blob/main/browser_use/agent/system_prompts/system_prompt.md), [serializer.py](https://github.com/browser-use/browser-use/blob/main/browser_use/dom/serializer/serializer.py)
- rrweb: [README roadmap](https://github.com/rrweb-io/rrweb/blob/master/README.md), [guide](https://github.com/rrweb-io/rrweb/blob/master/guide.md), [rrvideo](https://github.com/rrweb-io/rrweb/tree/master/packages/rrvideo), [rrdom-nodejs](https://github.com/rrweb-io/rrweb/tree/master/packages/rrdom-nodejs), [rrweb.com glossary](https://rrweb.com/glossary/session-summarization)
- Chrome: [DevTools Recorder reference](https://developer.chrome.com/docs/devtools/recorder/reference)
- Token pricing: [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision), [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
- Everr: [browser-events.md](../skills/everr-use-telemetry/rules/browser-events.md), [CONTEXT.md](../CONTEXT.md)
