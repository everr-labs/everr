// PROTOTYPE. Three layouts for Replay inside a Trace and an error.
// Throwaway route: a live trace has no Recording yet, so the variants sit in
// the app shell on fixture data. Switch with ?variant=A|B|C.
import { ExploreSearchShape } from "@everr/telemetry-explorer/filters";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  DURATION_MS,
  ERROR_MS,
  type Signal,
} from "./-replay-prototype/fixture";
import type { ReplayHandle } from "./-replay-prototype/player";
import {
  PrototypeSwitcher,
  type VariantKey,
} from "./-replay-prototype/switcher";
import type { Host, RecordingMode } from "./-replay-prototype/types";
import { VariantDock } from "./-replay-prototype/variant-dock";
import { VariantEditor } from "./-replay-prototype/variant-editor";
import { VariantStage } from "./-replay-prototype/variant-stage";

const SearchSchema = z.object({
  ...ExploreSearchShape,
  variant: z.enum(["A", "B", "C"]).catch("A"),
});

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/replay-prototype",
)({
  staticData: { breadcrumb: "Replay prototype", hideExploreBar: true },
  head: () => ({ meta: [{ title: "Everr - Replay prototype" }] }),
  validateSearch: SearchSchema,
  component: ReplayPrototypePage,
});

function ReplayPrototypePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [host, setHost] = useState<Host>("trace");
  const [mode, setMode] = useState<RecordingMode>("recording");
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState("doc");
  const playerRef = useRef<ReplayHandle>(null);
  const playingRef = useRef(false);
  playingRef.current = playing;

  useEffect(() => {
    if (!playing || mode !== "recording") return;
    let frame = 0;
    const tick = () => {
      const next = playerRef.current?.getTime();
      if (next != null) setTimeMs(Math.min(DURATION_MS, next));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, mode]);

  const seek = (ms: number) => {
    const next = Math.min(DURATION_MS, Math.max(0, ms));
    setTimeMs(next);
    playerRef.current?.seek(next, playingRef.current && mode === "recording");
  };

  const onVariant = (variant: VariantKey) => {
    void navigate({
      to: "/replay-prototype",
      search: (prev) => ({ ...prev, variant }),
      replace: true,
      resetScroll: false,
    });
  };

  const onHost = (next: Host) => {
    setPlaying(false);
    setHost(next);
    setSelectedId(next === "error" ? "err" : "doc");
    setTimeMs(next === "error" ? ERROR_MS : 0);
  };

  const onMode = (next: RecordingMode) => {
    setPlaying(false);
    setMode(next);
  };

  const onSelect = (signal: Signal) => {
    setSelectedId(signal.id);
    seek(signal.t);
  };

  const onTogglePlay = () => {
    if (mode !== "recording") return;
    const next = !playing;
    setPlaying(next);
    playerRef.current?.seek(timeMs, next);
  };

  const props = {
    host,
    mode,
    timeMs,
    playing,
    selectedId,
    playerRef,
    onSeek: seek,
    onSelect,
    onTogglePlay,
    onEnded: () => setPlaying(false),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-16">
      {search.variant === "B" && <VariantDock {...props} />}
      {search.variant === "C" && <VariantEditor {...props} />}
      {search.variant !== "B" && search.variant !== "C" && (
        <VariantStage {...props} />
      )}
      <PrototypeSwitcher
        variant={search.variant}
        host={host}
        mode={mode}
        timeMs={timeMs}
        selectedId={selectedId}
        onVariant={onVariant}
        onHost={onHost}
        onMode={onMode}
      />
    </div>
  );
}
