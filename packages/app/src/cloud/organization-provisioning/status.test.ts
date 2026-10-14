// @vitest-environment node
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { DbExecutor } from "@/db/client";
import { organization } from "@/db/schema";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/server/alerting/testing/pglite-database";

vi.mock("@/db/client", () => ({ db: undefined }));

import {
  enqueueOrganizationProvisioning,
  ORGANIZATION_MAX_ATTEMPTS,
  restartOrganizationProvisioningJob,
} from "./jobs";
import { readOrganizationProvisioningStatus } from "./status";

let fixture: TestDatabase;
const org = { id: "failed-org", metadata: { clickhouseReady: false } };
beforeAll(async () => {
  fixture = await createTestDatabase();
});
afterAll(async () => fixture.close());
beforeEach(async () => {
  await fixture.truncate();
  await fixture.db.insert(organization).values({
    id: org.id,
    name: "Failed",
    slug: "failed",
    createdAt: new Date(),
    metadata: JSON.stringify(org.metadata),
  });
});
const database = () => fixture.db as unknown as DbExecutor;
const status = () => readOrganizationProvisioningStatus(org, database());

it("keeps a pending organization pending when its job is missing", async () => {
  expect(await status()).toBe("pending");
});
it("shows failure only after the final attempt has stopped running", async () => {
  await enqueueOrganizationProvisioning(org.id, database());
  expect(await status()).toBe("pending");
  await fixture.db.execute(
    sql`UPDATE graphile_worker._private_jobs SET attempts=max_attempts, locked_at=now(), locked_by='worker'`,
  );
  expect(await status()).toBe("pending");
  await fixture.db.execute(
    sql`UPDATE graphile_worker._private_jobs SET locked_at=NULL, locked_by=NULL`,
  );
  expect(await status()).toBe("failed");
});
it("restarts the exhausted job with a fresh budget without creating another organization or job", async () => {
  await enqueueOrganizationProvisioning(org.id, database());
  await fixture.db.execute(
    sql`UPDATE graphile_worker._private_jobs SET attempts=max_attempts, last_error='Timeout', run_at=now()+interval '6 hours'`,
  );
  const original = (
    await fixture.db.execute(sql`SELECT id FROM graphile_worker.jobs`)
  ).rows[0];
  expect(await status()).toBe("failed");
  await restartOrganizationProvisioningJob(org.id, database());
  expect(await status()).toBe("pending");
  expect(
    (
      await fixture.db.execute(
        sql`SELECT id, attempts, max_attempts, last_error, run_at <= now() + interval '1 second' AS immediate FROM graphile_worker.jobs`,
      )
    ).rows,
  ).toEqual([
    {
      id: original.id,
      attempts: 0,
      max_attempts: ORGANIZATION_MAX_ATTEMPTS,
      last_error: "Timeout",
      immediate: true,
    },
  ]);
  expect(await fixture.db.select().from(organization)).toHaveLength(1);
});
it("uses successful provisioning metadata even if an exhausted job still exists", async () => {
  await enqueueOrganizationProvisioning(org.id, database());
  await fixture.db.execute(
    sql`UPDATE graphile_worker._private_jobs SET attempts=max_attempts`,
  );
  expect(
    await readOrganizationProvisioningStatus(
      { ...org, metadata: { clickhouseReady: true } },
      database(),
    ),
  ).toBe("ready");
});
