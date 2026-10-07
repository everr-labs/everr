// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  error: vi.fn(),
  provision: vi.fn(),
}));

vi.mock("@/lib/clickhouse", () => ({
  provisionSqlApiOrgUser: mocks.provision,
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    return {
      "exception.message": error.message,
      "exception.type": error.name,
    };
  },
  serverLogger: { error: mocks.error },
}));

vi.mock("./status", () => ({
  enqueueSqlApiOrgUserProvision: mocks.enqueue,
  SQL_API_SIGNUP_PROVISION_TIMEOUT_MS: 5_000,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.provision.mockResolvedValue(undefined);
  mocks.enqueue.mockResolvedValue(undefined);
});

describe("provisionSqlApiOrgUserOrEnqueue", () => {
  it("stops after the first provision succeeds", async () => {
    const { provisionSqlApiOrgUserOrEnqueue } = await import(
      "./provision-or-enqueue"
    );

    await provisionSqlApiOrgUserOrEnqueue("org-1");

    expect(mocks.provision).toHaveBeenCalledWith("org-1", {
      requestTimeoutMs: 5_000,
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues a retry when the first provision fails", async () => {
    mocks.provision.mockRejectedValue(new Error("Timeout error"));
    const { provisionSqlApiOrgUserOrEnqueue } = await import(
      "./provision-or-enqueue"
    );

    await provisionSqlApiOrgUserOrEnqueue("org-1");

    expect(mocks.error).toHaveBeenCalledWith(
      "sql_api.org_user.provision.failed",
      expect.objectContaining({
        "everr.organization.id": "org-1",
        "exception.message": "Timeout error",
      }),
    );
    expect(mocks.enqueue).toHaveBeenCalledWith("org-1");
  });

  it("keeps signup alive when the retry cannot be queued", async () => {
    mocks.provision.mockRejectedValue(new Error("Timeout error"));
    mocks.enqueue.mockRejectedValue(new Error("db down"));
    const { provisionSqlApiOrgUserOrEnqueue } = await import(
      "./provision-or-enqueue"
    );

    await expect(
      provisionSqlApiOrgUserOrEnqueue("org-1"),
    ).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledWith(
      "sql_api.org_user.provision.enqueue_failed",
      expect.objectContaining({ "exception.message": "db down" }),
    );
  });
});
