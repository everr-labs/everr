import { env } from "@/env";

const CC_TIMEOUT_MS = 10_000;

/** A clickety-clack problem+json error mapped to a thrown JS error. */
export class CcApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CcApiError";
  }
}

export type CcMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Bearer-key header for CC's static API-key gate (`CC_API_KEYS` on the CC
 * side). Empty when no key is configured, for a CC instance with auth off.
 */
export function ccAuthHeaders(): Record<string, string> {
  return env.CLICKETY_CLACK_API_KEY
    ? { authorization: `Bearer ${env.CLICKETY_CLACK_API_KEY}` }
    : {};
}

/**
 * Raw transport to the clickety-clack API. Injects the tenant header and the
 * API-key bearer header (when configured), enforces a timeout, and maps CC's
 * problem+json error shape to `CcApiError`. Returns the
 * parsed JSON body (callers validate with Zod). Server-side only — the tenant
 * header is trusted and must never be set from the browser.
 */
export async function ccRequest(
  orgId: string,
  method: CcMethod,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${env.CLICKETY_CLACK_BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "X-CC-Tenant": orgId,
      ...ccAuthHeaders(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(CC_TIMEOUT_MS),
  });

  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as {
      detail?: unknown;
      code?: unknown;
    } | null;
    const code = typeof problem?.code === "string" ? problem.code : "unknown";
    const detail =
      typeof problem?.detail === "string" ? problem.detail : res.statusText;
    throw new CcApiError(res.status, code, detail);
  }

  return res.json();
}
