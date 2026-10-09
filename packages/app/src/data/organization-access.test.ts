// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), select: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { select: mocks.select } }));

import { auth } from "@/lib/auth.server";
import { getActiveOrganizationAccess } from "./organization-access";

beforeEach(() => {
  vi.clearAllMocks();
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
