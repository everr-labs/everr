import type { ClipSubject, CoveringClip } from "@everr/telemetry-explorer/recordings";
import { queryOptions } from "@tanstack/react-query";
import { getClipEvents, getCoveringClips } from "./server";
import type { ClipEvents } from "./session.ts";

export type RecordedEvent = ClipEvents["events"][number];
export type RecordingGap = ClipEvents["gaps"][number];

export class ClipEventsError extends Error {
  constructor(readonly code: "too_large" | "not_found" | "internal") {
    super(`Could not load the recording: ${code}`);
    this.name = "ClipEventsError";
  }
}

// An answer with nothing in it may only mean the Segments or the Clip's span
// had not arrived yet, so it is looked up again after a while.
const EMPTY_STALE_MS = 30_000;

// Keys hold the record's identity only. A time resolved against now in a key
// refetches on every render.
export const coveringClipsOptions = (subject: ClipSubject) =>
  queryOptions({
    queryKey: ["recordings", "covering", subject],
    queryFn: () => getCoveringClips({ data: subject }),
    staleTime: (query) => (query.state.data?.length ? Number.POSITIVE_INFINITY : EMPTY_STALE_MS),
  });

// Events with no gap are the whole Clip. Without events, or with gaps, Segments may still arrive.
const isSettled = (data: ClipEvents | undefined) =>
  data !== undefined && data.events.length > 0 && data.gaps.length === 0;

/** A Clip's events do not change and weigh megabytes, so a refresh leaves them be. */
export const isClipEventsKey = (key: readonly unknown[]) =>
  key[0] === "recordings" && key[1] === "events";

export const clipEventsOptions = (clip: Pick<CoveringClip, "clipId" | "startMs">) =>
  // oxlint-disable-next-line query/exhaustive-deps -- startMs belongs to the Clip the id names
  queryOptions({
    queryKey: ["recordings", "events", clip.clipId],
    queryFn: async (): Promise<ClipEvents> => {
      const response = await getClipEvents({
        data: { clipId: clip.clipId, startMs: clip.startMs },
      });
      if (!response.ok) {
        throw new ClipEventsError(
          response.status === 413
            ? "too_large"
            : response.status === 404
              ? "not_found"
              : "internal",
        );
      }
      return response.json();
    },
    staleTime: (query) => (isSettled(query.state.data) ? Number.POSITIVE_INFINITY : EMPTY_STALE_MS),
    retry: (failures, error) => !(error instanceof ClipEventsError) && failures < 3,
  });
