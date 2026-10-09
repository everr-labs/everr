// @vitest-environment node
import type { GenericEndpointContext } from "better-auth";
import { afterEach, expect, it, vi } from "vitest";
import {
  markOrganizationCreated,
  ORGANIZATION_CREATION_COOKIE,
  readCreatedOrganizationId,
} from "./organization-creation-continuation.server";

afterEach(() => vi.useRealTimers());
async function marker() {
  const setCookie = vi.fn();
  await markOrganizationCreated(
    { id: "session", activeOrganizationId: "org" },
    { setCookie } as unknown as GenericEndpointContext,
  );
  expect(setCookie).toHaveBeenCalledWith(
    ORGANIZATION_CREATION_COOKIE,
    expect.any(String),
    expect.objectContaining({
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    }),
  );
  return setCookie.mock.calls[0][1] as string;
}
it("records creation for the matching session and organization", async () => {
  const cookie = await marker();
  expect(
    await readCreatedOrganizationId(cookie, {
      id: "session",
      activeOrganizationId: "org",
    }),
  ).toBe("org");
});
it("ignores stale sessions, organization switches, tampering, and signed-out requests", async () => {
  const cookie = await marker();
  expect(
    await readCreatedOrganizationId(cookie, {
      id: "other",
      activeOrganizationId: "org",
    }),
  ).toBeNull();
  expect(
    await readCreatedOrganizationId(cookie, {
      id: "session",
      activeOrganizationId: "other",
    }),
  ).toBeNull();
  expect(
    await readCreatedOrganizationId(`${cookie}tampered`, {
      id: "session",
      activeOrganizationId: "org",
    }),
  ).toBeNull();
  expect(await readCreatedOrganizationId(cookie, undefined)).toBeNull();
});
it("expires even if the cookie is retained past its browser lifetime", async () => {
  vi.useFakeTimers();
  const cookie = await marker();
  vi.advanceTimersByTime(600_001);
  expect(
    await readCreatedOrganizationId(cookie, {
      id: "session",
      activeOrganizationId: "org",
    }),
  ).toBeNull();
});
