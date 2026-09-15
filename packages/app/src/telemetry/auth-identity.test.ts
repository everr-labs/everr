// @vitest-environment node
import { trace } from "@opentelemetry/api";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { bearer, organization } from "better-auth/plugins";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createIdentityAuthHooks, type ResolvedSession } from "./auth-identity";
import {
  identityLogProcessor,
  identitySpanProcessor,
  withTelemetryIdentityScope,
} from "./identity";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [identitySpanProcessor, new SimpleSpanProcessor(exporter)],
});
provider.register();
const records = new InMemoryLogRecordExporter();
const logProvider = new LoggerProvider({
  processors: [identityLogProcessor, new SimpleLogRecordProcessor(records)],
});
const logger = logProvider.getLogger("auth-identity-test");
beforeEach(() => {
  exporter.reset();
  records.reset();
});
afterAll(async () => {
  await provider.shutdown();
  await logProvider.shutdown();
});
const tracer = trace.getTracer("auth-identity-test");
function createTestAuth(
  afterUpdate = async () => {},
  cookieCache?: NonNullable<BetterAuthOptions["session"]>["cookieCache"],
  resolveInBeforeHook = false,
) {
  const auth = betterAuth({
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      organization: [],
      member: [],
      invitation: [],
    }),
    baseURL: "http://localhost:5173",
    secret: "identity-test-secret-only-never-used-outside-tests",
    emailAndPassword: { enabled: true },
    session: { cookieCache },
    hooks: createIdentityAuthHooks(
      async (
        headers,
      ): Promise<{ response: ResolvedSession | null; headers: Headers }> =>
        auth.api.getSession({ headers, returnHeaders: true }),
    ),
    plugins: [
      {
        id: "early-session",
        hooks: {
          before: [
            {
              matcher: (ctx) =>
                resolveInBeforeHook && ctx.path === "/organization/update",
              handler: createAuthMiddleware(async (ctx) => {
                await getSessionFromCtx(ctx);
              }),
            },
          ],
        },
      },
      bearer(),
      organization({
        organizationHooks: {
          afterUpdateOrganization: async () => {
            await afterUpdate();
            tracer.startActiveSpan("organization-handler", (span) => {
              logger.emit({ body: "organization.updated" });
              span.end();
            });
          },
        },
      }),
    ],
  });
  return auth;
}

it.each([
  "cookie",
  "bearer",
  "signed-bearer",
])("attributes %s sessions and leaves invalid sessions anonymous", async (credential) => {
  const auth = createTestAuth(undefined, undefined, credential === "cookie");
  const signedUp = await auth.api.signUpEmail({
    body: {
      email: "identity@example.test",
      password: "test-password-123",
      name: "Identity Test",
    },
  });
  const response = await auth.handler(
    new Request("http://localhost:5173/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "identity@example.test",
        password: "test-password-123",
      }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const { token } = await response.json();
  const headers = new Headers(
    credential === "cookie"
      ? { cookie }
      : {
          authorization: `Bearer ${credential === "bearer" ? token : response.headers.get("set-auth-token")}`,
        },
  );
  const org = await auth.api.createOrganization({
    headers,
    body: { name: "Identity Test", slug: "identity-test" },
  });
  if (!org) throw new Error("Expected organization to be created");
  await auth.api.setActiveOrganization({
    headers,
    body: { organizationId: org.id },
  });
  const sessionLookup = vi.spyOn(
    (await auth.$context).internalAdapter,
    "findSession",
  );
  await withTelemetryIdentityScope(() =>
    tracer.startActiveSpan("organization-request", async (root) => {
      const response = await auth.handler(
        new Request("http://localhost:5173/api/auth/organization/update", {
          method: "POST",
          headers: {
            ...Object.fromEntries(headers),
            origin: "http://localhost:5173",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            organizationId: org.id,
            data: { name: "Updated" },
          }),
        }),
      );
      expect(response.status).toBe(200);
      root.end();
    }),
  );
  expect(sessionLookup).toHaveBeenCalledTimes(1);
  sessionLookup.mockRestore();
  await withTelemetryIdentityScope(() =>
    tracer.startActiveSpan("authenticated", async (root) => {
      const session = await auth.api.getSession({ headers });
      expect(session?.user.id).toBe(signedUp.user.id);
      tracer.startActiveSpan("child", (span) => span.end());
      root.end();
    }),
  );
  await withTelemetryIdentityScope(() =>
    tracer.startActiveSpan("anonymous", async (root) => {
      expect(
        await auth.api.getSession({
          headers: new Headers(
            credential === "cookie"
              ? { cookie: "better-auth.session_token=invalid" }
              : { authorization: "Bearer invalid" },
          ),
        }),
      ).toBeNull();
      root.end();
    }),
  );
  const attributed = exporter
    .getFinishedSpans()
    .filter((span) =>
      [
        "authenticated",
        "child",
        "organization-request",
        "organization-handler",
      ].includes(span.name),
    );
  expect(attributed).toHaveLength(4);
  for (const span of attributed) {
    expect(span.attributes).toMatchObject({
      "user.id": signedUp.user.id,
      "everr.organization.id": org.id,
    });
    expect(span.attributes).not.toHaveProperty("user.email");
  }
  expect(records.getFinishedLogRecords()).toHaveLength(1);
  expect(records.getFinishedLogRecords()[0].attributes).toEqual({
    "user.id": signedUp.user.id,
    "everr.organization.id": org.id,
  });
  expect(
    exporter.getFinishedSpans().find((span) => span.name === "anonymous")
      ?.attributes,
  ).toEqual({});

  const session = await auth.api.getSession({ headers });
  if (!session) throw new Error("Expected verification session");
  await (await auth.$context).internalAdapter.updateSession(
    session.session.token,
    {
      expiresAt: new Date(Date.now() - 1_000),
    },
  );
  await withTelemetryIdentityScope(() =>
    tracer.startActiveSpan("expired", async (span) => {
      expect(await auth.api.getSession({ headers })).toBeNull();
      span.end();
    }),
  );
  expect(
    exporter.getFinishedSpans().find((span) => span.name === "expired")
      ?.attributes,
  ).toEqual({});
});

