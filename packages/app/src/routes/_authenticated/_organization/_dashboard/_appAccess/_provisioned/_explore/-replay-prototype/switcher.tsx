import { useEffect } from "react";
import { formatSeconds, signals } from "./fixture";
import type { Host, RecordingMode } from "./types";

const VARIANTS = [
  { key: "A", name: "Stage" },
  { key: "B", name: "Dock" },
  { key: "C", name: "Editor" },
] as const;

export type VariantKey = (typeof VARIANTS)[number]["key"];

const HOSTS: { key: Host; label: string }[] = [
  { key: "trace", label: "Trace" },
  { key: "error", label: "Error" },
];

const MODES: { key: RecordingMode; label: string }[] = [
  { key: "recording", label: "Recording" },
  { key: "none", label: "No recording" },
  { key: "no-session", label: "No session" },
];

// PROTOTYPE harness. Not part of any variant. Hidden in production builds.
export function PrototypeSwitcher({
  variant,
  host,
  mode,
  timeMs,
  selectedId,
  onVariant,
  onHost,
  onMode,
}: {
  variant: VariantKey;
  host: Host;
  mode: RecordingMode;
  timeMs: number;
  selectedId: string;
  onVariant: (key: VariantKey) => void;
  onHost: (host: Host) => void;
  onMode: (mode: RecordingMode) => void;
}) {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest("input, textarea, [contenteditable]") ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = VARIANTS.findIndex((item) => item.key === variant);
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length];
      onVariant(next.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onVariant, variant]);

  if (!import.meta.env.DEV) return null;

  const current = VARIANTS.find((item) => item.key === variant) ?? VARIANTS[0];
  const selected = signals.find((signal) => signal.id === selectedId);

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-full bg-neutral-950 px-2 py-1.5 text-xs text-white shadow-lg">
      <button
        type="button"
        className="rounded-full px-2 py-1 hover:bg-white/10"
        aria-label="Previous variant"
        onClick={() => {
          const index = VARIANTS.findIndex((item) => item.key === variant);
          onVariant(
            VARIANTS[(index - 1 + VARIANTS.length) % VARIANTS.length].key,
          );
        }}
      >
        ←
      </button>
      <span className="px-1 font-medium">
        {current.key} ({current.name})
      </span>
      <button
        type="button"
        className="rounded-full px-2 py-1 hover:bg-white/10"
        aria-label="Next variant"
        onClick={() => {
          const index = VARIANTS.findIndex((item) => item.key === variant);
          onVariant(VARIANTS[(index + 1) % VARIANTS.length].key);
        }}
      >
        →
      </button>
      <span className="mx-1 h-4 w-px bg-white/20" />
      {HOSTS.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={host === item.key}
          className={`rounded-full px-2 py-1 ${host === item.key ? "bg-white text-neutral-950" : "hover:bg-white/10"}`}
          onClick={() => onHost(item.key)}
        >
          {item.label}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-white/20" />
      {MODES.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={mode === item.key}
          className={`rounded-full px-2 py-1 ${mode === item.key ? "bg-white text-neutral-950" : "hover:bg-white/10"}`}
          onClick={() => onMode(item.key)}
        >
          {item.label}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-white/20" />
      <span className="px-2 font-mono text-white/80">
        {formatSeconds(timeMs)} · {selected?.name ?? "none"}
      </span>
    </div>
  );
}
