import { CcApiError } from "@/data/cc/errors";
import { env } from "@/env";

export { CcApiError };

// CC's channel-test deadline (`TEST_SEND_TIMEOUT` in
// crates/clickety-clack/src/api/channels.rs) is deliberately set below this
// value so CC answers first with a truthful `ok:false` instead of this
// timeout aborting the request. Lowering CC_TIMEOUT_MS would start cutting
// off channel tests CC would otherwise have answered.
const CC_TIMEOUT_MS = 10_000;

export type CcMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Bearer-key header for CC's static API-key gate (`CC_API_KEYS` on the CC
 * side). Empty when no key is configured, for a CC instance with auth off.
 * Only `ccRequest` below sends it.
 */
function ccAuthHeaders(): Record<string, string> {
  return env.CLICKETY_CLACK_API_KEY
    ? { authorization: `Bearer ${env.CLICKETY_CLACK_API_KEY}` }
    : {};
}

/**
 * Raw transport to the clickety-clack API. Injects the tenant header and the
 * API-key bearer header (when configured), enforces a timeout, and maps CC's
 * problem+json error shape — and transport-level network/timeout failures — to
 * `CcApiError`. Returns the parsed JSON body (callers validate with Zod).
 * Server-side only — the tenant header is trusted and must never be set from
 * the browser.
 */
export async function ccRequest(
  orgId: string,
  method: CcMethod,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${env.CLICKETY_CLACK_BASE_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "X-CC-Tenant": orgId,
        ...ccAuthHeaders(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CC_TIMEOUT_MS),
    });
  } catch (error) {
    // Stable message prefixes: callers and log searches key on them.
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new CcApiError(
        0,
        "timeout",
        `clickety-clack request timed out: ${error.message}`,
      );
    }
    if (error instanceof TypeError) {
      throw new CcApiError(
        0,
        "unreachable",
        `clickety-clack unreachable: ${error.message}`,
      );
    }
    throw error;
  }

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
