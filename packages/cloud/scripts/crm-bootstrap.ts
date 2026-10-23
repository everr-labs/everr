import { parseArgs } from "node:util";
import { Pool } from "pg";
import { readBrevoConfig } from "../src/crm/brevo/config";
import { bootstrapCrm } from "../src/crm/bootstrap";

async function main() {
  const { values } = parseArgs({
    options: {
      "page-size": { type: "string" },
      "max-pages": { type: "string" },
      "new-scan": { type: "boolean", default: false },
    },
  });
  const config = readBrevoConfig(process.env);
  if (config.mode === "disabled") throw new Error("CRM disabled.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required.");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const result = await bootstrapCrm({
      pool,
      mode: config.mode,
      deployment: config.deployment,
      accountScope: config.accountScope,
      pageSize: Number(values["page-size"]),
      maxPages: Number(values["max-pages"]),
      newScan: values["new-scan"],
      signal: controller.signal,
    });
    // Only operational metadata, never credentials, provider responses or source profiles.
    console.info(JSON.stringify(result));
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await pool.end();
  }
}

main().catch(() => {
  console.error(
    "CRM bootstrap failed or interrupted. Committed pages remain resumable; inspect configuration, schema, database and bounds.",
  );
  process.exitCode = 1;
});
