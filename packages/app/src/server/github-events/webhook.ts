import { createHash } from "node:crypto";
import { verify } from "@octokit/webhooks-methods";
import { getGitHubEventsConfig } from "./config";
import { headersToRecord } from "./headers";
import { handleInstallationEvent } from "./install-events";
import { getWebhookEventStore, type WebhookEventStore } from "./queue-store";
import {
  githubEventSource,
  topicCDEvents,
  topicCollector,
  type WebhookTopic,
} from "./types";

function topicsForEventType(eventType: string): WebhookTopic[] {
  if (eventType === "workflow_run" || eventType === "workflow_job") {
    return [topicCollector, topicCDEvents];
  }

  return [];
}

type WebhookHandlerDependencies = {
  store?: WebhookEventStore;
  installHandler?: typeof handleInstallationEvent;
};

export async function handleGitHubWebhookRequest(
  request: Request,
  dependencies: WebhookHandlerDependencies = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("missing webhook secret", { status: 500 });
  }

  const signatureHeader = request.headers.get("x-hub-signature-256");
  if (!signatureHeader) {
    return new Response("missing signature", { status: 401 });
  }

  const bodyText = await request.text();
  if (!(await verify(webhookSecret, bodyText, signatureHeader))) {
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
    const installHandler =
      dependencies.installHandler ?? handleInstallationEvent;
    return installHandler({
      eventType,
      bodyText,
    });
  }

  const topics = topicsForEventType(eventType);
  if (topics.length === 0) {
    return new Response(null, { status: 202 });
  }

  const body = Buffer.from(bodyText, "utf8");
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  const store = dependencies.store ?? getWebhookEventStore();
  const enqueueStatus = await store.enqueueEvent({
    source: getGitHubEventsConfig().source || githubEventSource,
    eventId,
    bodySha256,
    topics,
    headers: headersToRecord(request.headers),
    body,
  });

  if (enqueueStatus === "inserted") {
    return new Response(null, { status: 202 });
  }

  if (enqueueStatus === "duplicate") {
    return new Response(null, { status: 200 });
  }

  return new Response("event conflict", { status: 409 });
}
