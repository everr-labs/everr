import type { Span } from "@everr/telemetry-explorer/traces";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LoadedClip } from "@/data/replay/server";
import type { ReplayHandle } from "./player";
import { clipEvents } from "./player-panel";

// Shared by the trace and error players. It belongs to the Replay UI, not to
// either route, so the two views do not drift.
export const EMPTY_SPANS: Span[] = [];

/**
 * The playback state both players share: the Replayer handle, the play state,
 * the scrub position, and the animation frame that follows the player clock.
 * `onClock` receives the absolute time under the player while it plays.
 */
export function usePlayback(
  clip: LoadedClip | null,
  onClock?: (absoluteMs: number) => void,
) {
  const playerRef = useRef<ReplayHandle>(null);
  const [playing, setPlaying] = useState(false);
  const [scrub, setScrub] = useState<{ clipId: string; ms: number } | null>(
    null,
  );
  const events = useMemo(() => clipEvents(clip), [clip]);
  const offsetMs =
    clip && scrub?.clipId === clip.clipId
      ? scrub.ms
      : (clip?.startOffsetMs ?? 0);
  const firstEventMs = events[0]?.timestamp ?? 0;
  const onClockRef = useRef(onClock);
  onClockRef.current = onClock;

  useEffect(() => {
    if (!playing || !clip) return;
    let frame = 0;
    const tick = () => {
      const next = playerRef.current?.getTime();
      if (next != null) {
        setScrub({ clipId: clip.clipId, ms: next });
        onClockRef.current?.(firstEventMs + next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, clip, firstEventMs]);

  const togglePlay = () => {
    if (!clip) return;
    const next = !playing;
    setPlaying(next);
    playerRef.current?.seek(offsetMs, next);
  };

  const seek = (ms: number) => {
    if (!clip) return;
    setScrub({ clipId: clip.clipId, ms });
    playerRef.current?.seek(ms, playing);
  };

  const stop = () => setPlaying(false);

  return {
    playerRef,
    playing,
    events,
    firstEventMs,
    offsetMs,
    togglePlay,
    seek,
    stop,
  };
}
