/**
 * The published description of the Everr Cloud HTTP API.
 *
 * It is hand-written rather than generated because the API routes live in
 * `packages/app` (a separate deployment) while the spec has to be served from
 * everr.dev, where agents look for it. `src/lib/openapi.test.ts` keeps the
 * document self-consistent: unique operationIds, a description and a response
 * schema on every operation, and typed parameters.
 */

export const OPENAPI_VERSION = "3.1.0";
const EVERR_API_VERSION = "1.0.0";

const ERROR_RESPONSE_REF = "#/components/schemas/Error";

/** Reusable `$ref` to the structured error body every failing call returns. */
function errorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: ERROR_RESPONSE_REF },
      },
    },
  };
}

function jsonResponse(description: string, schema: Record<string, unknown>) {
  return {
    description,
    content: { "application/json": { schema } },
  };
}

const RESOURCE_KINDS = ["dashboard", "runbook", "alert"] as const;

const RUN_CONCLUSIONS = [
  "success",
  "failure",
  "cancelled",
  "skipped",
  "in_progress",
] as const;

const COMMON_ERRORS = {
  400: errorResponse("The request was malformed or failed validation."),
  401: errorResponse("No credential was supplied, or it is not valid."),
  403: errorResponse("The credential is valid but not allowed to do this."),
  404: errorResponse("No such resource."),
  500: errorResponse("Everr failed to handle the request."),
};

