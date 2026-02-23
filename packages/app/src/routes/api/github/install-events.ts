import { verify } from "@octokit/webhooks-methods";
import { createFileRoute } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { z } from "zod";

import { setGithubInstallationStatus } from "@/data/tenants";

const InstallationEventPayloadSchema = z.object({
  action: z.string().optional(),
  installation: z
    .object({
      id: z.number().int().positive().optional(),
    })
    .optional(),
});

const verifyGithubInstallEventWebhook = createMiddleware().server<{
  eventType: "installation" | "installation_repositories";
  action?: string;
  installationId: number;
}>(async ({ request, next }) => {
  const eventType = request.headers.get("x-github-event") ?? "";
  if (
    eventType !== "installation" &&
    eventType !== "installation_repositories"
  ) {
    return new Response("ignored", { status: 202 });
  }

  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("missing webhook secret", { status: 500 });
  }

  const signatureHeader = request.headers.get("x-hub-signature-256");
  if (!signatureHeader) {
    return new Response("missing signature", { status: 401 });
  }

  const body = await request.text();
  if (!(await verify(webhookSecret, body, signatureHeader))) {
    return new Response("invalid signature", { status: 401 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return new Response("invalid json payload", { status: 400 });
  }

  const parsedPayload = InstallationEventPayloadSchema.safeParse(parsedJson);
  if (!parsedPayload.success) {
    return new Response("invalid payload shape", { status: 400 });
  }

  const installationId = parsedPayload.data.installation?.id;
  if (!installationId) {
    return new Response("missing installation.id", { status: 400 });
  }

  return next({
    context: {
      eventType,
      action: parsedPayload.data.action,
      installationId,
    },
  });
});

export const Route = createFileRoute("/api/github/install-events")({
  server: {
    handlers: ({ createHandlers }) =>
      createHandlers({
        POST: {
          middleware: [verifyGithubInstallEventWebhook],
          handler: async ({ context }) => {
            // Installation lifecycle events update persisted installation status.
            if (context.eventType === "installation") {
              if (context.action === "deleted") {
                await setGithubInstallationStatus(
                  context.installationId,
                  "uninstalled",
                );
              } else if (context.action === "suspend") {
                await setGithubInstallationStatus(
                  context.installationId,
                  "suspended",
                );
              } else if (context.action === "unsuspend") {
                await setGithubInstallationStatus(
                  context.installationId,
                  "active",
                );
              }
            }

            return new Response(null, { status: 202 });
          },
        },
      }),
  },
});
