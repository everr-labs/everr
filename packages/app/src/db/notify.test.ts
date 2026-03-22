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

  it("throws on unsafe traceId", () => {
    expect(() => traceChannel('abc"; DROP TABLE--')).toThrow(
      "Unsafe channel name component",
    );
  });
});

describe("commitChannel", () => {
  it("returns commit_{tenantId}_{sha_lowercased}", () => {
    expect(commitChannel(42, "ABC123")).toBe("commit_42_abc123");
  });

  it("throws on unsafe sha", () => {
    expect(() => commitChannel(42, 'abc"; DROP TABLE--')).toThrow(
      "Unsafe channel name component",
    );
  });
});

describe("notifyWorkflowUpdate", () => {
  it("calls db.execute once with all three pg_notify calls", async () => {
    await notifyWorkflowUpdate(mockDb, {
      tenantId: 42,
      traceId: "abc123",
      runId: "999",
      sha: "deadbeef",
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
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
