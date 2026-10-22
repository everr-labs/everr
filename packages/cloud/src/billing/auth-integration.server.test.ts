// @vitest-environment node
import { betterAuth } from "better-auth";
import { type MemoryDB, memoryAdapter } from "better-auth/adapters/memory";
import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  beforeUserUpdate: vi.fn(),
  afterUserUpdate: vi.fn(),
  beforeMembershipChange: vi.fn(),
  afterMembershipChange: vi.fn(),
}));
vi.mock("./server", () => ({ billing: mocks }));
vi.mock("./lock.server", () => ({
  withBillingRequest: (run: () => Promise<unknown>) => run(),
}));

import { billingIdentityAdapter } from "./auth-adapter.server";

it("uses the actual update target for authenticated profile and anonymous verified-email changes", async () => {
  vi.clearAllMocks();
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  let verificationUrl = "";
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "billing-auth-integration-secret-long-enough",
    database: billingIdentityAdapter(memoryAdapter(db)),
    emailAndPassword: { enabled: true },
    user: { changeEmail: { enabled: true } },
    emailVerification: {
      sendVerificationEmail: async ({ url }) => {
        verificationUrl = url;
      },
    },
  });
  const response = await auth.api.signUpEmail({
    body: {
      email: "old@example.com",
      name: "Owner",
      password: "password-12345",
    },
    asResponse: true,
  });
  const headers = new Headers({
    cookie: response.headers.get("set-cookie") ?? "",
  });
  const owner = db.user[0];
  owner.emailVerified = true;
  await auth.api.updateUser({ headers, body: { name: "Renamed" } });
  expect(mocks.beforeUserUpdate).toHaveBeenCalledWith(
    owner.id,
    expect.objectContaining({ name: "Renamed" }),
  );
  await auth.api.changeEmail({
    headers,
    body: { newEmail: "new@example.com" },
  });
  const token = new URL(verificationUrl).searchParams.get("token");
  if (!token) throw new Error("Verification token missing");
  mocks.beforeUserUpdate.mockClear();
  await auth.api.verifyEmail({ query: { token } });
  expect(mocks.beforeUserUpdate).toHaveBeenCalledWith(
    owner.id,
    expect.objectContaining({ email: "new@example.com", emailVerified: true }),
  );
  expect(mocks.afterUserUpdate).toHaveBeenCalledWith(owner.id);
  expect(db.user[0].email).toBe("new@example.com");
});
