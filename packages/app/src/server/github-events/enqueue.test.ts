// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebhookJobData } from "./types";

const addWorkerJob = vi.fn();
vi.mock("@/server/worker/jobs", () => ({
  addWorkerJob: (...args: unknown[]) => addWorkerJob(...args),
}));

vi.mock("./identifiers", () => ({
  COLLECTOR_TASK_IDENTIFIER: "github-events/collector",
  STATUS_TASK_IDENTIFIER: "github-events/status",
}));

import { enqueueWebhookEvent } from "./enqueue";

function data(): WebhookJobData {
  return {
    body: Buffer.from("{}", "utf8").toString("base64"),
    headers: { "x-github-event": ["workflow_run"] },
  };
}

beforeEach(() => {
  addWorkerJob.mockReset().mockResolvedValue(undefined);
});

describe("enqueueWebhookEvent", () => {
  it("adds collector and status jobs for the same event", async () => {
    const payload = data();

    await enqueueWebhookEvent("delivery-1", payload);

    expect(addWorkerJob).toHaveBeenCalledTimes(2);
    expect(addWorkerJob).toHaveBeenCalledWith(
      "github-events/collector",
      payload,
      {
        jobKey: "github-events/collector:delivery-1",
        jobKeyMode: "replace",
        maxAttempts: 10,
      },
    );
    expect(addWorkerJob).toHaveBeenCalledWith("github-events/status", payload, {
      jobKey: "github-events/status:delivery-1",
      jobKeyMode: "replace",
      maxAttempts: 10,
    });
  });
});
