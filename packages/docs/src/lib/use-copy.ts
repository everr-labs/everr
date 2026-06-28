import { useState } from "react";

/** Copy `text` to the clipboard and flag `copied` for `resetMs` afterward.
 *  No-ops where the clipboard API is unavailable (insecure context / SSR). */
export function useCopyToClipboard(text: string, resetMs = 1800) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), resetMs);
      }
    } catch {
      // Clipboard unavailable (insecure context / denied permission) — no-op.
    }
  };

  return { copied, copy };
}
