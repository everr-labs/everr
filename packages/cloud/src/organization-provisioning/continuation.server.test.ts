// @vitest-environment node
import type { GenericEndpointContext } from "better-auth";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  getOrganizationEntryRedirect,
  markOrganizationCreated,
  ORGANIZATION_CREATION_COOKIE,
  readCreatedOrganizationId,
} from "./continuation.server";

const state = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: () => state.cookie,
}));
afterEach(() => {
  vi.useRealTimers();
  state.cookie = undefined;
});
async function marker() {
  const setCookie = vi.fn();
  await markOrganizationCreated({ id: "session", activeOrganizationId: "org" }, {
    setCookie,
  } as unknown as GenericEndpointContext);
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

it("resolves setup only for the session and organization that created the marker", async () => {
  state.cookie = await marker();
  expect(
    await getOrganizationEntryRedirect({
      id: "session",
      activeOrganizationId: "org",
    }),
  ).toEqual({ to: "/organization-setup" });
  expect(
    await getOrganizationEntryRedirect({
      id: "other-session",
      activeOrganizationId: "org",
    }),
  ).toBeUndefined();
  expect(
    await getOrganizationEntryRedirect({
      id: "session",
      activeOrganizationId: "other-org",
    }),
  ).toBeUndefined();
});
it("continues normally without an organization creation marker", async () => {
  expect(
    await getOrganizationEntryRedirect({
      id: "session",
      activeOrganizationId: "org",
    }),
  ).toBeUndefined();
});
