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

// Keys hold the record's identity only. A time resolved against now in a key
// refetches on every render.
export const coveringClipsOptions = (subject: ClipSubject) =>
  queryOptions({
    queryKey: ["recordings", "covering", subject],
    queryFn: () => getCoveringClips({ data: subject }),
    staleTime: Number.POSITIVE_INFINITY,
  });

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
    staleTime: Number.POSITIVE_INFINITY,
    retry: (failures, error) => !(error instanceof ClipEventsError) && failures < 3,
  });
