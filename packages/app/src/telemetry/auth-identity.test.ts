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
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { afterAll, expect, it, vi } from "vitest";
import { identityAuthHooks } from "./auth-identity";
import {
  createIdentityLogProcessor,
  createIdentitySpanProcessor,
  withTelemetryIdentityScope,
} from "./identity";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [
    createIdentitySpanProcessor(),
    new SimpleSpanProcessor(exporter),
  ],
});
provider.register();
const records = new InMemoryLogRecordExporter();
const logProvider = new LoggerProvider({
  processors: [
    createIdentityLogProcessor(),
    new SimpleLogRecordProcessor(records),
  ],
});
const logger = logProvider.getLogger("auth-identity-test");
afterAll(async () => {
  await provider.shutdown();
  await logProvider.shutdown();
});
const tracer = trace.getTracer("auth-identity-test");
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
  hooks: identityAuthHooks,
  plugins: [
    organization({
      organizationHooks: {
        afterUpdateOrganization: async () => {
          tracer.startActiveSpan("organization-handler", (span) => {
            logger.emit({ body: "organization.updated" });
            span.end();
          });
        },
      },
    }),
  ],
});

it("attributes real authenticated session lookups and leaves invalid sessions anonymous", async () => {
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
  const headers = new Headers({ cookie });
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
            cookie,
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
          headers: new Headers({ cookie: "better-auth.session_token=invalid" }),
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
