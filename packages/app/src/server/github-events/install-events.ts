import { z } from "zod";
import { setGithubInstallationStatus } from "@/data/tenants";

const installationEventSchema = z.object({
  action: z.string().optional(),
  installation: z
    .object({
      id: z.number().int().positive().optional(),
    })
    .optional(),
});

export async function handleInstallationEvent(args: {
  eventType: string;
  bodyText: string;
}): Promise<Response> {
  if (
    args.eventType !== "installation" &&
    args.eventType !== "installation_repositories"
  ) {
    return new Response("ignored", { status: 202 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(args.bodyText);
  } catch {
    return new Response("invalid json payload", { status: 400 });
  }

  const parsed = installationEventSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return new Response("invalid payload shape", { status: 400 });
  }

  const installationId = parsed.data.installation?.id;
  if (!installationId) {
    return new Response("missing installation.id", { status: 400 });
  }

  if (args.eventType === "installation") {
    if (parsed.data.action === "deleted") {
      await setGithubInstallationStatus(installationId, "uninstalled");
    } else if (parsed.data.action === "suspend") {
      await setGithubInstallationStatus(installationId, "suspended");
    } else if (parsed.data.action === "unsuspend") {
      await setGithubInstallationStatus(installationId, "active");
    }
  }

  return new Response(null, { status: 202 });
}
