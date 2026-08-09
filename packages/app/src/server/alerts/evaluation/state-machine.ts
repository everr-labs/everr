export type AlertInstanceStatus = "inactive" | "pending" | "firing";

export interface StoredAlertInstance {
  fingerprint: string;
  status: AlertInstanceStatus;
  labels: Record<string, string>;
  evidence: Record<string, unknown>;
  value: number | null;
  pendingSince: Date | null;
  activeSince: Date | null;
  lastSeenAt: Date | null;
  absentCount: number;
}

export interface PresentAlertInstance {
  fingerprint: string;
  labels: Record<string, string>;
  evidence: Record<string, unknown>;
  value: number | null;
}

export interface AlertInstanceTransition {
  next: StoredAlertInstance;
  /**
   * `pending` and `pending_cleared` are state-only: they are journaled born
   * processed and never notify. `firing` and `resolved` enter the delivery
   * pipeline.
   */
  event: "pending" | "firing" | "resolved" | "pending_cleared" | null;
}

function inactive(previous: StoredAlertInstance): StoredAlertInstance {
  return {
    ...previous,
    status: "inactive",
    pendingSince: null,
    activeSince: null,
    absentCount: 0,
  };
}

export function advanceAlertInstance(input: {
  previous: StoredAlertInstance;
  present: PresentAlertInstance | undefined;
  evaluatedAt: Date;
  forSeconds: number;
  resolveAfter: number;
}): AlertInstanceTransition {
  const { previous, present, evaluatedAt, forSeconds, resolveAfter } = input;
  if (present) {
    const reappeared = previous.absentCount > 0;
    const pendingSince =
      previous.status === "inactive" || reappeared
        ? evaluatedAt
        : (previous.pendingSince ?? evaluatedAt);
    const next: StoredAlertInstance = {
      ...previous,
      ...present,
      status: previous.status === "inactive" ? "pending" : previous.status,
      pendingSince,
      activeSince:
        previous.status === "firing"
          ? (previous.activeSince ?? evaluatedAt)
          : previous.activeSince,
      lastSeenAt: evaluatedAt,
      absentCount: 0,
    };
    const elapsedSeconds =
      (evaluatedAt.getTime() - pendingSince.getTime()) / 1000;
    if (next.status !== "firing" && elapsedSeconds >= forSeconds) {
      return {
        next: {
          ...next,
          status: "firing",
          activeSince: pendingSince,
        },
        event: "firing",
      };
    }
    // Entering pending is an event; staying pending (or reappearing while
    // still pending) is not.
    return {
      next,
      event: previous.status === "inactive" ? "pending" : null,
    };
  }

  if (previous.status === "inactive") return { next: previous, event: null };
  const absentCount = previous.absentCount + 1;
  if (absentCount < resolveAfter) {
    return { next: { ...previous, absentCount }, event: null };
  }
  return {
    next: inactive({ ...previous, absentCount }),
    event: previous.status === "firing" ? "resolved" : "pending_cleared",
  };
}

export function newInactiveInstance(
  present: PresentAlertInstance,
): StoredAlertInstance {
  return {
    ...present,
    status: "inactive",
    pendingSince: null,
    activeSince: null,
    lastSeenAt: null,
    absentCount: 0,
  };
}
