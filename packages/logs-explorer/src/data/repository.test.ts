import { describe, expect, it, vi } from "vitest";
import type { SqlClient } from "./client";
import { LogsRepository } from "./repository";

const fakeClient = (rows: unknown[]): SqlClient => ({
  execute: vi.fn().mockResolvedValue(rows),
});

describe("LogsRepository.explorer", () => {
  it("maps raw rows to LogExplorerRow", async () => {
    const client = fakeClient([
      {
        timestampRaw: "2026-03-09 12:00:00",
        level: "info",
        body: "hi",
        traceId: "t",
        spanId: "s",
        serviceName: "svc",
        bodyHash: "h",
      },
    ]);
    const repo = new LogsRepository(client);
    const result = await repo.explorer({
      timeRange: { from: "now-1h", to: "now" },
      levels: [],
      services: [],
      repos: [],
      limit: 200,
      offset: 0,
    });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]?.body).toBe("hi");
  });
});

describe("LogsRepository.totals", () => {
  it("decodes totals using selected levels", async () => {
    const client = fakeClient([
      { error: 1, warning: 0, info: 0, debug: 0, trace: 0, unknown: 0 },
    ]);
    const repo = new LogsRepository(client);
    const result = await repo.totals({
      timeRange: { from: "now-1h", to: "now" },
      levels: ["error"],
      services: [],
      repos: [],
    });
    expect(result.totalCount).toBe(1);
  });
});

describe("LogsRepository.detail", () => {
  it("throws when no row found", async () => {
    const repo = new LogsRepository(fakeClient([]));
    await expect(
      repo.detail({
        timestampRaw: "x",
        traceId: "t",
        spanId: "s",
        serviceName: "svc",
        bodyHash: "h",
      }),
    ).rejects.toThrow(/not found/i);
  });
});
