# everr-setup-telemetry skill evals

Agent-driven, end-to-end: each run scaffolds a fresh project, hands it to a headless Claude Code agent with only the `everr-setup-telemetry` skill and a one-paragraph prompt, then grades the outcome objectively against the local collector.

```bash
node evals/setup-telemetry/run.mjs --framework tanstack-start
node evals/setup-telemetry/run.mjs --framework nextjs
node evals/setup-telemetry/run.mjs --framework vite-ssr
```

Pass criteria (all required):

1. `npm run build` succeeds after the agent's changes.
2. The app boots and serves a page.
3. Fresh rows arrive under the prompted browser service name (`<run-id>-web`).
4. Fresh rows arrive under the prompted server service name (`<run-id>-server`).
5. At least one `TraceId` contains spans from both service names (the browser-to-server seam).

The verdict prints as JSON and the exit code is 0 only on pass. Failed runs keep the scaffolded project on disk for inspection; pass `--keep` to keep passing runs too.

Requirements: the `everr-dev` local collector running, the `claude` CLI, and the `agent-browser` CLI. Runs are token-costly and non-deterministic: they exercise the real agent, so run them on demand (before skill changes ship), not in CI.
