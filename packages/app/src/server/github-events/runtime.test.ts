// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sends } = vi.hoisted(() => ({ sends: [] as unknown[][] }));

vi.mock("pg-boss", () => ({
  PgBoss: class {
    on = vi.fn();
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    createQueue = vi.fn().mockResolvedValue(undefined);
    work = vi.fn();
    send = vi.fn(async (...args: unknown[]) => {
      sends.push(args);
    });
  },
}));

vi.mock("@/db/client", () => ({
  db: {},
  pool: { query: vi.fn() },
}));

import { enqueueWebhookEvent } from "./runtime";

describe("enqueueWebhookEvent", () => {
  beforeEach(() => {
    sends.length = 0;
  });

  it("sends workflow events to collector and status queues", async () => {
    await enqueueWebhookEvent(
      "delivery-workflow",
      { headers: {}, body: "e30=" },
      { statusQueue: true },
    );

    expect(sends.map((call) => call[0])).toEqual(["gh-collector", "gh-status"]);
  });

  it("sends deploy events only to the collector queue", async () => {
    await enqueueWebhookEvent(
      "delivery-deploy",
      { headers: {}, body: "e30=" },
      { statusQueue: false },
    );

    expect(sends.map((call) => call[0])).toEqual(["gh-collector"]);
  });
});