it("keeps concurrent authenticated organization requests isolated", async () => {
  let entered = 0;
  let release!: () => void;
  const bothAuthenticated = new Promise<void>((resolve) => {
    release = resolve;
  });
  const auth = createTestAuth(async () => {
    if (++entered === 2) release();
    await bothAuthenticated;
  });
  const callers = [];
  for (const name of ["a", "b"]) {
    const response = await auth.api.signUpEmail({
      body: {
        email: `${name}@example.test`,
        password: "test-password-123",
        name,
      },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const { user } = await response.json();
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const org = await auth.api.createOrganization({
      headers: new Headers({ cookie }),
      body: { name, slug: name },
    });
    if (!org) throw new Error("Expected test organization");
    callers.push({
      headers: new Headers(
        name === "a"
          ? { cookie }
          : {
              authorization: `Bearer ${response.headers.get("set-auth-token")}`,
            },
      ),
      name,
      cookie,
      userId: user.id as string,
      organizationId: org.id,
    });
  }
  exporter.reset();
  records.reset();
  const expected = new Map<string, Record<string, string>>();
  const sessionLookup = vi.spyOn(
    (await auth.$context).internalAdapter,
    "findSession",
  );
  try {
    await Promise.all(
      callers.map((caller) =>
        withTelemetryIdentityScope(() =>
          tracer.startActiveSpan(`request-${caller.name}`, async (span) => {
            expected.set(span.spanContext().traceId, {
              "user.id": caller.userId,
              "everr.organization.id": caller.organizationId,
            });
            try {
              const response = await auth.handler(
                new Request(
                  "http://localhost:5173/api/auth/organization/update",
                  {
                    method: "POST",
                    headers: {
                      ...Object.fromEntries(caller.headers),
                      origin: "http://localhost:5173",
                      "content-type": "application/json",
                    },
                    body: JSON.stringify({
                      organizationId: caller.organizationId,
                      data: { name: `updated-${caller.name}` },
                    }),
                  },
                ),
              );
              expect(response.status).toBe(200);
            } finally {
              span.end();
            }
          }),
        ),
      ),
    );
    expect(sessionLookup).toHaveBeenCalledTimes(2);
  } finally {
    sessionLookup.mockRestore();
  }
  const attributed = exporter
    .getFinishedSpans()
    .filter(
      (span) =>
        span.name.startsWith("request-") ||
        span.name === "organization-handler",
    );
  expect(attributed).toHaveLength(4);
  for (const span of attributed) {
    expect(span.attributes).toEqual(expected.get(span.spanContext().traceId));
  }
  expect(records.getFinishedLogRecords()).toHaveLength(2);
  for (const record of records.getFinishedLogRecords()) {
    expect(record.attributes).toEqual(
      expected.get(record.spanContext?.traceId ?? ""),
    );
  }
});

it.each(
  (["compact", "jwt", "jwe"] as const).flatMap((strategy) =>
    [false, true].map((early) => ({ strategy, early })),
  ),
)("attributes verified $strategy cache hits (before hook: $early) without a session lookup", async ({
  strategy,
  early,
}) => {
  const auth = createTestAuth(undefined, { enabled: true, strategy }, early);
  const signedUp = await auth.api.signUpEmail({
    body: {
      email: "cached@example.test",
      password: "test-password-123",
      name: "Cached",
    },
    asResponse: true,
  });
  const { user, token } = await signedUp.json();
  const headers = new Headers();
  const cookies = new Map<string, string>();
  function acceptCookies(response: Response) {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";")[0];
      const index = pair.indexOf("=");
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    headers.set(
      "cookie",
      [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  }
  acceptCookies(signedUp);
  const org = await auth.api.createOrganization({
    headers,
    body: { name: "Cached", slug: "cached" },
  });
  if (!org) throw new Error("Expected organization");
  acceptCookies(
    await auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
      asResponse: true,
    }),
  );
  const sessionLookup = vi.spyOn(
    (await auth.$context).internalAdapter,
    "findSession",
  );
  try {
    await withTelemetryIdentityScope(() =>
      tracer.startActiveSpan("cached-request", async (span) => {
        try {
          const result = await auth.handler(
            new Request("http://localhost:5173/api/auth/organization/update", {
              method: "POST",
              headers: {
                ...Object.fromEntries(headers),
                origin: "http://localhost:5173",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                organizationId: org.id,
                data: { name: "Updated" },
              }),
            }),
          );
          expect(result.status).toBe(200);
        } finally {
          span.end();
        }
      }),
    );
    expect(sessionLookup).not.toHaveBeenCalled();
  } finally {
    sessionLookup.mockRestore();
  }
  const spans = exporter
    .getFinishedSpans()
    .filter((span) =>
      ["cached-request", "organization-handler"].includes(span.name),
    );
  expect(spans).toHaveLength(2);
  for (const span of spans)
    expect(span.attributes).toEqual({
      "user.id": user.id,
      "everr.organization.id": org.id,
    });
  expect(records.getFinishedLogRecords()).toHaveLength(1);
  expect(records.getFinishedLogRecords()[0].attributes).toEqual({
    "user.id": user.id,
    "everr.organization.id": org.id,
  });

  // A valid cache must not satisfy an endpoint's authoritative session check.
  await (await auth.$context).internalAdapter.deleteSession(token);
  const authoritativeLookup = vi.spyOn(
    (await auth.$context).internalAdapter,
    "findSession",
  );
  const revoked = await auth.handler(
    new Request("http://localhost:5173/api/auth/revoke-sessions", {
      method: "POST",
      headers: {
        ...Object.fromEntries(headers),
        origin: "http://localhost:5173",
      },
    }),
  );
  expect(revoked.status).toBe(401);
  expect(authoritativeLookup).toHaveBeenCalledTimes(1);
  authoritativeLookup.mockRestore();
});

