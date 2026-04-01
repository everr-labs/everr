import type { FailureNotification } from "@/routes/api/cli/-failure-notifications";

type State = "idle" | "listening" | "throttling" | "fetching" | "disposed";

type MachineEvent =
  | "START"
  | "NOTIFY"
  | "FETCH_SUCCESS"
  | "FETCH_ERROR"
  | "DISPOSE";

export interface FailureStreamMachineOpts {
  fetchFailures: () => Promise<FailureNotification[]>;
  sendEvent: (data: object) => void;
  subscribe: (onNotify: () => void) => () => void;
  throttleMs?: number;
}

const DEFAULT_THROTTLE_MS = 300;

export class FailureStreamMachine {
  private state: State = "idle";
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingNotify = false;
  private unsubscribe: (() => void) | null = null;
  private readonly sentKeys = new Set<string>();

  private readonly fetchFailures: () => Promise<FailureNotification[]>;
  private readonly sendEventFn: (data: object) => void;
  private readonly subscribeFn: (onNotify: () => void) => () => void;
  private readonly throttleMs: number;

  constructor(opts: FailureStreamMachineOpts) {
    this.fetchFailures = opts.fetchFailures;
    this.sendEventFn = opts.sendEvent;
    this.subscribeFn = opts.subscribe;
    this.throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  start(): void {
    this.transition("START");
  }

  dispose(): void {
    this.transition("DISPOSE");
  }

  async sendBackfill(): Promise<void> {
    const failures = await this.fetchFailures();
    this.trackAndSend(failures);
  }

  private transition(event: MachineEvent, data?: FailureNotification[]): void {
    if (event === "DISPOSE") {
      this.state = "disposed";
      this.clearTimers();
      this.unsubscribe?.();
      this.unsubscribe = null;
      return;
    }

    switch (this.state) {
      case "idle":
        if (event === "START") {
          this.state = "listening";
          this.unsubscribe = this.subscribeFn(() => this.transition("NOTIFY"));
        }
        break;

      case "listening":
        if (event === "NOTIFY") {
          this.state = "throttling";
          this.startThrottleTimer();
        }
        break;

      case "throttling":
        // Additional NOTIFYs are no-ops — timer already running
        break;

      case "fetching":
        if (event === "NOTIFY") {
          this.pendingNotify = true;
        } else if (event === "FETCH_SUCCESS" && data) {
          this.trackAndSend(data);
          if (this.pendingNotify) {
            this.pendingNotify = false;
            this.state = "throttling";
            this.startThrottleTimer();
          } else {
            this.state = "listening";
          }
        } else if (event === "FETCH_SUCCESS" || event === "FETCH_ERROR") {
          if (this.pendingNotify) {
            this.pendingNotify = false;
            this.state = "throttling";
            this.startThrottleTimer();
          } else {
            this.state = "listening";
          }
        }
        break;

      default:
        break;
    }
  }

  private startThrottleTimer(): void {
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      this.state = "fetching";
      this.doFetch();
    }, this.throttleMs);
  }

  private doFetch(): void {
    this.fetchFailures()
      .then((result) => this.transition("FETCH_SUCCESS", result))
      .catch(() => this.transition("FETCH_ERROR"));
  }

  private trackAndSend(failures: FailureNotification[]): void {
    if (this.state === "disposed") return;
    const fresh = failures.filter((f) => !this.sentKeys.has(f.dedupeKey));
    if (fresh.length === 0) return;
    for (const f of fresh) {
      this.sentKeys.add(f.dedupeKey);
    }
    this.sendEventFn({ failures: fresh });
  }

  private clearTimers(): void {
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.pendingNotify = false;
  }
}
