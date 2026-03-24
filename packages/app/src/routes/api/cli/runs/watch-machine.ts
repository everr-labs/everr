import type { WatchResponse } from "@/data/watch";

type State =
  | "idle"
  | "listening"
  | "throttling"
  | "fetching"
  | "completed"
  | "disposed";

type MachineEvent =
  | "START"
  | "NOTIFY"
  | "THROTTLE_EXPIRED"
  | "FETCH_SUCCESS"
  | "FETCH_ERROR"
  | "SUBSCRIBE_ERROR"
  | "DISPOSE";

export interface WatchMachineOpts {
  fetchStatus: () => Promise<WatchResponse>;
  sendEvent: (data: object) => void;
  subscribe: (onNotify: () => void, onError: () => void) => () => void;
  close: () => void;
  throttleMs?: number;
}

const DEFAULT_THROTTLE_MS = 300;

export class WatchMachine {
  private state: State = "idle";
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingNotify = false;
  private unsubscribe: (() => void) | null = null;

  private readonly fetchStatus: () => Promise<WatchResponse>;
  private readonly sendEvent: (data: object) => void;
  private readonly subscribeFn: (
    onNotify: () => void,
    onError: () => void,
  ) => () => void;
  private readonly closeFn: () => void;
  private readonly throttleMs: number;

  constructor(opts: WatchMachineOpts) {
    this.fetchStatus = opts.fetchStatus;
    this.sendEvent = opts.sendEvent;
    this.subscribeFn = opts.subscribe;
    this.closeFn = opts.close;
    this.throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  start(): void {
    this.transition("START");
  }

  dispose(): void {
    this.transition("DISPOSE");
  }

  private transition(event: MachineEvent, data?: WatchResponse): void {
    if (event === "DISPOSE") {
      this.state = "disposed";
      this.clearTimers();
      this.unsubscribe?.();
      this.unsubscribe = null;
      return;
    }

    if (event === "SUBSCRIBE_ERROR") {
      this.state = "disposed";
      this.clearTimers();
      this.sendEvent({ type: "error", message: "subscription lost" });
      this.closeFn();
      this.unsubscribe = null;
      return;
    }

    switch (this.state) {
      case "idle":
        if (event === "START") {
          this.state = "listening";
          this.unsubscribe = this.subscribeFn(
            () => this.transition("NOTIFY"),
            () => this.transition("SUBSCRIBE_ERROR"),
          );
        }
        break;

      case "listening":
        if (event === "NOTIFY") {
          this.state = "throttling";
          this.startThrottleTimer();
        }
        break;

      case "throttling":
        // NOTIFY is a no-op — timer already running
        break;

      case "fetching":
        if (event === "NOTIFY") {
          this.pendingNotify = true;
        } else if (event === "FETCH_SUCCESS" && data) {
          this.sendEvent(data);
          if (data.state === "completed") {
            this.state = "completed";
            this.closeFn();
            this.unsubscribe?.();
            this.unsubscribe = null;
          } else if (this.pendingNotify) {
            this.pendingNotify = false;
            this.state = "throttling";
            this.startThrottleTimer();
          } else {
            this.state = "listening";
          }
        } else if (event === "FETCH_SUCCESS" || event === "FETCH_ERROR") {
          // FETCH_SUCCESS without data or FETCH_ERROR: fall back to listening
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
    this.fetchStatus()
      .then((result) => this.transition("FETCH_SUCCESS", result))
      .catch(() => this.transition("FETCH_ERROR"));
  }

  private clearTimers(): void {
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.pendingNotify = false;
  }
}
