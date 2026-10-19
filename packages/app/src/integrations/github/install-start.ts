import { auth } from "#app/identity/server.ts";
import { createInstallState } from "#app/lib/github-install-state.ts";
import { isOrganizationAdmin } from "#app/lib/organization-role.ts";
import { getSession } from "#app/lib/session.server.ts";
import { getGithubConfiguration } from "./configuration";

export async function handleInstallStart(request: Request): Promise<Response> {
  const configuration = getGithubConfiguration();
  if (!configuration) return new Response("Not found", { status: 404 });
  const session = await getSession({
    headers: request.headers,
  });
  if (!session?.user) {
    return new Response("unauthenticated", { status: 401 });
  }
  const activeOrgId = session.session.activeOrganizationId;
  if (!activeOrgId) {
    return new Response("missing active organization", {
      status: 400,
    });
  }
  const { role } = await auth.api.getActiveMemberRole({
    headers: request.headers,
  });
  if (!isOrganizationAdmin(role)) {
    return new Response("not authorized", { status: 403 });
  }

  const installURL = new URL(configuration.GITHUB_APP_INSTALL_URL);
  installURL.searchParams.set(
    "state",
    createInstallState({
      organizationId: activeOrgId,
      userId: session.user.id,
    }),
  );

  return Response.redirect(installURL.toString(), 302);
}