it("skips session lookups for requests without credentials and attributes sign-up", async () => {
  const auth = createTestAuth();
  const lookup = vi.spyOn((await auth.$context).internalAdapter, "findSession");
  await withTelemetryIdentityScope(() =>
    tracer.startActiveSpan("signup", async (span) => {
      const result = await auth.api.signUpEmail({
        headers: new Headers(),
        body: {
          email: "new@example.test",
          password: "test-password-123",
          name: "New",
        },
      });
      span.end();
      expect(
        exporter.getFinishedSpans().find((span) => span.name === "signup")
          ?.attributes["user.id"],
      ).toBe(result.user.id);
    }),
  );
  expect(lookup).not.toHaveBeenCalled();
  lookup.mockRestore();
});

it("forwards session refresh cookies while reusing the lookup", async () => {
  const auth = createTestAuth();
  const signedUp = await auth.api.signUpEmail({
    body: {
      email: "refresh@example.test",
      password: "test-password-123",
      name: "Refresh",
    },
    asResponse: true,
  });
  const { token } = await signedUp.json();
  const headers = new Headers({
    cookie: signedUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  });
  const org = await auth.api.createOrganization({
    headers,
    body: { name: "Refresh", slug: "refresh" },
  });
  if (!org) throw new Error("Expected organization");
  const adapter = (await auth.$context).internalAdapter;
  await adapter.updateSession(token, {
    expiresAt: new Date(Date.now() + 60_000),
  });
  const lookup = vi.spyOn(adapter, "findSession");
  const response = await auth.handler(
    new Request("http://localhost:5173/api/auth/organization/update", {
      method: "POST",
      headers: {
        ...Object.fromEntries(headers),
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        organizationId: org.id,
        data: { name: "Refreshed" },
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect(lookup).toHaveBeenCalledTimes(1);
  lookup.mockRestore();
  expect(
    response.headers
      .getSetCookie()
      .some((value) => value.startsWith("better-auth.session_token=")),
  ).toBe(true);
  expect(response.headers.get("cache-control")).toBeNull();

  await adapter.updateSession(token, {
    expiresAt: new Date(Date.now() + 60_000),
  });
  const signedOut = await auth.handler(
    new Request("http://localhost:5173/api/auth/sign-out", {
      method: "POST",
      headers: {
        ...Object.fromEntries(headers),
        origin: "http://localhost:5173",
      },
    }),
  );
  expect(signedOut.status).toBe(200);
  const sessionCookies = signedOut.headers
    .getSetCookie()
    .filter((cookie) => cookie.startsWith("better-auth.session_token="));
  expect(sessionCookies).toHaveLength(1);
  expect(sessionCookies[0]).toContain("Max-Age=0");
});
