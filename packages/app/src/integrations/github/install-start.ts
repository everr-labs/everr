import { auth } from "@/lib/auth.server";
import { createInstallState } from "@/lib/github-install-state";
import { isOrganizationAdmin } from "@/lib/organization-role";
import { getSession } from "@/lib/session.server";
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
