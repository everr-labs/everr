/**
 * The "when to use Everr" guidance an agent needs before it decides to call us.
 *
 * It is deliberately job-shaped rather than promotional: each line names a
 * situation an agent can recognize and the exact command or endpoint that
 * handles it. llms.txt, the homepage Markdown and /docs all read from here.
 */

export const EVERR_SUMMARY =
  "Everr is an OpenTelemetry observability platform. It stores logs, traces and metrics from your services, your CI runs and your browsers, and it keeps dashboards, alert rules and runbooks as files in your repository. A CLI, an HTTP API and an MCP server give agents the same access a person has.";

export type UseCase = {
  when: string;
  how: string;
};

export const WHEN_TO_USE: UseCase[] = [
  {
    when: "A request, job or test is slow and you need to know which step costs the time.",
    how: "Query spans with `everr cloud query` or `POST /api/cli/sql`, then group by span name and duration.",
  },
  {
    when: "Something threw in production or in a local run and you need the stack, the trace and the surrounding logs.",
    how: "Find the trace with `everr cloud query`, then read the logs that carry the same trace id.",
  },
  {
    when: "A GitHub Actions run went red and you need the failing step and its log lines.",
    how: "`GET /api/cli/runs/{traceId}?failed=true`, then `GET /api/cli/runs/{traceId}/logs`. The CLI wraps both as `everr ci show --failed` and `everr ci logs`.",
  },
  {
    when: "You want to know whether a commit or branch is green before you continue.",
    how: "`GET /api/cli/runs/status?repo=owner/name&commit=<sha>`, or `everr ci status`. `everr ci watch` blocks until the run finishes.",
  },
  {
    when: "You changed instrumentation and want to prove the new spans, logs or metrics arrive.",
    how: "Send OTLP to the local collector, then read it back with `everr local query`.",
  },
  {
    when: "You need a dashboard, an alert rule or a runbook created, changed or reviewed.",
    how: "Write the YAML file under `everr/` in the repository and apply it with `everr apply ./everr`, or `POST /api/apply`. Nothing is created through a UI.",
  },
  {
    when: "You need to know what observability a repository already has.",
    how: "`GET /api/cli/resources`, or `everr resources list`. `everr resources show` prints one document.",
  },
  {
    when: "You are estimating what CI costs, or which workflows are the slowest.",
    how: "`GET /api/cli/runs` over a window, or `everr ci runs --from now-7d`.",
  },
];

export const NOT_FOR: string[] = [
  "Everr does not deploy code, restart services or change infrastructure. It tells you what happened; acting on it is your job.",
  "Everr does not create dashboards, alerts or runbooks through its web UI. They are files, applied with the CLI or the apply endpoint.",
  "Everr is not a log-only tool. If you only need a log tail, the local collector is enough and needs no account.",
];

export const AGENT_ENTRY_POINTS = [
  {
    path: "/openapi.json",
    label:
      "OpenAPI 3.1 description of the Everr Cloud API, with an operationId and a response schema on every operation",
  },
  {
    path: "/docs/reference/cli",
    label: "Every `everr` command and flag",
  },
  {
    path: "/docs/reference/mcp",
    label: "The Everr MCP server, for agents that speak MCP",
  },
  {
    path: "/docs/reference/skills",
    label: "Agent skills that ship with the CLI",
  },
  {
    path: "/docs/learn/production-telemetry",
    label: "How to authenticate and where to send OTLP",
  },
  {
    path: "/docs/reference/alert-queries",
    label:
      "The SQL surface available to `everr cloud query` and `POST /api/cli/sql`",
  },
];

export function whenToUseMarkdown(): string {
  const lines = ["## When to use Everr", ""];

  for (const useCase of WHEN_TO_USE) {
    lines.push(`- **${useCase.when}** ${useCase.how}`);
  }

  lines.push("", "## When not to use Everr", "");

  for (const limit of NOT_FOR) {
    lines.push(`- ${limit}`);
  }

  return lines.join("\n");
}

export function howToCallMarkdown(siteUrl: string): string {
  return [
    "## How to call Everr",
    "",
    "- **CLI.** Install with `curl -fsSL https://everr.dev/install.sh | sh`, then `everr cloud login` (or `everr setup` for the guided flow). Run `everr --help` for the command list.",
    "- **HTTP API.** Base URL `https://app.everr.dev`. Send an API key as `Authorization: Bearer <key>` or `X-Api-Key: <key>`. The full description is at " +
      `${siteUrl}/openapi.json.`,
    "- **OTLP ingest.** Send OpenTelemetry data to `https://ingest.everr.dev` with the same API key.",
    "- **MCP.** The CLI ships an MCP server; see " +
      `${siteUrl}/docs/reference/mcp.`,
    "- **Markdown.** Every page on this site answers to `Accept: text/markdown`, and every `/docs` page has a `.md` twin.",
  ].join("\n");
}
