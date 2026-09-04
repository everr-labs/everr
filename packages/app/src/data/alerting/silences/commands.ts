/**
 * The facts and transformations behind creating, cancelling, and repeating
 * Alert silences. Screens supply focus and wording; this module owns what each
 * command means and what can be written again.
 */

/** What a silence dialog starts from. */
export type SilenceSeed = {
  rule: string | null;
  matchers: string;
  comment: string;
};

/** What the create command writes. */
export type SilenceDraft = {
  path: string;
  durationMinutes: number;
  matchers: string;
  comment: string;
};

type RecreateSilence = Omit<SilenceDraft, "durationMinutes"> & {
  startsAt: string;
  endsAt: string;
};

/** Everything the cancel command needs, including a safe Undo when known. */
export type SilenceCancelTarget = {
  id: string;
  /** What the toast calls the silence. */
  label: string;
  /** The original write and window. Null when its scope cannot be reproduced. */
  recreate: RecreateSilence | null;
};

/** The durations the create dialog offers. */
export const SILENCE_DURATIONS = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "4h", minutes: 240 },
  { label: "12h", minutes: 720 },
  { label: "24h", minutes: 1440 },
] as const;

/** A blank create command, for the Silences page. */
export const newSilenceSeed = (): SilenceSeed => ({
  rule: null,
  matchers: "",
  comment: "",
});

/** A whole-rule create command. */
export const ruleSilenceSeed = (path: string): SilenceSeed => ({
  rule: path,
  matchers: "",
  comment: "",
});

/**
 * A repeat carries the original scope and explanation. A detail panel may
 * supply its own rule when the silence did not name exactly one; the org-wide
 * page supplies none and lets the dialog ask.
 */
export function repeatSilenceSeed(
  record: {
    rule: { path: string } | null;
    scope: string;
    comment: string;
  },
  fallbackRule: string | null,
): SilenceSeed {
  return {
    rule: record.rule?.path ?? fallbackRule,
    matchers: record.scope,
    comment: record.comment,
  };
}

/** Cancel a known silence when the caller cannot safely reproduce its scope. */
export const cancelSilenceById = (
  id: string,
  label: string,
): SilenceCancelTarget => ({ id, label, recreate: null });

/**
 * Cancel a listed silence. Undo is available only when the record resolved to
 * exactly one rule; guessing a rule would mute more than the original did.
 */
export function cancelSilenceTarget(
  record: {
    id: string;
    startsAt: string;
    endsAt: string;
    rule: { path: string } | null;
    scope: string;
    comment: string;
  },
  label: string,
): SilenceCancelTarget {
  return {
    id: record.id,
    label,
    recreate: record.rule
      ? {
          path: record.rule.path,
          matchers: record.scope,
          comment: record.comment,
          startsAt: record.startsAt,
          endsAt: record.endsAt,
        }
      : null,
  };
}

/**
 * What Undo writes, in whole minutes from now. The create command always
 * starts at now, so it cannot reproduce a window that has not opened or one
 * that has already closed. A partial minute rounds up so time remains.
 */
export function recreateCancelledSilence(
  target: SilenceCancelTarget,
  now: number,
): SilenceDraft | null {
  const { recreate } = target;
  if (!recreate || new Date(recreate.startsAt).getTime() > now) return null;
  const durationMinutes = Math.ceil(
    (new Date(recreate.endsAt).getTime() - now) / 60_000,
  );
  if (durationMinutes <= 0) return null;
  const { startsAt: _started, endsAt: _ended, ...draft } = recreate;
  return { ...draft, durationMinutes };
}
