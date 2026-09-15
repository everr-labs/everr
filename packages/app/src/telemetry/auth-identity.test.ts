// @vitest-environment node
import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { afterAll, expect, it } from "vitest";
import { identityAuthHooks } from "./auth-identity";
import {
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
afterAll(() => provider.shutdown());
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
  plugins: [organization()],
  hooks: identityAuthHooks,
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
  for (const span of exporter
    .getFinishedSpans()
    .filter((span) => ["authenticated", "child"].includes(span.name))) {
    expect(span.attributes).toMatchObject({
      "user.id": signedUp.user.id,
      "everr.organization.id": org.id,
    });
    expect(span.attributes).not.toHaveProperty("user.email");
  }
  expect(
    exporter.getFinishedSpans().find((span) => span.name === "anonymous")
      ?.attributes,
  ).toEqual({});
});
