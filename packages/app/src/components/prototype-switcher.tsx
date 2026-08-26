// PROTOTYPE, shared floating variant switcher. Hidden in production builds.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: { key: string; name: string }[];
  current: string;
  onChange: (key: string) => void;
}) {
  const idx = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const go = (delta: number) =>
    onChange(variants[(idx + delta + variants.length) % variants.length].key);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-50 shadow-lg ring-1 ring-black/20">
      <button
        type="button"
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-zinc-700"
        aria-label="Previous variant"
      >
        <ChevronLeft className="size-3.5" />
      </button>
      <span className="px-2">
        {variants[idx].key} · {variants[idx].name}
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-zinc-700"
        aria-label="Next variant"
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}
