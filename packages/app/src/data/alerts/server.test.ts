import type { QueryResultRow } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("@/server/alerts/repository", () => ({
  deactivateAlertDefinition: vi.fn(),
  listActiveAlertStates: vi.fn(),
  listAlertEvents: vi.fn(),
  listAlertRules: vi.fn(),
  listRoutingLists: vi.fn(),
  saveCustomRoutingList: vi.fn(),
}));

import { pool } from "@/db/client";
import {
  deactivateAlertDefinition,
  listActiveAlertStates,
  listAlertEvents,
  listAlertRules,
  listRoutingLists,
  saveCustomRoutingList,
} from "@/server/alerts/repository";
import {
  deactivateAlertRule,
  getActiveAlerts,
  getAlertEvents,
  getAlertRules,
  getRoutingLists,
  saveRoutingList,
} from "./server";

const mockedQuery = vi.mocked(
  pool.query as (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: QueryResultRow[]; rowCount?: number | null }>,
);

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue({ rows: [{ role: "admin" }], rowCount: 1 });
});

describe("alert server functions", () => {
  it("lists alert rules in the active organization", async () => {
    vi.mocked(listAlertRules).mockResolvedValueOnce([]);

    await getAlertRules({ data: { active: true } });

    expect(listAlertRules).toHaveBeenCalledWith({
      organizationId: "test_org",
      active: true,
    });
  });

  it("lists active alerts, history, and routing lists in the active organization", async () => {
    vi.mocked(listActiveAlertStates).mockResolvedValueOnce([]);
    vi.mocked(listAlertEvents).mockResolvedValueOnce([]);
    vi.mocked(listRoutingLists).mockResolvedValueOnce([]);

    await getActiveAlerts({ data: {} });
    await getAlertEvents({ data: { limit: 25 } });
    await getRoutingLists({ data: {} });

    expect(listActiveAlertStates).toHaveBeenCalledWith({
      organizationId: "test_org",
    });
    expect(listAlertEvents).toHaveBeenCalledWith({
      organizationId: "test_org",
      limit: 25,
    });
    expect(listRoutingLists).toHaveBeenCalledWith({
      organizationId: "test_org",
    });
  });

  it("allows admins to save routing lists", async () => {
    vi.mocked(saveCustomRoutingList).mockResolvedValueOnce({
      slug: "platform",
      name: "Platform",
      builtIn: false,
      members: [],
    });

    await saveRoutingList({
      data: {
        slug: "platform",
        name: "Platform",
        userIds: ["user_1", "user_2"],
      },
    });

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM member"),
      ["test_org", "test_user"],
    );
    expect(saveCustomRoutingList).toHaveBeenCalledWith({
      organizationId: "test_org",
      actorUserId: "test_user",
      slug: "platform",
      name: "Platform",
      userIds: ["user_1", "user_2"],
    });
  });

  it("rejects routing list changes from non-admins", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ role: "member" }],
      rowCount: 1,
    });

    await expect(
      saveRoutingList({
        data: { slug: "platform", name: "Platform", userIds: [] },
      }),
    ).rejects.toThrow("Only organization admins can manage alerts");

    expect(saveCustomRoutingList).not.toHaveBeenCalled();
  });

  it("allows admins to deactivate rules", async () => {
    vi.mocked(deactivateAlertDefinition).mockResolvedValueOnce(true);

    await deactivateAlertRule({ data: { id: 42 } });

    expect(deactivateAlertDefinition).toHaveBeenCalledWith({
      organizationId: "test_org",
      actorUserId: "test_user",
      id: 42,
    });
  });
});
