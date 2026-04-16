export type InvitationLookup =
  | { status: "not-found" }
  | {
      status: "inactive";
      reason: "expired" | "canceled" | "rejected";
      organizationName: string;
    }
  | {
      status: "accepted";
      organizationId: string;
      organizationName: string;
      invitedEmail: string;
    }
  | {
      status: "pending";
      organizationId: string;
      organizationName: string;
      invitedEmail: string;
      role: string | null;
      inviterName: string;
    };

export type InvitationRow = {
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  organizationId: string;
  organizationName: string;
  inviterName: string;
};

export function deriveInvitationLookup(
  row: InvitationRow | undefined,
  now: Date = new Date(),
): InvitationLookup {
  if (!row) return { status: "not-found" };

  if (row.status === "accepted") {
    return {
      status: "accepted",
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      invitedEmail: row.email,
    };
  }

  if (row.status === "canceled" || row.status === "rejected") {
    return {
      status: "inactive",
      reason: row.status,
      organizationName: row.organizationName,
    };
  }

  if (row.expiresAt < now) {
    return {
      status: "inactive",
      reason: "expired",
      organizationName: row.organizationName,
    };
  }

  return {
    status: "pending",
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    invitedEmail: row.email,
    role: row.role,
    inviterName: row.inviterName,
  };
}

export type InviteLoaderSession = { user: { email: string } } | null;

export type InviteLoaderResult =
  | { status: "not-found" }
  | {
      status: "inactive";
      reason: "expired" | "canceled" | "rejected";
      organizationName: string;
    }
  | {
      status: "accepted";
      organizationName: string;
      alreadyMember: boolean;
    }
  | {
      status: "unauthenticated";
      organizationName: string;
      invitedEmail: string;
      inviterName: string;
      role: string | null;
    }
  | {
      status: "accept-ready";
      invitationId: string;
      organizationName: string;
      inviterName: string;
      role: string | null;
    }
  | {
      status: "wrong-recipient";
      organizationName: string;
      invitedEmail: string;
    };

export async function resolveInvitationLoader({
  invitationId,
  session,
  lookup,
  checkIsMember,
}: {
  invitationId: string;
  session: InviteLoaderSession;
  lookup: InvitationLookup;
  checkIsMember: (organizationId: string) => Promise<boolean>;
}): Promise<InviteLoaderResult> {
  if (lookup.status === "not-found") return { status: "not-found" };
  if (lookup.status === "inactive") return lookup;

  if (lookup.status === "accepted") {
    const alreadyMember = session
      ? await checkIsMember(lookup.organizationId)
      : false;
    return {
      status: "accepted",
      organizationName: lookup.organizationName,
      alreadyMember,
    };
  }

  if (!session) {
    return {
      status: "unauthenticated",
      organizationName: lookup.organizationName,
      invitedEmail: lookup.invitedEmail,
      inviterName: lookup.inviterName,
      role: lookup.role,
    };
  }

  if (session.user.email.toLowerCase() !== lookup.invitedEmail.toLowerCase()) {
    return {
      status: "wrong-recipient",
      organizationName: lookup.organizationName,
      invitedEmail: lookup.invitedEmail,
    };
  }

  return {
    status: "accept-ready",
    invitationId,
    organizationName: lookup.organizationName,
    inviterName: lookup.inviterName,
    role: lookup.role,
  };
}
