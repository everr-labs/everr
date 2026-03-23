type State =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";
type MachineEvent = "CONNECT" | "OPEN" | "ERROR" | "MESSAGE" | "DISPOSE";

interface RealtimeSubscriptionOpts {
  url: string;
  onInvalidate: () => void;
  EventSourceCtor?: typeof EventSource;
}

const MAX_RETRIES = 5;
export const THROTTLE_MS = 300;
export const MAX_RECONNECT_DELAY_MS = 30_000;

export class RealtimeSubscriptionMachine {
  private state: State = "idle";
  private retryCount = 0;
  private eventSource: EventSource | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;

  private readonly url: string;
  private readonly onInvalidate: () => void;
  private readonly EventSourceCtor: typeof EventSource;

  constructor(opts: RealtimeSubscriptionOpts) {
    this.url = opts.url;
    this.onInvalidate = opts.onInvalidate;
    this.EventSourceCtor = opts.EventSourceCtor ?? globalThis.EventSource;
  }

  connect(): void {
    this.transition("CONNECT");
  }

  dispose(): void {
    this.transition("DISPOSE");
  }

  private transition(event: MachineEvent): void {
    if (event === "DISPOSE") {
      this.state = "disconnected";
      this.closeEventSource();
      this.clearTimers();
      return;
    }

    switch (this.state) {
      case "idle":
        if (event === "CONNECT") {
          this.state = "connecting";
          this.createEventSource();
        }
        break;

      case "connecting":
        if (event === "OPEN") {
          this.state = "connected";
          this.retryCount = 0;
        } else if (event === "ERROR") {
          this.handleError();
        }
        break;

      case "connected":
        if (event === "OPEN") {
          this.retryCount = 0;
        } else if (event === "ERROR") {
          this.handleError();
        } else if (event === "MESSAGE") {
          this.throttledInvalidate();
        }
        break;

      case "reconnecting":
        if (event === "CONNECT") {
          this.state = "connecting";
          this.createEventSource();
        }
        break;

      default:
        break;
    }
  }

  private createEventSource(): void {
    this.eventSource = new this.EventSourceCtor(this.url);
    this.eventSource.onopen = () => this.transition("OPEN");
    this.eventSource.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(String(event.data)) as { type: string };
        if (data.type === "update") {
          this.transition("MESSAGE");
        }
      } catch {
        // ignore malformed events
      }
    };
    this.eventSource.onerror = () => this.transition("ERROR");
  }

  private closeEventSource(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  private handleError(): void {
    this.closeEventSource();
    this.retryCount += 1;
    if (this.retryCount > MAX_RETRIES) {
      this.state = "disconnected";
    } else {
      this.state = "reconnecting";
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.retryCount, MAX_RECONNECT_DELAY_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.transition("CONNECT");
    }, delay);
  }

  private throttledInvalidate(): void {
    this.pending = true;
    if (this.throttleTimer !== null) return;
    this.startThrottleTimer();
  }

  private startThrottleTimer(): void {
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      if (this.pending) {
        this.pending = false;
        try {
          this.onInvalidate();
        } catch {
          // Don't let a failing callback break the throttle loop
        }
        // Re-arm timer without setting pending — if no new MESSAGE arrives
        // before the next tick, the timer will see pending=false and stop.
        this.startThrottleTimer();
      }
    }, THROTTLE_MS);
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.pending = false;
  }
}
