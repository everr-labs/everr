/**
 * GitHub App authentication and REST API helpers.
 *
 * Provides JWT-based auth, installation token management, and a paginated
 * async generator for GitHub REST API endpoints.
 */

import { createSign } from "node:crypto";
import QuickLRU from "quick-lru";
import { githubEnv } from "@/env/github";
import { serverLogger } from "@/telemetry/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RATE_LIMIT_RETRIES = 3;

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class GitHubApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// GitHub App auth — JWT + installation token
// ---------------------------------------------------------------------------

function createAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 60,
    iss: String(githubEnv.GITHUB_APP_ID),
  };

  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sigInput = `${header}.${body}`;

  const sign = createSign("RSA-SHA256");
  sign.update(sigInput);
  const signature = sign.sign(githubEnv.GITHUB_APP_PRIVATE_KEY, "base64url");

  return `${sigInput}.${signature}`;
}

// GitHub tokens expire after 1 hour; 58-min maxAge gives a 2-min safety buffer.
const installationTokenCache = new QuickLRU<number, string>({
  maxSize: 100,
  maxAge: 58 * 60_000,
});

export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  const cached = installationTokenCache.get(installationId);
  if (cached) {
    return cached;
  }

  const resp = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createAppJwt()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new GitHubApiError(
      resp.status,
      `Failed to create installation token: status=${resp.status} body=${body}`,
    );
  }

  const data = (await resp.json()) as { token: string; expires_at: string };
  installationTokenCache.set(installationId, data.token);
  return data.token;
}

// ---------------------------------------------------------------------------
// GitHub REST API pagination helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function urlPath(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return "unknown";
  }
}

function extractNextLink(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

export async function* paginate<T>(
  token: string,
  url: string,
  itemsKey: string,
): AsyncGenerator<T> {
  let nextUrl: string | null = url;
  let rateLimitRetries = 0;

  while (nextUrl) {
    const resp = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    const isRateLimited =
      resp.status === 429 ||
      (resp.status === 403 &&
        (resp.headers.get("retry-after") !== null ||
          resp.headers.get("x-ratelimit-remaining") === "0"));

    if (isRateLimited) {
      rateLimitRetries++;
      if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
        throw new Error(
          `GitHub API rate limit exceeded after ${MAX_RATE_LIMIT_RETRIES} retries: GET ${nextUrl}`,
        );
      }
      const retryAfter = Number(resp.headers.get("retry-after") ?? "60");
      serverLogger.warn("github.api.rate_limited", {
        "http.response.status_code": resp.status,
        "retry.after.seconds": retryAfter,
        "retry.attempt": rateLimitRetries,
        "retry.max_attempts": MAX_RATE_LIMIT_RETRIES,
        "url.path": urlPath(nextUrl),
      });
      await sleep(retryAfter * 1000);
      continue;
    }

    rateLimitRetries = 0;

    if (!resp.ok) {
      const body = await resp.text();
      throw new GitHubApiError(
        resp.status,
        `GitHub API error: GET ${nextUrl} status=${resp.status} body=${body}`,
      );
    }

    const data = (await resp.json()) as Record<string, T[]>;
    const items = data[itemsKey];
    if (Array.isArray(items)) {
      for (const item of items) {
        yield item;
      }
    }

    nextUrl = extractNextLink(resp.headers.get("link"));
  }
}
