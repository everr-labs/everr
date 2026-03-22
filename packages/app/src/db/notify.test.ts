import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockDb = { execute: mockExecute } as unknown as Parameters<
  typeof import("./notify").notifyWorkflowUpdate
>[0];

vi.mock("drizzle-orm", () => ({
  sql: vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      ({ strings, values, __drizzle_sql: true }) as unknown,
  ),
}));

import {
  commitChannel,
  notifyWorkflowUpdate,
  tenantChannel,
  traceChannel,
} from "./notify";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tenantChannel", () => {
  it("returns tenant_{tenantId}", () => {
    expect(tenantChannel(42)).toBe("tenant_42");
  });
});

describe("traceChannel", () => {
  it("returns trace_{traceId}", () => {
    expect(traceChannel("abc123")).toBe("trace_abc123");
  });
});

describe("commitChannel", () => {
  it("returns commit_{tenantId}_{sha_lowercased}", () => {
    expect(commitChannel(42, "ABC123")).toBe("commit_42_abc123");
  });
});

describe("notifyWorkflowUpdate", () => {
  it("calls db.execute three times — once per channel", async () => {
    await notifyWorkflowUpdate(mockDb, {
      tenantId: 42,
      traceId: "abc123",
      runId: "999",
      sha: "deadbeef",
    });

    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it("does not throw when db.execute rejects", async () => {
    mockExecute.mockRejectedValue(new Error("connection lost"));

    await expect(
      notifyWorkflowUpdate(mockDb, {
        tenantId: 42,
        traceId: "abc123",
        runId: "999",
        sha: "deadbeef",
      }),
    ).resolves.not.toThrow();
  });
});
