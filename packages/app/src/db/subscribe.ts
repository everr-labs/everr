import { Client } from "pg";
import { dbEnv } from "@/env/db";
import type { NotifyPayload } from "./notify";

type CleanupFn = () => void;

const SAFE_CHANNEL_RE = /^[a-zA-Z0-9_]+$/;

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

export function createSubscription(
  channels: string[],
  onNotification: (payload: NotifyPayload) => void,
  onError: (err: Error) => void,
): CleanupFn {
  const client = new Client(buildClientConfig());
  let cleaned = false;

  const cleanup: CleanupFn = () => {
    if (cleaned) return;
    cleaned = true;
    client
      .query("UNLISTEN *")
      .catch(() => {})
      .finally(() => client.end().catch(() => {}));
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
    onError(err);
    cleanup();
  });

  client
    .connect()
    .then(async () => {
      for (const channel of channels) {
        if (!SAFE_CHANNEL_RE.test(channel)) {
          throw new Error(`Unsafe channel name: ${channel}`);
        }
        await client.query(`LISTEN "${channel}"`);
      }
    })
    .catch((err: Error) => {
      onError(err);
      cleanup();
    });

  return cleanup;
}
