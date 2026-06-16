// The pure state machine of the alert lifecycle. Given where the alert was
// (previous firing set), where it is now (current instances), and the diff
// between the two, it decides — with no I/O — what one evaluation means:
// which named transition happened, how the definition row should change, and
// which notifications to send. evaluate.ts feeds it and applies the result.
//
// An alert is "firing" when at least one instance fires; instance identity is
// the label fingerprint (see instances.ts). The interesting edges are
// rule-level (resolved ↔ firing), but instances can also come and go while
// the rule stays firing — that's where the partial/churn cases below come from.

import type {
  AlertInstance,
  FiringInstance,
  InstanceDiff,
} from "./02-instances";
import type { NotifiableInstance } from "./04-format";

// The runtime states the machine moves between.
//
//   "resolved" — no instances are currently firing
//   "firing"   — at least one instance is firing
//
// The DB also stores "unknown" for never-evaluated or just-reset rows,
// but it's not modeled here: the first evaluation overwrites it.
export type AlertRuntimeState = "resolved" | "firing";

// The seven possible outcomes of one evaluation:
//
//   was firing? | is firing? | instance changes        | name
//   ------------|------------|-------------------------|------------------------
//   no          | no         | —                       | stayed_resolved
//   no          | yes        | all new                 | started_firing
//   yes         | no         | all resolved            | resolved
//   yes         | yes        | some new, some resolved | churned
//   yes         | yes        | some new                | added_firing_instances
//   yes         | yes        | some resolved           | partially_resolved
//   yes         | yes        | none                    | stayed_firing
//
// Effects per transition:
//
//   name                  | next state | timestamps set          | notifications
//   ----------------------|------------|-------------------------|------------------
//   stayed_resolved       | resolved   | —                       | —
//   started_firing        | firing     | lastSeenAt, lastFiredAt | firing
//   stayed_firing         | firing     | lastSeenAt              | —
//   added_firing_instances| firing     | lastSeenAt              | firing (new only)
//   partially_resolved    | firing     | lastSeenAt              | partial_resolved
//   resolved              | resolved   | lastResolvedAt          | resolved
//   churned               | firing     | lastSeenAt              | firing + partial_resolved
export type AlertTransitionName =
  | "stayed_resolved"
  | "started_firing"
  | "stayed_firing"
  | "added_firing_instances"
  | "partially_resolved"
  | "resolved"
  | "churned";

// Patch for the alert_definitions row. The optional timestamps move only on
// their edge (see buildAlertTransition); an absent field means "leave the
// previously stored value alone".
export interface AlertStateUpdate {
  currentState: AlertRuntimeState;
  firingInstanceCount: number;
  lastSeenAt?: Date;
  lastFiredAt?: Date;
  lastResolvedAt?: Date;
}

// One notification to deliver: the kind doubles as the alert_events
// event_type for the evaluation row recorded alongside the send.
export interface AlertTransitionAction {
  kind: "firing" | "resolved";
  instance: NotifiableInstance;
}

export interface AlertTransition {
  name: AlertTransitionName;
  nextState: AlertRuntimeState;
  firingCount: number;
  definitionUpdate: AlertStateUpdate;
  actions: AlertTransitionAction[];
}

function transitionName(input: {
  wasFiring: boolean;
  isFiring: boolean;
  hasNewlyFired: boolean;
  hasResolved: boolean;
}): AlertTransitionName {
  // The first three branches settle every case where the rule-level state
  // changes (or stays resolved); what's left is "was firing and still is",
  // distinguished only by instance churn. Note the flags are not independent:
  // started_firing implies hasNewlyFired, and resolved implies hasResolved
  // (every previous instance is in nowResolved when the current set is empty).
  if (!input.wasFiring && !input.isFiring) return "stayed_resolved"; // still quiet
  if (!input.wasFiring && input.isFiring) return "started_firing"; // entering episode
  if (input.wasFiring && !input.isFiring) return "resolved"; // episode ended
  if (input.hasNewlyFired && input.hasResolved) return "churned"; // instances turning over
  if (input.hasNewlyFired) return "added_firing_instances"; // new instances joined
  if (input.hasResolved) return "partially_resolved"; // some instances recovered
  return "stayed_firing"; // no instance changes
}

export function buildAlertTransition(input: {
  previous: readonly FiringInstance[];
  current: readonly AlertInstance[];
  diff: InstanceDiff;
  now: Date;
}): AlertTransition {
  const wasFiring = input.previous.length > 0;
  const isFiring = input.current.length > 0;
  const hasNewlyFired = input.diff.newlyFired.length > 0;
  const hasResolved = input.diff.nowResolved.length > 0;
  const nextState = isFiring ? "firing" : "resolved";
  const name = transitionName({
    wasFiring,
    isFiring,
    hasNewlyFired,
    hasResolved,
  });

  // Three timestamps, three meanings:
  //   lastSeenAt     — every evaluation that finds the rule firing
  //   lastFiredAt    — only the resolved → firing edge
  //   lastResolvedAt — only the firing → resolved edge
  // So lastFiredAt..lastResolvedAt always brackets the most recent full
  // firing episode, while lastSeenAt keeps moving inside it.
  const definitionUpdate: AlertStateUpdate = {
    currentState: nextState,
    firingInstanceCount: input.current.length,
    ...(isFiring ? { lastSeenAt: input.now } : {}),
    ...(name === "started_firing" ? { lastFiredAt: input.now } : {}),
    ...(name === "resolved" ? { lastResolvedAt: input.now } : {}),
  };

  // Still-firing instances never notify here — they were announced on their
  // started_firing or added_firing_instances transition.
  const actions: AlertTransitionAction[] = [];
  for (const instance of input.diff.newlyFired) {
    actions.push({ kind: "firing", instance });
  }
  for (const instance of input.diff.nowResolved) {
    actions.push({ kind: "resolved", instance });
  }

  return {
    name,
    nextState,
    firingCount: input.current.length,
    definitionUpdate,
    actions,
  };
}
