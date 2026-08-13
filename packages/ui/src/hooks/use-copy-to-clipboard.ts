import { type RefObject, useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

/**
 * Copy text, and say what happened.
 *
 * Clipboard access is refusable — a permissions policy, an unfocused document,
 * an insecure context — and the interesting case is what the reader can do
 * next. Pass `selectOnFailure` a node holding the same text and a refusal
 * selects it, so a manual copy is one keystroke away instead of a dead end.
 *
 * "Copied" clears itself; "failed" stays until the next attempt, because the
 * reader needs it on screen long enough to act on the selection it made.
 */
export function useCopyToClipboard(
  text: string,
  options: {
    selectOnFailure?: RefObject<HTMLElement | null>;
    resetMs?: number;
  } = {},
) {
  const { selectOnFailure, resetMs = 2000 } = options;
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = () => {
    clearTimeout(resetTimer.current);
    // `writeText` can be missing entirely (insecure context) or throw
    // synchronously rather than rejecting, so the call is wrapped: every way it
    // can fail has to reach the same recovery, or the selection fallback never
    // runs where it is needed most.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => {
          setState("copied");
          resetTimer.current = setTimeout(() => setState("idle"), resetMs);
        },
        () => {
          const node = selectOnFailure?.current;
          if (node) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
          setState("failed");
        },
      );
  };

  return { state, copy };
}
