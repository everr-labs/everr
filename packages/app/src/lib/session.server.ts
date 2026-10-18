import { auth } from "#app/lib/auth.server.ts";
import { resolveSessionOrganization } from "#app/lib/session-organization.server.ts";

export async function getSession({ headers }: { headers: Headers }) {
  const session = await auth.api.getSession({ headers });
  if (!session?.user || !session.session) return null;
  const selection = await resolveSessionOrganization(session.session);
  if (!selection) return null;
  return {
    ...session,
    session: { ...session.session, ...selection },
  };
}
