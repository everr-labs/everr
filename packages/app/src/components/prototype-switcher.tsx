/**
 * PROTOTYPE. The floating bar that flips a page between throwaway variants.
 *
 * Reads and writes a `variant` search param through the router, so a variant
 * is a URL that survives a reload and can be pasted. Arrow keys cycle too,
 * unless a field has focus. Renders nothing in a production build: a stray
 * merge cannot ship the bar to users.
 */
import { cn } from "@everr/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, FlaskConical } from "lucide-react";
import { useEffect } from "react";

export type PrototypeVariant<K extends string> = { key: K; name: string };

function fieldHasFocus(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
    return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

export function PrototypeSwitcher<K extends string>({
  variants,
  current,
  note,
}: {
  variants: readonly PrototypeVariant<K>[];
  current: K;
  /** What the reader must know about the page under the bar, in a few words. */
  note?: string;
}) {
  const navigate = useNavigate();
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    if (!next) return;
    void navigate({
      to: ".",
      // Merge: `from`/`to` live on the dashboard layout's search.
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        variant: next.key,
      }),
      replace: true,
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || fieldHasFocus()) return;
      if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!import.meta.env.DEV) return null;

  const active = variants[index];
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-3">
      <div
        role="toolbar"
        aria-label="Prototype variants"
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-fuchsia-400/40 bg-fuchsia-950/90 py-1 pr-1 pl-3 text-fuchsia-100 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] backdrop-blur"
      >
        <FlaskConical aria-hidden className="size-3.5 text-fuchsia-300" />
        <span className="mr-1 font-mono text-[0.6875rem] tracking-wider text-fuchsia-300 uppercase">
          prototype
        </span>
        <button
          type="button"
          aria-label="Previous variant"
          onClick={() => go(-1)}
          className="rounded-full p-1 hover:bg-fuchsia-100/10 focus-visible:outline-2 focus-visible:outline-fuchsia-300"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-40 text-center text-sm tabular-nums">
          <span className="font-mono text-xs text-fuchsia-300">
            {index + 1}/{variants.length}
          </span>{" "}
          <span className="font-medium">{active?.name}</span>
        </span>
        <button
          type="button"
          aria-label="Next variant"
          onClick={() => go(1)}
          className="rounded-full p-1 hover:bg-fuchsia-100/10 focus-visible:outline-2 focus-visible:outline-fuchsia-300"
        >
          <ChevronRight className="size-4" />
        </button>
        {note && (
          <span
            className={cn(
              "ml-1 hidden border-l border-fuchsia-300/30 pl-2 text-xs text-fuchsia-200/80 sm:inline",
            )}
          >
            {note}
          </span>
        )}
      </div>
    </div>
  );
}
