import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";

const usage = `Usage: recovery.mjs <link|password> --email user@example.com
  link      Print a one-time password reset link valid for 15 minutes.
  password  Prompt for a new password without displaying it.
Both operations invalidate existing sessions and password reset links.
Link mode requires BETTER_AUTH_URL. Both modes require database configuration.`;

async function promptPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Password mode requires an interactive terminal. Use docker compose run without -T.",
    );
  }
  process.stdout.write(label);
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      terminal.once("SIGINT", () => reject(new Error("Recovery cancelled.")));
      terminal.once("close", () => reject(new Error("Recovery cancelled.")));
      terminal.question("", resolve);
    });
  } finally {
    terminal.close();
    output.end();
    process.stdout.write("\n");
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      email: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const [mode] = positionals;
  if (
    positionals.length !== 1 ||
    !["link", "password"].includes(mode) ||
    !values.email
  ) {
    throw new Error(usage);
  }
  let action: import("../recovery.server").RecoveryAction;
  if (mode === "password") {
    const password = await promptPassword("New password: ");
    if (password !== (await promptPassword("Confirm password: "))) {
      throw new Error("Passwords do not match. Nothing was changed.");
    }
    action = { kind: "password", password };
  } else {
    if (!process.env.BETTER_AUTH_URL)
      throw new Error("BETTER_AUTH_URL is required for recovery links.");
    action = { kind: "link", baseUrl: process.env.BETTER_AUTH_URL };
  }
  const { db, pool } = await import("../../db/client");
  try {
    const { recoverAccount } = await import("../recovery.server");
    const result = await recoverAccount(db, values.email, action);
    if (result.kind === "link") {
      console.log(
        `Recovery link (expires ${result.expiresAt.toISOString()}):\n${result.url}`,
      );
    } else {
      console.log("Password updated.");
    }
    console.log(
      "Existing sessions and previous reset links have been invalidated.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recovery failed.");
  process.exitCode = 1;
});
