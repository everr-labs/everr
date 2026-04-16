import { describe, expect, it, vi } from "vitest";
import {
  deriveInvitationLookup,
  type InvitationRow,
  resolveInvitationLoader,
} from "@/data/invite-resolver";

function row(overrides: Partial<InvitationRow> = {}): InvitationRow {
  return {
    email: "invitee@example.com",
    role: "member",
    status: "pending",
    expiresAt: new Date("2099-01-01T00:00:00Z"),
    organizationId: "org_1",
    organizationName: "Acme",
    inviterName: "Gio",
    ...overrides,
  };
}

const NOW = new Date("2026-01-01T00:00:00Z");

describe("deriveInvitationLookup", () => {
  it("returns not-found when the row is missing", () => {
    expect(deriveInvitationLookup(undefined, NOW)).toEqual({
      status: "not-found",
    });
  });

  it("returns accepted state without checking expiry", () => {
    const result = deriveInvitationLookup(
      row({ status: "accepted", expiresAt: new Date("2000-01-01") }),
      NOW,
    );
    expect(result).toEqual({
      status: "accepted",
      organizationId: "org_1",
      organizationName: "Acme",
      invitedEmail: "invitee@example.com",
    });
  });

  it("maps canceled status to inactive/canceled", () => {
    const result = deriveInvitationLookup(row({ status: "canceled" }), NOW);
    expect(result).toEqual({
      status: "inactive",
      reason: "canceled",
      organizationName: "Acme",
    });
  });

  it("maps rejected status to inactive/rejected", () => {
    const result = deriveInvitationLookup(row({ status: "rejected" }), NOW);
    expect(result).toMatchObject({ status: "inactive", reason: "rejected" });
  });

  it("maps expired pending invitations to inactive/expired", () => {
    const result = deriveInvitationLookup(
      row({ status: "pending", expiresAt: new Date("2025-01-01T00:00:00Z") }),
      NOW,
    );
    expect(result).toMatchObject({ status: "inactive", reason: "expired" });
  });

  it("returns pending state for valid invitations", () => {
    const result = deriveInvitationLookup(row(), NOW);
    expect(result).toEqual({
      status: "pending",
      organizationId: "org_1",
      organizationName: "Acme",
      invitedEmail: "invitee@example.com",
      role: "member",
      inviterName: "Gio",
    });
  });

  it("treats expiresAt === now as still valid (strict <)", () => {
    const result = deriveInvitationLookup(
      row({ status: "pending", expiresAt: NOW }),
      NOW,
    );
    expect(result.status).toBe("pending");
  });
});

describe("resolveInvitationLoader", () => {
  const checkIsMember = vi.fn();

  function run(args: {
    session: { user: { email: string } } | null;
    lookup: Parameters<typeof resolveInvitationLoader>[0]["lookup"];
    isMember?: boolean;
  }) {
    checkIsMember.mockReset();
    checkIsMember.mockResolvedValue(args.isMember ?? false);
    return resolveInvitationLoader({
      invitationId: "inv_1",
      session: args.session,
      lookup: args.lookup,
      checkIsMember,
    });
  }

  it("passes through not-found", async () => {
    const result = await run({
      session: null,
      lookup: { status: "not-found" },
    });
    expect(result).toEqual({ status: "not-found" });
    expect(checkIsMember).not.toHaveBeenCalled();
  });

  it("passes through inactive", async () => {
    const result = await run({
      session: null,
      lookup: {
        status: "inactive",
        reason: "expired",
        organizationName: "Acme",
      },
    });
    expect(result).toEqual({
      status: "inactive",
      reason: "expired",
      organizationName: "Acme",
    });
  });

  it("accepted + session + is member returns alreadyMember=true", async () => {
    const result = await run({
      session: { user: { email: "a@x.com" } },
      lookup: {
        status: "accepted",
        organizationId: "org_1",
        organizationName: "Acme",
        invitedEmail: "a@x.com",
      },
      isMember: true,
    });
    expect(result).toEqual({
      status: "accepted",
      organizationName: "Acme",
      alreadyMember: true,
    });
    expect(checkIsMember).toHaveBeenCalledWith("org_1");
  });

  it("accepted + session + not member returns alreadyMember=false", async () => {
    const result = await run({
      session: { user: { email: "a@x.com" } },
      lookup: {
        status: "accepted",
        organizationId: "org_1",
        organizationName: "Acme",
        invitedEmail: "a@x.com",
      },
      isMember: false,
    });
    expect(result).toMatchObject({ alreadyMember: false });
  });

  it("accepted + no session skips membership check", async () => {
    const result = await run({
      session: null,
      lookup: {
        status: "accepted",
        organizationId: "org_1",
        organizationName: "Acme",
        invitedEmail: "a@x.com",
      },
    });
    expect(result).toMatchObject({ alreadyMember: false });
    expect(checkIsMember).not.toHaveBeenCalled();
  });

  it("pending + no session returns unauthenticated", async () => {
    const result = await run({
      session: null,
      lookup: {
        status: "pending",
        organizationId: "org_1",
        organizationName: "Acme",
        invitedEmail: "a@x.com",
        role: "member",
        inviterName: "Gio",
      },
    });
    expect(result).toEqual({
      status: "unauthenticated",
      organizationName: "Acme",
      invitedEmail: "a@x.com",
      inviterName: "Gio",
      role: "member",
    });
  });

  it("pending + matching session returns accept-ready", async () => {
    const result = await run({
      session: { user: { email: "a@x.com" } },
      lookup: {
        status: "pending",
        organizationId: "org_1",
        organizationName: "Acme",
        invitedEmail: "a@x.com",
        role: "admin",
        inviterName: "Gio",
      },
    });
    expect(result).toEqual({
      status: "accept-ready",
      invitationId: "inv_1",
      organizationName: "Acme",
      inviterName: "Gio",
      role: "admin",
    });
  });

  it("email comparison is case-insensitive", async () => {
    const result = await run({
      session: { user: { email: "A@X.com" } },
      lookup: {
        status: "pending",
        organizationId: "org_1",
        organizationName: "Acme",
        invitedEmail: "a@x.COM",
        role: null,
        inviterName: "Gio",
      },
    });
    expect(result.status).toBe("accept-ready");
  });

  it("pending + mismatched session returns wrong-recipient", async () => {
    const result = await run({
      session: { user: { email: "someone.else@x.com" } },
      lookup: {
        status: "pending",
        organizationId: "org_1",
        organizationName: "Acme",
        invitedEmail: "a@x.com",
        role: "member",
        inviterName: "Gio",
      },
    });
    expect(result).toEqual({
      status: "wrong-recipient",
      organizationName: "Acme",
      invitedEmail: "a@x.com",
    });
  });
});
