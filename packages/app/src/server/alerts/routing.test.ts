import type { QueryResultRow } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from "@/db/client";
import { resolveRoutingRecipients, routingListExists } from "./routing";

const mockedQuery = vi.mocked(
  pool.query as (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: QueryResultRow[] }>,
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("alert routing", () => {
  it("resolves built-in routing lists from organization members", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ userId: "user1" }, { userId: "user2" }, { userId: "owner1" }],
      })
      .mockResolvedValueOnce({
        rows: [{ userId: "admin1" }, { userId: "owner1" }],
      })
      .mockResolvedValueOnce({
        rows: [{ userId: "owner1" }],
      });

    await expect(
      resolveRoutingRecipients({ organizationId: "org1", slug: "everyone" }),
    ).resolves.toEqual(["user1", "user2", "owner1"]);
    await expect(
      resolveRoutingRecipients({ organizationId: "org1", slug: "admins" }),
    ).resolves.toEqual(["admin1", "owner1"]);
    await expect(
      resolveRoutingRecipients({ organizationId: "org1", slug: "owners" }),
    ).resolves.toEqual(["owner1"]);

    expect(mockedQuery.mock.calls[0]?.[0]).toContain("FROM member");
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "role IN ('admin', 'owner')",
    );
    expect(mockedQuery.mock.calls[2]?.[0]).toContain("role = 'owner'");
  });

  it("resolves custom routing lists from alert routing tables", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ userId: "user1" }, { userId: "user1" }, { userId: "user2" }],
    });

    await expect(
      resolveRoutingRecipients({ organizationId: "org1", slug: "platform" }),
    ).resolves.toEqual(["user1", "user2"]);

    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("JOIN"), [
      "org1",
      "platform",
    ]);
  });

  it("recognizes built-in and custom routing lists", async () => {
    await expect(
      routingListExists({ organizationId: "org1", slug: "admins" }),
    ).resolves.toBe(true);

    mockedQuery.mockResolvedValueOnce({ rows: [{ exists: 1 }] });

    await expect(
      routingListExists({ organizationId: "org1", slug: "platform" }),
    ).resolves.toBe(true);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 1"),
      ["org1", "platform"],
    );
  });
});
