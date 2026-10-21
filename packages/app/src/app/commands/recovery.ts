import { parseArgs } from "node:util";

const usage = `Usage: recovery.mjs --email user@example.com
Print a one-time password reset link valid for 15 minutes.
Invalidates existing sessions and password reset links.
Requires BETTER_AUTH_URL and database configuration.`;

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!values.email) throw new Error(usage);
  const baseUrl = process.env.BETTER_AUTH_URL;
  if (!baseUrl) throw new Error("BETTER_AUTH_URL is required for recovery links.");
  const { db, pool } = await import("../../db/client");
  try {
    const { createRecoveryLink } = await import("../recovery.server");
    const result = await createRecoveryLink(db, values.email, baseUrl);
    console.log(`Recovery link (expires ${result.expiresAt.toISOString()}):\n${result.url}`);
    console.log("Existing sessions and previous reset links have been invalidated.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recovery failed.");
  process.exitCode = 1;
});
