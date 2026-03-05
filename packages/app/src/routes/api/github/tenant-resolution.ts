import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { getActiveTenantForGithubInstallation } from "@/data/tenants";
import { env } from "@/env";

const ingressTimestampHeader = "x-everr-ingress-timestamp";
const ingressSignatureHeader = "x-everr-ingress-signature-256";
const maxIngressSignatureSkewSeconds = 5 * 60;

function timingSafeStringEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function signIngressRequest(
  secret: string,
  timestamp: string,
  method: string,
  requestURI: string,
): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${method}.${requestURI}`).digest("hex")}`;
}

const ingressSecretMiddleware = createMiddleware().server(
  async ({ request, next }) => {
    const timestamp = request.headers.get(ingressTimestampHeader) ?? "";
    const providedSignature = request.headers.get(ingressSignatureHeader) ?? "";
    if (!timestamp || !providedSignature) {
      return new Response("unauthorized", { status: 401 });
    }

    const timestampSeconds = Number(timestamp);
    if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
      return new Response("unauthorized", { status: 401 });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      Math.abs(nowSeconds - timestampSeconds) > maxIngressSignatureSkewSeconds
    ) {
      return new Response("unauthorized", { status: 401 });
    }

    const requestURL = new URL(request.url);
    const expectedSignature = signIngressRequest(
      env.INGRESS_TENANT_RESOLUTION_SECRET,
      timestamp,
      request.method,
      `${requestURL.pathname}${requestURL.search}`,
    );

    if (!timingSafeStringEqual(expectedSignature, providedSignature)) {
      return new Response("unauthorized", { status: 401 });
    }

    return next();
  },
);

export const Route = createFileRoute("/api/github/tenant-resolution")({
  server: {
    middleware: [ingressSecretMiddleware],
    handlers: {
      GET: async ({ request }) => {
        const requestURL = new URL(request.url);
        const installationIDRaw =
          requestURL.searchParams.get("installation_id");
        const installationID = Number(installationIDRaw);
        if (!Number.isSafeInteger(installationID) || installationID <= 0) {
          return new Response("invalid installation_id", { status: 400 });
        }

        const tenantID =
          await getActiveTenantForGithubInstallation(installationID);
        if (!tenantID) {
          return new Response("tenant not found", { status: 404 });
        }

        return Response.json({ tenant_id: tenantID });
      },
    },
  },
});
