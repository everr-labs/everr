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
  event: "firing" | "resolved" | null;
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
    return { next, event: null };
  }

  if (previous.status === "inactive") return { next: previous, event: null };
  const absentCount = previous.absentCount + 1;
  if (absentCount < resolveAfter) {
    return { next: { ...previous, absentCount }, event: null };
  }
  return {
    next: inactive({ ...previous, absentCount }),
    event: previous.status === "firing" ? "resolved" : null,
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
