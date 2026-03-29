import { Client } from "pg";
import { dbEnv } from "@/env/db";
import type { NotifyPayload } from "./notify";

export type Topic = "tenant" | "trace" | "commit";

type Callback = (payload: NotifyPayload) => void;

const CHANNEL = "notifications";
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRIES = 10;

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

export class NotificationHub {
  private readonly indexes: Record<Topic, Map<string, Set<Callback>>> = {
    tenant: new Map(),
    trace: new Map(),
    commit: new Map(),
  };

  private client: Client | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private stopped = false;

  subscribe(topic: Topic, key: string, callback: Callback): () => void {
    const index = this.indexes[topic];
    let subscribers = index.get(key);
    if (!subscribers) {
      subscribers = new Set();
      index.set(key, subscribers);
    }
    subscribers.add(callback);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        index.delete(key);
      }
    };
  }

  subscriberCount(topic: Topic, key: string): number {
    return this.indexes[topic].get(key)?.size ?? 0;
  }

  dispatch(payload: NotifyPayload): void {
    this.dispatchTopic("tenant", String(payload.tenantId), payload);
    this.dispatchTopic(
      "trace",
      `${payload.tenantId}:${payload.traceId}`,
      payload,
    );
    this.dispatchTopic("commit", `${payload.tenantId}:${payload.sha}`, payload);
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.consecutiveFailures = 0;
    await this.connect();
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      await this.client.end().catch(() => {});
      this.client = null;
    }
  }

  private async connect(): Promise<void> {
    try {
      const client = new Client(buildClientConfig());
      this.client = client;

      client.on("notification", (msg) => {
        if (!msg.payload) return;
        try {
          this.dispatch(JSON.parse(msg.payload) as NotifyPayload);
        } catch {
          // ignore unparseable payloads
        }
      });

      client.on("error", () => this.handleDisconnect());
      client.on("end", () => this.handleDisconnect());

      await client.connect();
      await client.query(`LISTEN "${CHANNEL}"`);

      this.consecutiveFailures = 0;
    } catch {
      if (this.client) {
        await this.client.end().catch(() => {});
        this.client = null;
      }
      this.scheduleReconnect();
    }
  }

  private handleDisconnect(): void {
    if (this.stopped) return;
    this.client = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.consecutiveFailures >= MAX_RETRIES) return;

    const backoff = Math.min(
      1000 * 2 ** this.consecutiveFailures,
      MAX_BACKOFF_MS,
    );
    this.consecutiveFailures++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, backoff);
  }

  private dispatchTopic(
    topic: Topic,
    key: string,
    payload: NotifyPayload,
  ): void {
    const subscribers = this.indexes[topic].get(key);
    if (!subscribers) return;
    for (const cb of subscribers) {
      try {
        cb(payload);
      } catch {
        // subscriber errors must not break dispatch to others
      }
    }
  }
}
