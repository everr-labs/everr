import { verify } from "@octokit/webhooks-methods";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { githubInstallationOrganizations } from "@/db/schema";
import { env } from "@/env";
import { headersToRecord } from "./headers";
import { enqueueWebhookEvent } from "./runtime";

const logger = logs.getLogger("@everr/app/github-events/webhook");

const installationEventSchema = z.object({
  action: z.string().optional(),
  installation: z
    .object({
      id: z.number().int().positive().optional(),
    })
    .optional(),
});

async function setGithubInstallationStatus(
  installationId: number,
  newStatus: "active" | "suspended" | "uninstalled",
): Promise<void> {
  await db
    .update(githubInstallationOrganizations)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(
      eq(githubInstallationOrganizations.githubInstallationId, installationId),
    );
}

async function handleInstallationEvent(args: {
  eventType: string;
  bodyText: string;
}): Promise<Response> {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(args.bodyText);
  } catch {
    logger.emit({
      severityNumber: SeverityNumber.WARN,
      severityText: "WARN",
      body: "github webhook: invalid json payload",
      attributes: { "github.event.type": args.eventType },
    });
    return new Response("invalid json payload", { status: 400 });
  }

  const parsed = installationEventSchema.safeParse(parsedBody);
  if (!parsed.success) {
    logger.emit({
      severityNumber: SeverityNumber.WARN,
      severityText: "WARN",
      body: "github webhook: invalid installation payload shape",
      attributes: {
        "github.event.type": args.eventType,
        "validation.error": parsed.error.message,
      },
    });
    return new Response("invalid payload shape", { status: 400 });
  }

  const installationId = parsed.data.installation?.id;
  if (!installationId) {
    logger.emit({
      severityNumber: SeverityNumber.WARN,
      severityText: "WARN",
      body: "github webhook: installation event missing installation.id",
      attributes: {
        "github.event.type": args.eventType,
        "github.event.action": parsed.data.action,
      },
    });
    return new Response("missing installation.id", { status: 400 });
  }

  if (args.eventType === "installation") {
    const nextStatus =
      parsed.data.action === "deleted"
        ? "uninstalled"
        : parsed.data.action === "suspend"
          ? "suspended"
          : parsed.data.action === "unsuspend"
            ? "active"
            : null;

    if (nextStatus) {
      await setGithubInstallationStatus(installationId, nextStatus);
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "github installation: status updated",
        attributes: {
          "github.installation_id": installationId,
          "github.event.action": parsed.data.action,
          "github.installation.status": nextStatus,
        },
      });
    } else {
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "github installation: event received (no status change)",
        attributes: {
          "github.installation_id": installationId,
          "github.event.action": parsed.data.action,
        },
      });
    }
  } else {
    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: "github installation: repositories event received",
      attributes: {
        "github.installation_id": installationId,
        "github.event.type": args.eventType,
        "github.event.action": parsed.data.action,
      },
    });
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

  await enqueueWebhookEvent(eventId, {
    headers: headersToRecord(request.headers),
    body: body.toString("base64"),
  });

  return new Response(null, { status: 202 });
}
