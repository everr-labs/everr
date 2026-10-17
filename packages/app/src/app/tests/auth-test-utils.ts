import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema/index";

export async function createAuthTestDatabase() {
  const client = new PGlite();
  const database = drizzle(client, { schema }) as unknown as Database;
  await client.exec(`
CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL, email_verified boolean NOT NULL DEFAULT false, image text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE account (id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES "user"(id), access_token text, refresh_token text, id_token text, access_token_expires_at timestamp, refresh_token_expires_at timestamp, scope text, password text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE organization (id text PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, logo text, metadata text, created_at timestamp NOT NULL);
CREATE TABLE member (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id), user_id text NOT NULL REFERENCES "user"(id), role text NOT NULL, created_at timestamp NOT NULL);
CREATE TABLE invitation (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id), email text NOT NULL, role text, status text NOT NULL, expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(), inviter_id text NOT NULL REFERENCES "user"(id));
CREATE TABLE session (id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id), token text NOT NULL UNIQUE, expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), ip_address text, user_agent text, active_organization_id text);
CREATE TABLE verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
`);
  return { client, database };
}
