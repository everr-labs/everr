import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ listMembers: vi.fn(), listInvitations: vi.fn() }));
vi.mock("#app/lib/auth-client.ts", () => ({ authClient: { organization: mocks } }));

import { invitationsQueryOptions, membersQueryOptions } from "./queries";
import { InviteMemberInputSchema, UpdateMemberRoleInputSchema } from "./schemas";

const timestamp = "2026-10-21T12:00:00.000Z";
const member = {
  id: "member-1",
  userId: "user-1",
  role: "owner",
  createdAt: timestamp,
  user: { name: "Owner", email: "owner@example.test" },
};
const invitation = {
  id: "invitation-1",
  email: "invited@example.test",
  role: "member",
  status: "pending",
  expiresAt: timestamp,
};
let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.resetAllMocks();
});
afterEach(() => client.clear());

describe("member response boundary", () => {
  it("accepts genuinely empty lists", async () => {
    mocks.listMembers.mockResolvedValue({ data: { members: [] }, error: null });
    mocks.listInvitations.mockResolvedValue({ data: [], error: null });
    expect(
      await Promise.all([
        client.fetchQuery(membersQueryOptions()),
        client.fetchQuery(invitationsQueryOptions()),
      ]),
    ).toEqual([[], []]);
  });

  it.each([
    { name: "array", data: [member] },
    { name: "envelope", data: { members: [member], total: 1 } },
    { name: "Date object", data: [{ ...member, createdAt: new Date(timestamp) }] },
  ])("validates the $name response before caching it", async ({ data }) => {
    mocks.listMembers.mockResolvedValue({ data, error: null });
    const members = await client.fetchQuery(membersQueryOptions());
    expect(members).toEqual([{ ...member, createdAt: new Date(timestamp) }]);
  });

  it.each([
    { name: "missing envelope", data: undefined },
    { name: "null response", data: null },
    { name: "wrong envelope", data: { users: [member] } },
    { name: "unknown role", data: [{ ...member, role: "super-admin" }] },
    { name: "partly unknown roles", data: [{ ...member, role: "member,super-admin" }] },
    { name: "empty role", data: [{ ...member, role: "" }] },
    { name: "empty role component", data: [{ ...member, role: "member," }] },
    { name: "malformed date", data: [{ ...member, createdAt: "not-a-date" }] },
    { name: "null date", data: [{ ...member, createdAt: null }] },
    { name: "missing identity", data: [{ ...member, userId: undefined }] },
    { name: "malformed profile", data: [{ ...member, user: { name: 42 } }] },
  ])("rejects $name instead of caching an empty or unsafe list", async ({ data }) => {
    mocks.listMembers.mockResolvedValue({ data, error: null });
    await expect(client.fetchQuery(membersQueryOptions())).rejects.toBeInstanceOf(z.ZodError);
    expect(client.getQueryData(membersQueryOptions().queryKey)).toBeUndefined();
  });

  it("preserves an intentionally missing profile for the table's fallback", async () => {
    mocks.listMembers.mockResolvedValue({ data: [{ ...member, user: null }], error: null });
    const members = await client.fetchQuery(membersQueryOptions());
    expect(members[0]?.user).toBeNull();
  });

  it.each(["owner,member", "member, admin"])(
    "preserves composite member roles: %s",
    async (role) => {
      mocks.listMembers.mockResolvedValue({
        data: { members: [{ ...member, role }] },
        error: null,
      });
      expect(await client.fetchQuery(membersQueryOptions())).toEqual([
        { ...member, role, createdAt: new Date(timestamp) },
      ]);
    },
  );
});

describe("invitation response boundary", () => {
  it("preserves composite invitation roles", async () => {
    mocks.listInvitations.mockResolvedValue({
      data: [{ ...invitation, role: "admin,member" }],
      error: null,
    });
    expect(await client.fetchQuery(invitationsQueryOptions())).toEqual([
      { ...invitation, role: "admin,member", expiresAt: new Date(timestamp) },
    ]);
  });

  it.each([
    { name: "array", data: [invitation] },
    { name: "envelope", data: { invitations: [invitation] } },
    { name: "Date object", data: [{ ...invitation, expiresAt: new Date(timestamp) }] },
  ])("validates the $name response before caching it", async ({ data }) => {
    mocks.listInvitations.mockResolvedValue({ data, error: null });
    expect(await client.fetchQuery(invitationsQueryOptions())).toEqual([
      { ...invitation, expiresAt: new Date(timestamp) },
    ]);
  });

  it("shows only pending invitations after validating all records", async () => {
    mocks.listInvitations.mockResolvedValue({
      data: ["pending", "accepted", "rejected", "canceled"].map((status) => ({
        ...invitation,
        id: status,
        status,
      })),
      error: null,
    });
    expect(await client.fetchQuery(invitationsQueryOptions())).toEqual([
      { ...invitation, id: "pending", expiresAt: new Date(timestamp) },
    ]);
  });

  it.each([
    { name: "missing envelope", data: undefined },
    { name: "non-array payload", data: { invitations: "not-an-array" } },
    { name: "unknown role", data: [{ ...invitation, role: "super-admin" }] },
    { name: "partly unknown roles", data: [{ ...invitation, role: "admin,super-admin" }] },
    { name: "unknown status", data: [{ ...invitation, status: "unexpected" }] },
    { name: "missing status", data: [{ ...invitation, status: undefined }] },
    { name: "malformed date", data: [{ ...invitation, expiresAt: "not-a-date" }] },
  ])("rejects $name instead of silently hiding records", async ({ data }) => {
    mocks.listInvitations.mockResolvedValue({ data, error: null });
    await expect(client.fetchQuery(invitationsQueryOptions())).rejects.toBeInstanceOf(z.ZodError);
  });
});

it("keeps role changes and new invitations restricted to a single selectable role", () => {
  expect(
    UpdateMemberRoleInputSchema.safeParse({ memberId: "member-1", role: "admin" }).success,
  ).toBe(true);
  expect(
    UpdateMemberRoleInputSchema.safeParse({ memberId: "member-1", role: "admin,member" }).success,
  ).toBe(false);
  expect(
    InviteMemberInputSchema.safeParse({
      email: "invited@example.test",
      role: "member",
      sendEmail: false,
    }).success,
  ).toBe(true);
  expect(
    InviteMemberInputSchema.safeParse({
      email: "invited@example.test",
      role: "admin,member",
      sendEmail: false,
    }).success,
  ).toBe(false);
});
