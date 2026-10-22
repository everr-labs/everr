import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ listMembers: vi.fn(), listInvitations: vi.fn() }));
vi.mock("#app/lib/auth-client.ts", () => ({ authClient: { organization: mocks } }));

import { invitationsQueryOptions, membersQueryOptions } from "./queries";

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.resetAllMocks();
});
afterEach(() => client.clear());

it("preserves member response values without validating or coercing them", async () => {
  const member = {
    id: "member-1",
    userId: "user-1",
    role: "owner,member",
    createdAt: "legacy-date",
  };
  mocks.listMembers.mockResolvedValue({ data: { members: [member] }, error: null });
  expect(await client.fetchQuery(membersQueryOptions())).toEqual([member]);
});

it.each([undefined, null, { users: [] }, { members: null }])(
  "keeps the empty-list fallback for an unsupported member envelope: %s",
  async (data) => {
    mocks.listMembers.mockResolvedValue({ data, error: null });
    expect(await client.fetchQuery(membersQueryOptions())).toEqual([]);
  },
);

it("filters pending invitations without validating unrelated records or coercing fields", async () => {
  const pending = {
    id: "invite-1",
    email: "legacy-address",
    role: "auditor",
    status: "pending",
    expiresAt: "legacy-date",
  };
  mocks.listInvitations.mockResolvedValue({
    data: { invitations: [pending, { status: "unexpected" }, {}] },
    error: null,
  });
  expect(await client.fetchQuery(invitationsQueryOptions())).toEqual([pending]);
});

it("preserves auth-client errors", async () => {
  mocks.listMembers.mockResolvedValue({ data: null, error: { message: "Access denied" } });
  await expect(client.fetchQuery(membersQueryOptions())).rejects.toThrow("Access denied");
});
