import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createDatabase, type Database } from "#app/db/database.ts";
import { withTransactionReads } from "./transaction-reads";
import * as schema from "#app/db/schema/index.ts";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { EventPublisher } from "#app/composition/events.ts";
import { identityLifecycleAdapter } from "../identity-adapter";
import type { UserEvent } from "../events";

/** Exercise the real committed auth adapter from a consumer's isolated database tests. */
export function createIdentityTestAuth(database: Database, events: EventPublisher<UserEvent>) {
  return betterAuth({
    baseURL: "http://localhost:3000",
    secret: "identity-consumer-integration-secret-long-enough",
    emailAndPassword: { enabled: true },
    database: identityLifecycleAdapter(
      database,
      (executor) => drizzleAdapter(executor, { provider: "pg" }),
      events,
    ),
  });
}

interface AuthTestClient {
  exec(sql: string): Promise<unknown>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

export async function createAuthTestDatabase(postgresUrl?: string) {
  const postgres = postgresUrl ? createDatabase({ connectionString: postgresUrl }) : undefined;
  const embedded = postgres ? undefined : new PGlite();
  const client: AuthTestClient = postgres
    ? {
        exec: (sql: string) => postgres.pool.query(sql),
        query: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
          postgres.pool.query<T>(sql, params),
        close: () => postgres.pool.end(),
      }
    : embedded!;
  const database = postgres?.db ?? (drizzle(embedded!, { schema }) as unknown as Database);
  await client.exec(`
CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL, email_verified boolean NOT NULL DEFAULT false, image text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE account (id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, access_token text, refresh_token text, id_token text, access_token_expires_at timestamp, refresh_token_expires_at timestamp, scope text, password text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE organization (id text PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, logo text, metadata text, created_at timestamp NOT NULL);
CREATE TABLE member (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, role text NOT NULL, created_at timestamp NOT NULL);
CREATE TABLE invitation (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE, email text NOT NULL, role text, status text NOT NULL, expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(), inviter_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);
CREATE TABLE session (id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, token text NOT NULL UNIQUE, expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), ip_address text, user_agent text, active_organization_id text);
CREATE TABLE verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
`);
  return { client, database: postgres ? database : withTransactionReads(database) };
}
