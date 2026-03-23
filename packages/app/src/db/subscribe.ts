import { Client } from "pg";
import { dbEnv } from "@/env/db";
import { type NotifyPayload, SAFE_CHANNEL_RE } from "./notify";

type CleanupFn = () => void;

function buildClientConfig() {
  const shouldUseSsl = ["true", "1", "yes", "on"].includes(
    dbEnv.DATABASE_SSL?.toLowerCase() ?? "",
  );
  return {
    host: dbEnv.DATABASE_HOST,
    database: dbEnv.DATABASE_NAME,
    port: dbEnv.DATABASE_PORT,
    user: dbEnv.DATABASE_USER,
    password: dbEnv.DATABASE_PASSWORD,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  };
}

// A dedicated pg.Client (not from the pool) is required because LISTEN/NOTIFY
// is session-scoped and long-lived. Pool connections get recycled, which would
// drop the subscription. One client per SSE connection is the standard pattern.
export function createSubscription(
  channel: string,
  onNotification: (payload: NotifyPayload) => void,
  onError: (err: Error) => void,
): CleanupFn {
  const client = new Client(buildClientConfig());
  let cleaned = false;

  const cleanup: CleanupFn = () => {
    if (cleaned) return;
    cleaned = true;
    client.end().catch(() => {});
  };

  client.on("notification", (msg) => {
    if (!msg.payload) return;
    try {
      const parsed = JSON.parse(msg.payload) as NotifyPayload;
      onNotification(parsed);
    } catch {
      // ignore unparseable payloads
    }
  });

  client.on("error", (err) => {
    if (!cleaned) onError(err);
    cleanup();
  });

  client
    .connect()
    .then(async () => {
      if (cleaned) return;
      if (!SAFE_CHANNEL_RE.test(channel)) {
        throw new Error(`Unsafe channel name: ${channel}`);
      }
      await client.query(`LISTEN "${channel}"`);
    })
    .catch((err: Error) => {
      if (!cleaned) onError(err);
      cleanup();
    });

  return cleanup;
}
