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
  /**
   * How long the unwatched stretch was, when this evaluation threw away a
   * pending instance's `for` progress because nothing observed the condition
   * across it, and null otherwise.
   *
   * A restart after a recorded absence is not this: that one has evidence
   * behind it. This one changes the verdict on the absence of evidence, and
   * it writes nothing (the instance stays pending and no transition is
   * journaled), so a rule that lands late every interval never fires and
   * still reads healthy. The caller reports it; see
   * `alerts.evaluate.for_clock_restarted`.
   */
  forClockRestartMs: number | null;
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

/**
 * How many evaluation intervals may pass between two sightings before the gap
 * counts as unobserved. Schedulers jitter and a single late tick is not
 * evidence that the condition lapsed; two or more means the engine stopped
 * watching and cannot vouch for the stretch.
 */
const MISSED_EVALUATION_TOLERANCE = 2;

export function advanceAlertInstance(input: {
  previous: StoredAlertInstance;
  present: PresentAlertInstance | undefined;
  evaluatedAt: Date;
  forSeconds: number;
  resolveAfter: number;
  intervalSeconds: number;
}): AlertInstanceTransition {
  const {
    previous,
    present,
    evaluatedAt,
    forSeconds,
    resolveAfter,
    intervalSeconds,
  } = input;
  if (present) {
    const reappeared = previous.absentCount > 0;
    // An evaluation landing far later than the cadence promises means nothing
    // watched the condition in between, and an absence in that window would
    // have left exactly this state: absentCount stays 0 and lastSeenAt stays
    // put, because only a real evaluation records an absence. `for` claims the
    // condition held continuously, so an unobserved stretch restarts the
    // clock instead of counting as holding. Without this an outage longer
    // than `for` fires the rule on the first evaluation after it.
    const gapMs =
      previous.lastSeenAt === null
        ? null
        : evaluatedAt.getTime() - previous.lastSeenAt.getTime();
    const unobserved =
      gapMs !== null &&
      gapMs > intervalSeconds * MISSED_EVALUATION_TOLERANCE * 1000;
    // Only a pending instance loses anything to it. An inactive one starts
    // its clock at this evaluation regardless, and a firing one keeps
    // activeSince whatever pendingSince becomes. Reporting those too would
    // bury the case that costs a page.
    const forClockRestartMs =
      unobserved && !reappeared && previous.status === "pending" ? gapMs : null;
    const pendingSince =
      previous.status === "inactive" || reappeared || unobserved
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
        forClockRestartMs,
      };
    }
    // Entering pending is an event; staying pending (or reappearing while
    // still pending) is not.
    return {
      next,
      event: previous.status === "inactive" ? "pending" : null,
      forClockRestartMs,
    };
  }

  if (previous.status === "inactive")
    return { next: previous, event: null, forClockRestartMs: null };
  const absentCount = previous.absentCount + 1;
  if (absentCount < resolveAfter) {
    return {
      next: { ...previous, absentCount },
      event: null,
      forClockRestartMs: null,
    };
  }
  return {
    next: inactive({ ...previous, absentCount }),
    event: previous.status === "firing" ? "resolved" : "pending_cleared",
    forClockRestartMs: null,
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
