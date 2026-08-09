/**
 * Who performed an alerting mutation. Always derived on the server from the
 * authenticated principal, never from request input: the alert-suppression
 * trail is only worth keeping if it cannot be spoofed.
 *
 * `system` covers unattended changes, such as an automatic silence expiry,
 * and carries no id because no principal made them.
 */
export type AlertingActor = {
  kind: "user" | "apikey" | "system";
  id: string;
  display: string;
};

/** The actor for unattended alerting changes. */
export const SYSTEM_ACTOR: AlertingActor = {
  kind: "system",
  id: "",
  display: "system",
};

/**
 * What every alerting mutation takes: the organization it writes to, and the
 * principal it writes on behalf of. Reads keep taking the organization id
 * alone, because nothing about a read is attributable.
 */
export type AlertingMutationScope = {
  organizationId: string;
  actor: AlertingActor;
};

type AlertingSessionContext = {
  session: { activeOrganizationId: string };
  user: { id: string; name?: string | null; email?: string | null };
  /**
   * Set on the apply path only, where the principal can be an API key and
   * `user.id` therefore holds the principal string, not a user id.
   */
  principalId?: string;
};

export function alertingOrganizationId(session: {
  session: { activeOrganizationId: string };
}): string {
  return session.session.activeOrganizationId;
}

/**
 * Parse the canonical `ApplyAuth.principalId` form (`user:<id>` or
 * `apikey:<id>`). Throws on any other shape: every value is built by
 * `resolveApplyAuth`, so a malformed one is a bug, and guessing would
 * attribute the change to the wrong principal.
 */
export function parseAlertingPrincipal(principalId: string): AlertingActor {
  const separator = principalId.indexOf(":");
  const kind = principalId.slice(0, separator);
  const id = principalId.slice(separator + 1);
  if ((kind !== "user" && kind !== "apikey") || id === "") {
    throw new Error(`Unrecognized principal id: ${principalId}`);
  }
  // An API key cannot be attributed to a person: the key table has no owner
  // column, so the principal string is the most the display can say.
  return { kind, id, display: principalId };
}

function alertingActor(session: AlertingSessionContext): AlertingActor {
  if (session.principalId !== undefined) {
    return parseAlertingPrincipal(session.principalId);
  }
  return {
    kind: "user",
    id: session.user.id,
    display: session.user.name || session.user.email || session.user.id,
  };
}

/** Narrow an authenticated session to the scope an alerting mutation needs. */
export function alertingMutationScope(
  session: AlertingSessionContext,
): AlertingMutationScope {
  return {
    organizationId: alertingOrganizationId(session),
    actor: alertingActor(session),
  };
}
