// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Database } from "#app/db/client.ts";

const state = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("#app/db/client.ts", () => ({
  get db() {
    return state.database;
  },
}));
vi.unmock("#app/lib/session.server.ts");

import { auth } from "#app/identity/server.ts";
import { getSession } from "#app/lib/session.server.ts";
import { resolveSessionOrganization } from "#app/lib/session-organization.server.ts";

const client = new PGlite();
const database = drizzle(client) as unknown as Database;
state.database = database;
await client.exec(`
CREATE TABLE organization (id text PRIMARY KEY, name text NOT NULL DEFAULT '', metadata text);
CREATE TABLE member (id text PRIMARY KEY, organization_id text REFERENCES organization(id), user_id text, role text NOT NULL DEFAULT 'member');
CREATE TABLE session (id text PRIMARY KEY, user_id text, active_organization_id text, expires_at timestamp NOT NULL, updated_at timestamp NOT NULL DEFAULT now());
`);
afterAll(() => client.close());
beforeEach(async () => {
  vi.clearAllMocks();
  await client.exec(`
    TRUNCATE member, organization, session CASCADE;
    INSERT INTO organization(id) VALUES ('one'), ('two'), ('three');
    INSERT INTO session(id, user_id, active_organization_id, expires_at)
      VALUES ('session', 'user', NULL, now() + interval '1 hour');
  `);
});
const identity = {
  id: "session",
  userId: "user",
  activeOrganizationId: null as string | null,
};
async function memberships(...ids: string[]) {
  for (const id of ids)
    await client.query("INSERT INTO member(id, organization_id, user_id) VALUES ($1, $2, 'user')", [
      id,
      id,
    ]);
}
async function selected() {
  return (
    await client.query<{ active_organization_id: string | null }>(
      "SELECT active_organization_id FROM session WHERE id = 'session'",
    )
  ).rows[0]?.active_organization_id;
}

it("recovers and persists the only workspace for the authenticated request", async () => {
  await memberships("one");
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "user" },
    session: identity,
  } as never);
  const headers = new Headers();
  const result = await getSession({ headers });
  expect(result?.session.activeOrganizationId).toBe("one");
  expect(await selected()).toBe("one");
  expect(auth.api.getSession).toHaveBeenCalledWith({ headers });
});

it("preserves a valid choice even when the user belongs to multiple workspaces", async () => {
  await memberships("one", "two");
  await client.exec("UPDATE session SET active_organization_id = 'two'");
  expect(
    await resolveSessionOrganization({ ...identity, activeOrganizationId: "two" }, database),
  ).toEqual({ activeOrganizationId: "two" });
  expect(await selected()).toBe("two");
});

it("recovers the remaining membership after the selected membership is revoked", async () => {
  await memberships("two");
  await client.exec("UPDATE session SET active_organization_id = 'one'");
  expect(
    await resolveSessionOrganization({ ...identity, activeOrganizationId: "one" }, database),
  ).toEqual({ activeOrganizationId: "two" });
  expect(await selected()).toBe("two");
});

it.each([{ ids: [] }, { ids: ["two", "three"] }])(
  "clears a revoked selection without guessing or creating access (%j)",
  async ({ ids }) => {
    await memberships(...ids);
    await client.exec("UPDATE session SET active_organization_id = 'one'");
    expect(
      await resolveSessionOrganization({ ...identity, activeOrganizationId: "one" }, database),
    ).toEqual({ activeOrganizationId: null });
    expect(await selected()).toBeNull();
    expect((await client.query("SELECT * FROM member")).rows).toHaveLength(ids.length);
  },
);

it("leaves multiple memberships unselected", async () => {
  await memberships("one", "two");
  expect(await resolveSessionOrganization(identity, database)).toEqual({
    activeOrganizationId: null,
  });
  expect(await selected()).toBeNull();
});

it("preserves a newer selection when recovering an older session snapshot", async () => {
  await memberships("one", "two");
  await client.exec("UPDATE session SET active_organization_id = 'two'");
  expect(await resolveSessionOrganization(identity, database)).toEqual({
    activeOrganizationId: "two",
  });
  expect(await selected()).toBe("two");
});

it("ignores memberships belonging to other users", async () => {
  await client.exec("INSERT INTO member VALUES ('other', 'one', 'other-user')");
  expect(await resolveSessionOrganization(identity, database)).toEqual({
    activeOrganizationId: null,
  });
});

it("does not revive an expired session while repairing its selection", async () => {
  await memberships("one");
  await client.exec("UPDATE session SET expires_at = now() - interval '1 second'");
  expect(await resolveSessionOrganization(identity, database)).toBeNull();
  expect(await selected()).toBeNull();
});

it("does not create a missing session or authenticate a signed-out request", async () => {
  await client.exec("DELETE FROM session");
  expect(await resolveSessionOrganization(identity, database)).toBeNull();
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
  expect(await getSession({ headers: new Headers() })).toBeNull();
});