export function buildOpenApiDocument(siteUrl: string) {
  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: "Everr Cloud API",
      version: EVERR_API_VERSION,
      summary:
        "Read and write Everr observability data: telemetry queries, CI runs, and dashboards, runbooks and alert rules stored as code.",
      description: [
        "Everr is an OpenTelemetry observability platform. This API is what the",
        "`everr` CLI, the Everr desktop app, and coding agents use to read",
        "telemetry and to publish observability-as-code resources.",
        "",
        "Every endpoint under `/api` needs a credential except `/api/health`.",
        "Mint an API key in the Everr app under Settings, then send it as",
        "`Authorization: Bearer <key>` or `X-Api-Key: <key>`. The CLI does this",
        "for you after `everr login`.",
        "",
        "Errors always come back as JSON with an `error` object that carries a",
        "stable `code`, a human-readable `message`, and a `documentation_url`.",
      ].join("\n"),
      contact: {
        name: "Everr support",
        email: "hello@everr.dev",
        url: `${siteUrl}/contact`,
      },
      license: {
        name: "Everr Terms of Service",
        url: `${siteUrl}/privacy`,
      },
      termsOfService: `${siteUrl}/privacy`,
    },
    externalDocs: {
      description: "Everr documentation",
      url: `${siteUrl}/docs`,
    },
    servers: [
      {
        url: "https://app.everr.dev",
        description: "Everr Cloud control API",
      },
    ],
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    tags: [
      {
        name: "Meta",
        description: "Unauthenticated service and identity endpoints.",
      },
      {
        name: "Telemetry",
        description: "Query stored logs, traces and metrics with SQL.",
      },
      {
        name: "CI",
        description: "GitHub Actions runs, jobs, steps and their logs.",
      },
      {
        name: "Resources",
        description:
          "Dashboards, runbooks and alert rules managed as code and applied with `everr apply`.",
      },
      {
        name: "Organization",
        description: "The organization the credential belongs to.",
      },
      {
        name: "Ingest",
        description: "OTLP endpoints that accept telemetry.",
      },
    ],
    paths: {
      "/api/health": {
        get: {
          operationId: "getHealth",
          tags: ["Meta"],
          summary: "Check that the API is up",
          description:
            "Liveness probe. Needs no credential, so an agent can use it to confirm reachability before authenticating.",
          security: [],
          responses: {
            200: jsonResponse("The API is serving traffic.", {
              type: "object",
              required: ["ok"],
              properties: {
                ok: { type: "boolean", const: true },
              },
            }),
          },
        },
      },
      "/api/cli/me": {
        get: {
          operationId: "getCurrentUser",
          tags: ["Meta"],
          summary: "Get the account behind the credential",
          description:
            "Returns the user the current API key or session belongs to. Use it to confirm which account and organization an agent is acting as.",
          responses: {
            200: jsonResponse("The authenticated user.", {
              $ref: "#/components/schemas/User",
            }),
            401: COMMON_ERRORS[401],
            404: COMMON_ERRORS[404],
          },
        },
      },
      "/api/cli/org": {
        get: {
          operationId: "getOrganization",
          tags: ["Organization"],
          summary: "Get the active organization",
          description:
            "Returns the organization the credential is scoped to, the caller's role in it, and whether onboarding is finished.",
          responses: {
            200: jsonResponse("The active organization.", {
              $ref: "#/components/schemas/Organization",
            }),
            401: COMMON_ERRORS[401],
            404: COMMON_ERRORS[404],
          },
        },
        patch: {
          operationId: "completeOrganizationOnboarding",
          tags: ["Organization"],
          summary: "Mark organization onboarding as finished",
          description:
            "Sets the organization's `onboardingCompleted` flag. The CLI calls this at the end of `everr setup`.",
          responses: {
            200: jsonResponse("Onboarding was marked complete.", {
              $ref: "#/components/schemas/Ok",
            }),
            401: COMMON_ERRORS[401],
            404: COMMON_ERRORS[404],
          },
        },
      },
      "/api/cli/org/name": {
        patch: {
          operationId: "renameOrganization",
          tags: ["Organization"],
          summary: "Rename the active organization",
          description: "Changes the display name of the active organization.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: {
                      type: "string",
                      minLength: 1,
                      description: "The new organization name.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: jsonResponse("The organization was renamed.", {
              $ref: "#/components/schemas/Ok",
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
          },
        },
      },
      "/api/cli/repos": {
        get: {
          operationId: "listRepositories",
          tags: ["CI"],
          summary: "List connected GitHub repositories",
          description:
            "Returns the repositories the organization's GitHub App installation can see. Returns an empty array when no installation is active.",
          responses: {
            200: jsonResponse("The connected repositories.", {
              type: "array",
              items: { $ref: "#/components/schemas/Repository" },
            }),
            401: COMMON_ERRORS[401],
          },
        },
      },
      "/api/cli/sql": {
        post: {
          operationId: "queryTelemetry",
          tags: ["Telemetry"],
          summary: "Run a read-only SQL query over stored telemetry",
          description:
            "Runs a ClickHouse SELECT against the organization's telemetry tables (logs, spans, metrics) and streams the rows back as newline-delimited JSON, one object per line. The query is read-only and scoped to the caller's organization; see the SQL reference in the docs for the available tables and columns.",
          requestBody: {
            required: true,
            description: "The SQL query, as a plain-text body.",
            content: {
              "text/plain": {
                schema: { type: "string", minLength: 1 },
                example:
                  "SELECT Timestamp, Body FROM otel_logs ORDER BY Timestamp DESC LIMIT 10",
              },
            },
          },
          responses: {
            200: {
              description:
                "The result rows, one JSON object per line. An empty result is an empty body.",
              content: {
                "application/x-ndjson": {
                  schema: {
                    type: "string",
                    description:
                      "Newline-delimited JSON. Each line parses to one row object.",
                  },
                },
              },
            },
            400: errorResponse(
              "The SQL is empty, invalid, or not allowed for this credential.",
            ),
            401: COMMON_ERRORS[401],
          },
        },
      },
      "/api/cli/runs": {
        get: {
          operationId: "listRuns",
          tags: ["CI"],
          summary: "List CI runs",
          description:
            "Lists GitHub Actions runs the organization has ingested, newest first, with the filters that produced the page echoed back.",
          parameters: [
            { $ref: "#/components/parameters/From" },
            { $ref: "#/components/parameters/To" },
            {
              name: "limit",
              in: "query",
              description: "How many runs to return (1-100). Defaults to 20.",
              required: false,
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 20,
              },
            },
            {
              name: "offset",
              in: "query",
              description: "How many runs to skip. Defaults to 0.",
              required: false,
              schema: { type: "integer", minimum: 0, default: 0 },
            },
            {
              name: "repo",
              in: "query",
              description: "Restrict to one repository, as `owner/name`.",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "branch",
              in: "query",
              description: "Restrict to one branch.",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "conclusion",
              in: "query",
              description: "Restrict to one run conclusion.",
              required: false,
              schema: { type: "string", enum: [...RUN_CONCLUSIONS] },
            },
            {
              name: "workflowName",
              in: "query",
              description: "Restrict to one workflow name.",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "runId",
              in: "query",
              description: "Restrict to one GitHub run id.",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "includeTotalCount",
              in: "query",
              description:
                "Set to `true` to also count every matching run. Costs an extra query.",
              required: false,
              schema: { type: "string", enum: ["true", "false"] },
            },
          ],
          responses: {
            200: jsonResponse("A page of runs.", {
              $ref: "#/components/schemas/RunList",
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
          },
        },
      },
      "/api/cli/runs/status": {
        get: {
          operationId: "getRunStatus",
          tags: ["CI"],
          summary: "Get the CI status of a commit or run",
          description:
            "Returns the current status of a commit's or run's checks. This is the endpoint to poll when an agent needs to know whether a push is green.",
          parameters: [
            {
              name: "repo",
              in: "query",
              description: "The repository, as `owner/name`.",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "commit",
              in: "query",
              description:
                "The commit SHA. Either `commit` or `runId` is required.",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "runId",
              in: "query",
              description:
                "The GitHub run id. Either `commit` or `runId` is required.",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "branch",
              in: "query",
              description: "Narrow the lookup to one branch.",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "attempt",
              in: "query",
              description: "Narrow the lookup to one run attempt.",
              required: false,
              schema: { type: "integer", minimum: 1 },
            },
          ],
          responses: {
            200: jsonResponse("The status of the matching checks.", {
              $ref: "#/components/schemas/RunStatus",
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
          },
        },
      },
      "/api/cli/runs/filter-options": {
        get: {
          operationId: "listRunFilterOptions",
          tags: ["CI"],
          summary: "List the filter values available for runs",
          description:
            "Returns the repositories, branches, workflow names and authors that appear in the given window, so a caller can build a valid filter without guessing.",
          parameters: [
            { $ref: "#/components/parameters/From" },
            { $ref: "#/components/parameters/To" },
          ],
          responses: {
            200: jsonResponse("The available filter values.", {
              $ref: "#/components/schemas/RunFilterOptions",
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
          },
        },
      },
      "/api/cli/runs/{traceId}": {
        get: {
          operationId: "getRun",
          tags: ["CI"],
          summary: "Get one CI run with its jobs and steps",
          description:
            "Returns a single run, its jobs, and each job's steps. Set `failed=true` to get only the failing jobs and steps, which is usually what an agent diagnosing a red build wants.",
          parameters: [
            { $ref: "#/components/parameters/TraceId" },
            {
              name: "failed",
              in: "query",
              description:
                "Set to `true` to return only failing jobs and steps.",
              required: false,
              schema: { type: "string", enum: ["true", "false"] },
            },
          ],
          responses: {
            200: jsonResponse("The run with its jobs and steps.", {
              $ref: "#/components/schemas/RunDetail",
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
            404: COMMON_ERRORS[404],
          },
        },
      },
      "/api/cli/runs/{traceId}/logs": {
        get: {
          operationId: "getRunStepLogs",
          tags: ["CI"],
          summary: "Read the logs of one step in a CI run",
          description:
            "Returns the log lines a single step produced. Identify the job by `jobName` or `jobId`, and the step by `stepNumber`. Use `tail` for the last N lines, or `limit` and `offset` to page forward. `egrep` filters lines by extended regular expression.",
          parameters: [
            { $ref: "#/components/parameters/TraceId" },
            {
              name: "jobName",
              in: "query",
              description:
                "The job name. Either `jobName` or `jobId` is required.",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "jobId",
              in: "query",
              description:
                "The job id. Either `jobName` or `jobId` is required.",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "stepNumber",
              in: "query",
              description: "The 1-based step number within the job.",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "tail",
              in: "query",
              description:
                "Return only the last N lines (1-5000). Cannot be combined with `limit`.",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 5000 },
            },
            {
              name: "limit",
              in: "query",
              description:
                "Return at most N lines (1-5000). Cannot be combined with `tail`.",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 5000 },
            },
            {
              name: "offset",
              in: "query",
              description: "Skip this many lines before returning.",
              required: false,
              schema: { type: "integer", minimum: 0 },
            },
            {
              name: "egrep",
              in: "query",
              description:
                "Keep only lines matching this extended regular expression.",
              required: false,
              schema: { type: "string", minLength: 1 },
            },
          ],
          responses: {
            200: jsonResponse("The matching log lines.", {
              $ref: "#/components/schemas/StepLogs",
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
            404: COMMON_ERRORS[404],
          },
        },
      },
      "/api/cli/notification": {
        get: {
          operationId: "listRunFailureNotifications",
          tags: ["CI"],
          summary: "Summarize the failures of a CI run",
          description:
            "Returns the notification-ready summary of what failed in a run, including deep links back into the Everr app.",
          parameters: [
            {
              name: "traceId",
              in: "query",
              description: "The trace id of the run.",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
          ],
          responses: {
            200: jsonResponse("The failures found in the run.", {
              type: "array",
              items: { $ref: "#/components/schemas/FailureNotification" },
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
          },
        },
      },
      "/api/cli/import": {
        post: {
          operationId: "importRepositoryHistory",
          tags: ["CI"],
          summary: "Backfill workflow history for repositories",
          description:
            "Starts a background import of past GitHub Actions runs for the named repositories. Only organization admins and owners may call it.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["repos"],
                  properties: {
                    repos: {
                      type: "array",
                      minItems: 1,
                      items: { type: "string", minLength: 1 },
                      description:
                        "Repositories to import, each as `owner/name`.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: jsonResponse("The import was accepted.", {
              $ref: "#/components/schemas/ImportStarted",
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
            403: COMMON_ERRORS[403],
          },
        },
      },
      "/api/cli/resources": {
        get: {
          operationId: "listResources",
          tags: ["Resources"],
          summary: "List dashboards, runbooks and alert rules",
          description:
            "Lists the observability-as-code resources the organization has applied, optionally narrowed to one kind or one owning repository.",
          parameters: [
            {
              name: "kind",
              in: "query",
              description: "Restrict to one resource kind.",
              required: false,
              schema: { type: "string", enum: [...RESOURCE_KINDS] },
            },
            {
              name: "repoid",
              in: "query",
              description: "Restrict to the resources owned by one repository.",
              required: false,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: jsonResponse("The matching resources.", {
              type: "array",
              items: { $ref: "#/components/schemas/ResourceSummary" },
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
          },
        },
      },
      "/api/cli/resources/{kind}/{project}/{slug}": {
        get: {
          operationId: "getResource",
          tags: ["Resources"],
          summary: "Get one resource document",
          description:
            "Returns the stored YAML-equivalent document for one dashboard, runbook or alert rule. The reserved project `built-in` serves Everr's catalog dashboards, which are read-only.",
          parameters: [
            { $ref: "#/components/parameters/ResourceKind" },
            { $ref: "#/components/parameters/ResourceProject" },
            { $ref: "#/components/parameters/ResourceSlug" },
          ],
          responses: {
            200: jsonResponse("The resource document.", {
              $ref: "#/components/schemas/ResourceDocument",
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
            404: COMMON_ERRORS[404],
          },
        },
        delete: {
          operationId: "deleteResource",
          tags: ["Resources"],
          summary: "Delete one resource",
          description:
            "Removes a dashboard, runbook or alert rule. Resources in the reserved `built-in` project cannot be deleted.",
          parameters: [
            { $ref: "#/components/parameters/ResourceKind" },
            { $ref: "#/components/parameters/ResourceProject" },
            { $ref: "#/components/parameters/ResourceSlug" },
          ],
          responses: {
            200: jsonResponse("The resource was deleted.", {
              type: "object",
              required: ["ok", "kind", "project", "slug"],
              properties: {
                ok: { type: "boolean", const: true },
                kind: { type: "string", enum: [...RESOURCE_KINDS] },
                project: { type: "string" },
                slug: { type: "string" },
              },
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
            403: COMMON_ERRORS[403],
            404: COMMON_ERRORS[404],
          },
        },
      },
      "/api/cli/resources/{kind}/{project}/{slug}/adopt": {
        post: {
          operationId: "adoptResource",
          tags: ["Resources"],
          summary: "Make a repository the owner of a resource",
          description:
            "Assigns an existing resource to a repository so later `everr apply` runs from that repository manage it instead of creating a duplicate.",
          parameters: [
            { $ref: "#/components/parameters/ResourceKind" },
            { $ref: "#/components/parameters/ResourceProject" },
            { $ref: "#/components/parameters/ResourceSlug" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["repoid"],
                  properties: {
                    repoid: {
                      type: "string",
                      minLength: 1,
                      description:
                        "The repository that should own the resource.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: jsonResponse("The resource is now owned by the repository.", {
              type: "object",
              required: ["kind", "project", "slug", "repoid", "alreadyOwned"],
              properties: {
                kind: { type: "string", enum: [...RESOURCE_KINDS] },
                project: { type: "string" },
                slug: { type: "string" },
                repoid: { type: "string" },
                alreadyOwned: {
                  type: "boolean",
                  description:
                    "True when the repository already owned the resource.",
                },
              },
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
            403: COMMON_ERRORS[403],
            404: COMMON_ERRORS[404],
          },
        },
      },
      "/api/apply": {
        post: {
          operationId: "applyResources",
          tags: ["Resources"],
          summary: "Apply a set of resources as code",
          description:
            "Publishes a whole set of dashboards, runbooks and alert rules in one transaction, the way `everr apply ./dashboards` does. Send `dryRun: true` to get the plan without writing anything; a read-only API key may only do that.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApplyRequest" },
              },
            },
          },
          responses: {
            200: jsonResponse("The apply summary.", {
              $ref: "#/components/schemas/ApplySummary",
            }),
            400: COMMON_ERRORS[400],
            401: COMMON_ERRORS[401],
            403: errorResponse(
              "The API key is read-only, so only `dryRun: true` is allowed.",
            ),
            500: COMMON_ERRORS[500],
          },
        },
      },
      "/v1/traces": {
        servers: [
          { url: "https://ingest.everr.dev", description: "Everr OTLP ingest" },
        ],
        post: {
          operationId: "ingestTraces",
          tags: ["Ingest"],
          summary: "Send OTLP spans",
          description:
            "Standard OpenTelemetry Protocol HTTP endpoint for spans. Point any OTLP exporter at `https://ingest.everr.dev` with `Authorization: Bearer <api-key>`. The payload is whatever the OpenTelemetry specification defines, so no Everr-specific schema is repeated here.",
          requestBody: {
            required: true,
            content: {
              "application/x-protobuf": { schema: { type: "string" } },
              "application/json": { schema: { type: "object" } },
            },
          },
          responses: {
            200: jsonResponse("The spans were accepted.", { type: "object" }),
            401: COMMON_ERRORS[401],
          },
        },
      },
      "/v1/logs": {
        servers: [
          { url: "https://ingest.everr.dev", description: "Everr OTLP ingest" },
        ],
        post: {
          operationId: "ingestLogs",
          tags: ["Ingest"],
          summary: "Send OTLP log records",
          description:
            "Standard OpenTelemetry Protocol HTTP endpoint for logs, authenticated the same way as `ingestTraces`.",
          requestBody: {
            required: true,
            content: {
              "application/x-protobuf": { schema: { type: "string" } },
              "application/json": { schema: { type: "object" } },
            },
          },
          responses: {
            200: jsonResponse("The log records were accepted.", {
              type: "object",
            }),
            401: COMMON_ERRORS[401],
          },
        },
      },
      "/v1/metrics": {
        servers: [
          { url: "https://ingest.everr.dev", description: "Everr OTLP ingest" },
        ],
        post: {
          operationId: "ingestMetrics",
          tags: ["Ingest"],
          summary: "Send OTLP metrics",
          description:
            "Standard OpenTelemetry Protocol HTTP endpoint for metrics, authenticated the same way as `ingestTraces`.",
          requestBody: {
            required: true,
            content: {
              "application/x-protobuf": { schema: { type: "string" } },
              "application/json": { schema: { type: "object" } },
            },
          },
          responses: {
            200: jsonResponse("The metrics were accepted.", { type: "object" }),
            401: COMMON_ERRORS[401],
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "An Everr API key sent as `Authorization: Bearer <key>`. Mint one in the Everr app under Settings, or let `everr login` store one for you.",
        },
        apiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Api-Key",
          description: "The same Everr API key, sent as a header instead.",
        },
      },
      parameters: {
        From: {
          name: "from",
          in: "query",
          description:
            "Start of the window, as an ISO 8601 timestamp or a datemath expression such as `now-7d`.",
          required: false,
          schema: { type: "string" },
        },
        To: {
          name: "to",
          in: "query",
          description:
            "End of the window, as an ISO 8601 timestamp or a datemath expression such as `now`.",
          required: false,
          schema: { type: "string" },
        },
        TraceId: {
          name: "traceId",
          in: "path",
          description: "The trace id that identifies the CI run.",
          required: true,
          schema: { type: "string", minLength: 1 },
        },
        ResourceKind: {
          name: "kind",
          in: "path",
          description: "The resource kind.",
          required: true,
          schema: { type: "string", enum: [...RESOURCE_KINDS] },
        },
        ResourceProject: {
          name: "project",
          in: "path",
          description:
            "The project the resource belongs to. `built-in` is reserved for Everr's own read-only catalog.",
          required: true,
          schema: { type: "string", minLength: 1 },
        },
        ResourceSlug: {
          name: "slug",
          in: "path",
          description: "The resource slug, unique within its project.",
          required: true,
          schema: { type: "string", minLength: 1 },
        },
      },
      schemas: {
        Error: {
          type: "object",
          description:
            "Every failing call returns this shape, so a caller can branch on `error.code` instead of parsing prose.",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message", "status"],
              properties: {
                code: {
                  type: "string",
                  description:
                    "A stable, machine-readable identifier for the failure.",
                  examples: ["not_found", "invalid_request", "unauthorized"],
                },
                message: {
                  type: "string",
                  description: "A human-readable explanation.",
                },
                status: {
                  type: "integer",
                  description: "The HTTP status code, repeated in the body.",
                },
                documentation_url: {
                  type: "string",
                  format: "uri",
                  description: "Where to read more about this failure.",
                },
                hint: {
                  type: "string",
                  description: "What to try next to make the call succeed.",
                },
              },
            },
          },
        },
        Ok: {
          type: "object",
          required: ["ok"],
          properties: { ok: { type: "boolean", const: true } },
        },
        User: {
          type: "object",
          required: ["email", "name", "profileUrl"],
          properties: {
            email: { type: "string", format: "email" },
            name: { type: "string" },
            profileUrl: {
              type: ["string", "null"],
              format: "uri",
              description: "Avatar URL, or null when the account has none.",
            },
          },
        },
        Organization: {
          type: "object",
          required: ["name", "isOnlyMember", "onboardingCompleted", "role"],
          properties: {
            name: { type: "string" },
            isOnlyMember: {
              type: "boolean",
              description: "True when the caller is the sole member.",
            },
            onboardingCompleted: { type: "boolean" },
            role: {
              type: ["string", "null"],
              description: "The caller's role, such as `owner` or `member`.",
            },
          },
        },
        Repository: {
          type: "object",
          required: ["id", "fullName"],
          properties: {
            id: { type: "integer", description: "The GitHub repository id." },
            fullName: {
              type: "string",
              description: "The repository as `owner/name`.",
            },
          },
        },
        RunSummary: {
          type: "object",
          description: "One CI run as it appears in a listing.",
          properties: {
            traceId: {
              type: "string",
              description:
                "Everr's identifier for the run. Use it as a path parameter on the run endpoints.",
            },
            runId: { type: "string" },
            repo: { type: "string" },
            branch: { type: "string" },
            workflowName: { type: "string" },
            conclusion: { type: "string", enum: [...RUN_CONCLUSIONS] },
            startedAt: { type: "string", format: "date-time" },
            duration: {
              type: "number",
              description: "Wall-clock duration in seconds.",
            },
          },
        },
        RunList: {
          type: "object",
          required: ["runs", "filters"],
          properties: {
            runs: {
              type: "array",
              items: { $ref: "#/components/schemas/RunSummary" },
            },
            totalCount: {
              type: "integer",
              description: "Present only when `includeTotalCount=true`.",
            },
            filters: {
              type: "object",
              description: "The filters that produced this page.",
              additionalProperties: true,
            },
          },
        },
        RunDetail: {
          type: "object",
          required: ["run", "jobs"],
          properties: {
            run: { $ref: "#/components/schemas/RunSummary" },
            jobs: {
              type: "array",
              items: { $ref: "#/components/schemas/Job" },
            },
          },
        },
        Job: {
          type: "object",
          properties: {
            jobId: { type: "string" },
            name: { type: "string" },
            conclusion: { type: "string", enum: [...RUN_CONCLUSIONS] },
            duration: { type: "number" },
            steps: {
              type: "array",
              items: { $ref: "#/components/schemas/Step" },
            },
          },
        },
        Step: {
          type: "object",
          required: ["stepNumber", "name", "conclusion", "duration"],
          properties: {
            stepNumber: { type: "integer" },
            name: { type: "string" },
            conclusion: { type: "string", enum: [...RUN_CONCLUSIONS] },
            duration: { type: "number" },
          },
        },
        StepLogs: {
          type: "object",
          required: ["logs", "offset"],
          properties: {
            logs: {
              type: "array",
              items: { type: "string" },
              description: "The matching log lines, in order.",
            },
            offset: {
              type: "integer",
              description: "Offset to pass back to read the next page.",
            },
          },
        },
        RunStatus: {
          type: "object",
          description:
            "The current check status of a commit or run, with enough detail to decide whether a push is green.",
          additionalProperties: true,
        },
        RunFilterOptions: {
          type: "object",
          description:
            "The distinct filter values present in the requested window.",
          additionalProperties: true,
        },
        FailureNotification: {
          type: "object",
          description: "One failure worth telling a human or an agent about.",
          additionalProperties: true,
        },
        ImportStarted: {
          type: "object",
          description: "Acknowledges that a backfill was queued.",
          additionalProperties: true,
        },
        ResourceSummary: {
          type: "object",
          description: "One applied resource, without its full document.",
          properties: {
            kind: { type: "string", enum: [...RESOURCE_KINDS] },
            project: { type: "string" },
            slug: { type: "string" },
            repoid: { type: ["string", "null"] },
          },
        },
        ResourceDocument: {
          type: "object",
          description:
            "The full resource document. Its shape depends on `kind`; see the dashboard, runbook and alert specs in the docs.",
          additionalProperties: true,
        },
        ApplyRequest: {
          type: "object",
          required: ["state"],
          properties: {
            state: {
              type: "array",
              description: "The resource documents to apply.",
              items: { $ref: "#/components/schemas/ResourceDocument" },
            },
            repoid: {
              type: "string",
              description: "The repository that owns the applied resources.",
            },
            source: {
              type: "string",
              description: "Where the documents came from, for auditing.",
            },
            dryRun: {
              type: "boolean",
              description:
                "Plan only. Nothing is written, and a read-only key is allowed.",
            },
            preview: {
              type: "string",
              description:
                "Publish into a named preview instead of live. An empty string means live.",
            },
            adopt: {
              type: "boolean",
              description:
                "Take ownership of matching resources that another source created.",
            },
          },
        },
        ApplySummary: {
          type: "object",
          description:
            "What the apply did, or would have done for a dry run: created, updated, deleted and unchanged resources.",
          additionalProperties: true,
        },
      },
    },
  };
}

/** Serves the document, as JSON or as the YAML that JSON already is. */
export function openApiResponse(siteUrl: string, contentType: string) {
  return new Response(JSON.stringify(buildOpenApiDocument(siteUrl), null, 2), {
    headers: {
      "content-type": `${contentType}; charset=utf-8`,
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
