import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertAdminRows } from "@/lib/clickhouse";
import {
  createInvestigation,
  createStatusEvent,
  deleteInvestigation,
  editInvestigation,
} from "./triage-events";

vi.mock("@/lib/clickhouse", () => ({
  insertAdminRows: vi.fn(async () => {}),
}));

const query = vi.fn();

beforeEach(() => {
  vi.mocked(insertAdminRows).mockClear();
  query.mockReset();
});

function insertedRow() {
  const [table, rows, settings] = vi.mocked(insertAdminRows).mock.calls[0] as [
    string,
    Record<string, unknown>[],
    unknown,
  ];
  expect(table).toBe("app.error_triage_events");
  expect(settings).toEqual({ date_time_input_format: "best_effort" });
  expect(rows).toHaveLength(1);
  return rows[0] as Record<string, unknown>;
}

const latestEntry = {
  entryFingerprint: "fp-1",
  eventType: "investigation",
  authorId: "user-1",
  latestVersion: "0",
  latestDeleted: "0",
  createdAt: "2026-07-10 10:00:00.000",
};

describe("createInvestigation", () => {
  it("inserts a version-0 row with tenant and author stamped", async () => {
    await createInvestigation({
      tenantId: "org-1",
      fingerprint: "fp-1",
      body: "## Findings",
      authorId: "user-1",
    });

    const row = insertedRow();
    expect(row).toMatchObject({
      tenant_id: "org-1",
      fingerprint: "fp-1",
      version: 0,
      event_type: "investigation",
      body: "## Findings",
      author_id: "user-1",
      deleted: 0,
    });
    expect(row.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(row.event_time as string)).not.toBeNaN();
    expect(row.updated_at).toBe(row.event_time);
  });
});

describe("createStatusEvent", () => {
  it("inserts a version-0 status row with tenant and author stamped", async () => {
    await createStatusEvent({
      tenantId: "org-1",
      fingerprint: "fp-1",
      type: "resolved",
      body: "Fixed by tightening the retry guard.",
      authorId: "user-1",
    });

    const row = insertedRow();
    expect(row).toMatchObject({
      tenant_id: "org-1",
      fingerprint: "fp-1",
      version: 0,
      event_type: "resolved",
      body: "Fixed by tightening the retry guard.",
      author_id: "user-1",
      deleted: 0,
    });
    expect(row.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.updated_at).toBe(row.event_time);
  });

  it("records ignore and reopen without a body", async () => {
    await createStatusEvent({
      tenantId: "org-1",
      fingerprint: "fp-1",
      type: "ignored",
      body: "",
      authorId: "user-1",
    });

    expect(insertedRow()).toMatchObject({
      event_type: "ignored",
      body: "",
    });
  });
});

describe("editInvestigation", () => {
  it("appends the next version keeping event identity and creation time", async () => {
    query.mockResolvedValueOnce([latestEntry]);

    await editInvestigation({
      query,
      tenantId: "org-1",
      eventId: "11111111-2222-3333-4444-555555555555",
      authorId: "user-1",
      body: "## Findings, revised",
    });

    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toContain("FROM error_triage_events");
    expect(sql).toContain("WHERE event_id = {eventId:UUID}");
    expect(params).toEqual({
      eventId: "11111111-2222-3333-4444-555555555555",
    });

    const row = insertedRow();
    expect(row).toMatchObject({
      tenant_id: "org-1",
      fingerprint: "fp-1",
      event_id: "11111111-2222-3333-4444-555555555555",
      version: 1,
      event_type: "investigation",
      body: "## Findings, revised",
      author_id: "user-1",
      deleted: 0,
      event_time: "2026-07-10 10:00:00.000",
    });
  });

  it.each([
    ["missing entry", []],
    ["deleted entry", [{ ...latestEntry, latestDeleted: "1" }]],
    ["foreign author", [{ ...latestEntry, authorId: "someone-else" }]],
    ["non-investigation entry", [{ ...latestEntry, eventType: "resolved" }]],
  ])("rejects a %s without writing", async (_case, rows) => {
    query.mockResolvedValueOnce(rows);

    await expect(
      editInvestigation({
        query,
        tenantId: "org-1",
        eventId: "11111111-2222-3333-4444-555555555555",
        authorId: "user-1",
        body: "nope",
      }),
    ).rejects.toThrow("Investigation not found");
    expect(insertAdminRows).not.toHaveBeenCalled();
  });
});

describe("deleteInvestigation", () => {
  it("appends a tombstone version with an emptied body", async () => {
    query.mockResolvedValueOnce([{ ...latestEntry, latestVersion: "2" }]);

    await deleteInvestigation({
      query,
      tenantId: "org-1",
      eventId: "11111111-2222-3333-4444-555555555555",
      authorId: "user-1",
    });

    const row = insertedRow();
    expect(row).toMatchObject({
      version: 3,
      deleted: 1,
      body: "",
      event_time: "2026-07-10 10:00:00.000",
    });
  });
});
