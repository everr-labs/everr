import { Client } from "pg";
import { dbEnv } from "@/env/db";
import { type NotifyPayload, SAFE_CHANNEL_RE } from "./notify";

type State = "connecting" | "listening" | "disposed";

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
// TODO: multiplex subscribers sharing the same channel onto a single pg.Client
// to reduce connection pressure — see todo/issues/pg-connection-per-sse-client.md
export class Subscription {
  private state: State = "connecting";
  private readonly client: Client;
  private readonly connectPromise: Promise<void>;

  constructor(
    channel: string,
    onNotification: (payload: NotifyPayload) => void,
    private onError: (err: Error) => void,
  ) {
    this.client = new Client(buildClientConfig());

    this.client.on("notification", (msg) => {
      if (this.state !== "listening" || !msg.payload) return;
      try {
        onNotification(JSON.parse(msg.payload) as NotifyPayload);
      } catch {
        // ignore unparseable payloads
      }
    });

    this.client.on("error", this.handleError);

    this.connectPromise = this.client
      .connect()
      .then(async () => this.handleConnect(channel));
  }

  handleError = (err: Error) => {
    if (this.state !== "disposed") this.onError(err);
    this.dispose();
  };

  async handleConnect(channel: string) {
    if (this.state === "disposed") return;

    if (!SAFE_CHANNEL_RE.test(channel)) {
      throw new Error(`Unsafe channel name: ${channel}`);
    }

    this.state = "listening";

    this.client.query(`LISTEN "${channel}"`).catch(this.handleError);
  }

  dispose(): void {
    if (this.state === "disposed") return;

    const prev = this.state;
    this.state = "disposed";

    const end = () => this.client.end().catch(() => {});

    if (prev === "connecting") {
      // Wait for connect() to settle before ending — avoids calling
      // client.end() on a half-open connection.
      this.connectPromise.then(end, end);
    } else {
      end();
    }
  }
}

export function createSubscription(
  channel: string,
  onNotification: (payload: NotifyPayload) => void,
  onError: (err: Error) => void,
): () => void {
  const sub = new Subscription(channel, onNotification, onError);
  return () => sub.dispose();
}
