// Development only: `pnpm dev` runs each product's seed before App and Cloud
// start, so both boot with their own telemetry pointed at their own ingest.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "vite-plus";
import type { Database } from "#app/db/client.ts";
import type { auth as Auth } from "#app/identity/server.ts";

type DevelopmentOwnerInput = {
  db: Database;
  auth: typeof Auth;
  email: string;
  password: string;
};

const SERVER_KEY_NAME = "Development telemetry";
const BROWSER_KEY_NAME = "Development browser telemetry";

/**
 * Migrates, ensures `EVERR_DEV_EMAIL` owns an organization (calling
 * `createOwner` when it doesn't), and writes the organization's ingest keys to
 * `DEV_SEED_FILE`. Env-dependent modules load only after the dotenv files.
 */
export async function runDevSeed(
  product: "app" | "cloud",
  createOwner: (input: DevelopmentOwnerInput) => Promise<void>,
) {
  for (const [key, value] of Object.entries(loadEnv("development", process.cwd(), ""))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  const outputFile = required("DEV_SEED_FILE");
  // Verification runs start from empty databases to exercise sign-up and setup.
  if (process.env.EVERR_DEV_SEED === "0") {
    await writeSeedFile(outputFile, {});
    console.log(`Skipped ${product} seed (EVERR_DEV_SEED=0)`);
    process.exit(0);
  }

  const email = required("EVERR_DEV_EMAIL").toLowerCase();
  const password = required("EVERR_DEV_PASSWORD");
  const ingestUrl = required("DEV_SEED_INGEST_URL");
  const appUrl = required("BETTER_AUTH_URL");

  const { pool, db } = await import("#app/db/client.ts");
  try {
    const [
      {
        runtime: { migrateDatabase },
      },
      { withMigrationLock },
    ] = await Promise.all([import("@composition/runtime"), import("#app/db/migrations.ts")]);
    await withMigrationLock(migrateDatabase);
    // Workers create their job schema on first start; Cloud's organization
    // creation enqueues a job before any worker has run.
    const { runMigrations } = await import("graphile-worker");
    await runMigrations({ pgPool: pool });

    const { and, eq, inArray } = await import("drizzle-orm");
    const { apikey, member, user } = await import("#app/db/schema/index.ts");
    const { auth } = await import("#app/identity/server.ts");
    const { permissionsForScopes } = await import("#app/data/api-keys.ts");
    const { buildPublicKeyMetadata } = await import("#app/lib/public-ingest-keys.ts");
    const { createOnboardingStore } = await import("#app/data/onboarding/store.ts");

    async function findOwner() {
      const [row] = await db
        .select({ userId: user.id, organizationId: member.organizationId })
        .from(user)
        .innerJoin(member, eq(member.userId, user.id))
        .where(and(eq(user.email, email), inArray(member.role, ["owner", "admin"])))
        .orderBy(member.createdAt)
        .limit(1);
      return row;
    }

    let owner = await findOwner();
    if (!owner) {
      await createOwner({ db, auth, email, password });
      owner = await findOwner();
      if (!owner) throw new Error(`Seeding ${email} did not create an organization.`);
    }
    // Also for a reused owner, so a run that failed after creating it recovers.
    await createOnboardingStore(db).complete(owner);
    const { organizationId, userId } = owner;
    const previous = await readSeedFile(outputFile);

    async function ensureKey(current: string | undefined, name: string, browser: boolean) {
      if (current) {
        const result = await auth.api.verifyApiKey({ body: { key: current, configId: "ingest" } });
        if (result.valid && result.key?.referenceId === organizationId) return current;
      }
      // Replace keys this seed created earlier and whose value was lost.
      await db
        .delete(apikey)
        .where(and(eq(apikey.referenceId, organizationId), eq(apikey.name, name)));
      const created = await auth.api.createApiKey({
        body: {
          configId: "ingest",
          name,
          organizationId,
          userId,
          permissions: permissionsForScopes(["ingest"]),
          ...(browser ? { metadata: buildPublicKeyMetadata([appUrl]) } : {}),
        },
      });
      return created.key;
    }

    const serverKey = await ensureKey(previous.EVERR_INGEST_KEY, SERVER_KEY_NAME, false);
    const browserKey = await ensureKey(
      previous.VITE_EVERR_PUBLIC_INGEST_KEY,
      BROWSER_KEY_NAME,
      true,
    );

    await writeSeedFile(outputFile, {
      EVERR_INGEST_ENDPOINT: ingestUrl,
      EVERR_INGEST_KEY: serverKey,
      VITE_EVERR_INGEST_ENDPOINT: ingestUrl,
      VITE_EVERR_PUBLIC_INGEST_KEY: browserKey,
    });
    console.log(`Seeded ${product}: ${email} sends ${product} telemetry to ${ingestUrl}`);
  } finally {
    await pool.end();
  }
  // Auth and event modules may hold open handles; the seed is done.
  process.exit(0);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readSeedFile(file: string): Promise<Record<string, string>> {
  const text = await readFile(file, "utf8").catch(() => "");
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
      .filter((match) => match !== null)
      .map(([, key, value]) => [key, value]),
  );
}

async function writeSeedFile(file: string, values: Record<string, string>) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  const text = Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, file);
}
