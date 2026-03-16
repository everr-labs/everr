import { describe, expect, it } from "vitest";
import {
  generateWorkflowTraceId,
  traceIdFromQueuedWorkflowEvent,
  traceIdFromWebhookEvent,
} from "./trace-id";

describe("generateWorkflowTraceId", () => {
  it("matches the collector trace id algorithm for a known run", () => {
    expect(generateWorkflowTraceId(456, 123, 1)).toBe(
      "d4a47d14ef1214a0f22cdc7bdfd2becf",
    );
  });

  it("defaults missing run attempts to 1", () => {
    expect(generateWorkflowTraceId(456, 123)).toBe(
      generateWorkflowTraceId(456, 123, 1),
    );
  });

  it("changes when the repository id changes", () => {
    expect(generateWorkflowTraceId(456, 123, 1)).not.toBe(
      generateWorkflowTraceId(789, 123, 1),
    );
  });
});

describe("traceIdFromQueuedWorkflowEvent", () => {
  it("extracts the run trace id from workflow_job payloads", () => {
    expect(
      traceIdFromQueuedWorkflowEvent({
        eventType: "workflow_job",
        payload: {
          action: "queued",
          installation: { id: 1 },
          workflow_job: {
            id: 456,
            run_id: 123,
            run_attempt: 2,
            name: "test",
            html_url: null,
            head_branch: null,
            head_sha: null,
            conclusion: null,
            created_at: null,
            started_at: null,
            completed_at: null,
            workflow_name: null,
            runner_name: null,
            runner_labels: null,
            runner_group_name: null,
          },
          repository: {
            id: 999,
            full_name: "acme/repo",
            html_url: "https://github.com/acme/repo",
          },
        },
      }),
    ).toBe(generateWorkflowTraceId(999, 123, 2));
  });

  it("returns null when the repository id is missing", () => {
    expect(
      traceIdFromQueuedWorkflowEvent({
        eventType: "workflow_run",
        payload: {
          action: "requested",
          installation: { id: 1 },
          workflow_run: {
            id: 123,
            run_attempt: 1,
            name: "test",
            html_url: null,
            head_commit: undefined,
            head_branch: null,
            head_sha: null,
            conclusion: null,
            created_at: null,
            updated_at: null,
            run_started_at: null,
            event: null,
            workflow_id: null,
            display_title: null,
            run_number: null,
            path: null,
            actor: null,
            triggering_actor: null,
            pull_requests: null,
            head_repository: null,
          },
          repository: {
            full_name: "acme/repo",
            html_url: "https://github.com/acme/repo",
          },
        },
      }),
    ).toBeNull();
  });
});

describe("traceIdFromWebhookEvent", () => {
  it("returns null when the payload does not contain a canonical run identity", () => {
    expect(
      traceIdFromWebhookEvent(
        "workflow_run",
        Buffer.from(JSON.stringify({ action: "requested" })),
      ),
    ).toBeNull();
  });
});
