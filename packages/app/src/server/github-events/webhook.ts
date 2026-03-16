import { verify } from "@octokit/webhooks-methods";
import { z } from "zod";
import { setGithubInstallationStatus } from "@/data/tenants";
import { env } from "@/env";
import { GH_EVENTS_CONFIG } from "./config";
import { headersToRecord } from "./headers";
import { getBoss, startGitHubEventsRuntime } from "./runtime";
import type { WebhookJobData } from "./types";

const installationEventSchema = z.object({
  action: z.string().optional(),
  installation: z
    .object({
      id: z.number().int().positive().optional(),
    })
    .optional(),
});

async function handleInstallationEvent(args: {
  eventType: string;
  bodyText: string;
}): Promise<Response> {
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

export async function handleGitHubWebhookRequest(
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const signatureHeader = request.headers.get("x-hub-signature-256");
  if (!signatureHeader) {
    return new Response("missing signature", { status: 401 });
  }

  const bodyText = await request.text();
  if (
    !(await verify(env.GITHUB_APP_WEBHOOK_SECRET, bodyText, signatureHeader))
  ) {
    return new Response("invalid signature", { status: 401 });
  }

  const eventId = request.headers.get("x-github-delivery")?.trim() ?? "";
  if (!eventId) {
    return new Response("missing x-github-delivery", { status: 400 });
  }

  const eventType = request.headers.get("x-github-event")?.trim() ?? "";
  if (!eventType) {
    return new Response("missing x-github-event", { status: 400 });
  }

  if (
    eventType === "installation" ||
    eventType === "installation_repositories"
  ) {
    return handleInstallationEvent({ eventType, bodyText });
  }

  if (eventType !== "workflow_run" && eventType !== "workflow_job") {
    return new Response(null, { status: 202 });
  }

  const body = Buffer.from(bodyText, "utf8");
  const jobData: WebhookJobData = {
    headers: headersToRecord(request.headers),
    body: body.toString("base64"),
  };

  let boss = getBoss();
  if (!boss) {
    boss = await startGitHubEventsRuntime();
  }

  const results = await Promise.all(
    (["gh-collector", "gh-status"] as const).map((queue) =>
      boss.send(queue, jobData, {
        id: eventId,
        retryLimit: GH_EVENTS_CONFIG.maxAttempts,
        retryBackoff: true,
      }),
    ),
  );

  // null = deduped (already queued), non-null = inserted
  const anyInserted = results.some((result) => result !== null);
  return new Response(null, { status: anyInserted ? 202 : 200 });
}
