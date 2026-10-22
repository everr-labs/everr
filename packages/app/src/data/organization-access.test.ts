// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: vi.fn(),
  select: vi.fn(),
  entryRedirect: vi.fn(),
}));
vi.mock("@composition/entry", () => ({
  entry: { getOrganizationEntryRedirect: mocks.entryRedirect },
}));
vi.mock("#app/db/client.ts", () => ({ db: { select: mocks.select } }));

import { auth } from "#app/identity/server.ts";
import { getActiveOrganizationAccess } from "./organization-access";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.entryRedirect.mockResolvedValue(undefined);
  mocks.select.mockImplementation(() => ({
    from: () => ({
      innerJoin: () => ({ where: () => ({ limit: mocks.rows }) }),
    }),
  }));
});
it("returns membership and metadata without calling the full organization endpoint", async () => {
  mocks.rows.mockResolvedValue([
    { id: "test_org", metadata: '{"clickhouseReady":false}' },
  ]);
  expect(await getActiveOrganizationAccess()).toEqual({
    status: "available",
    organization: { id: "test_org", metadata: '{"clickhouseReady":false}' },
    entryRedirect: undefined,
  });
  expect(auth.api.getFullOrganization).not.toHaveBeenCalled();
});
it("returns missing for revoked membership or a deleted organization", async () => {
  mocks.rows.mockResolvedValue([]);
  expect(await getActiveOrganizationAccess()).toEqual({ status: "missing" });
});
it("skips organization lookup when none is selected", async () => {
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: { id: "user" },
    session: { activeOrganizationId: null },
  } as never);
  expect(await getActiveOrganizationAccess()).toEqual({ status: "missing" });
  expect(mocks.select).not.toHaveBeenCalled();
});
it("preserves infrastructure failures instead of classifying them as missing membership", async () => {
  mocks.rows.mockRejectedValue(new Error("Database unavailable"));
  await expect(getActiveOrganizationAccess()).rejects.toThrow(
    "Database unavailable",
  );
});

it("resolves application entry only after membership verification", async () => {
  mocks.rows.mockResolvedValue([]);
  await getActiveOrganizationAccess();
  expect(mocks.entryRedirect).not.toHaveBeenCalled();
  mocks.rows.mockResolvedValue([{ id: "test_org", metadata: null }]);
  mocks.entryRedirect.mockResolvedValue({ to: "/setup" });
  expect(await getActiveOrganizationAccess()).toMatchObject({
    entryRedirect: { to: "/setup" },
  });
  expect(mocks.entryRedirect).toHaveBeenCalledWith({
    id: "test_session",
    activeOrganizationId: "test_org",
  });
});
