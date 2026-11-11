import type { ProfilesRepositoryLike } from "./repository";

// A profile row is stamped with the start of its collection period, which can
// begin well before the spans its samples link to, and a profiler can flush it
// after the trace ends. Pad the trace window so those profiles fall inside;
// the TraceId filter, which the bloom index prunes, does the narrowing.
const PADDING_MS = 5 * 60 * 1000;

/** Search params for the Profiles page showing the samples linked to a trace, or one of its spans. */
export function profilesSearchForTrace(
  traceId: string,
  window: { start: Date; end: Date },
  spanId?: string,
): { traceId: string; spanId?: string; from: string; to: string } {
  return {
    traceId,
    ...(spanId ? { spanId } : {}),
    from: new Date(window.start.getTime() - PADDING_MS).toISOString(),
    to: new Date(window.end.getTime() + PADDING_MS).toISOString(),
  };
}

/** Looks up which of a trace's spans have samples, over the same padded window the links use. */
export function profiledSpansForTrace(repo: Pick<ProfilesRepositoryLike, "profiledSpans">) {
  return ({ traceId, window }: { traceId: string; window: { start: Date; end: Date } }) => {
    const { from, to } = profilesSearchForTrace(traceId, window);
    return repo.profiledSpans({ traceId, timeRange: { from, to } });
  };
}
