import { useState } from "react";

/**
 * A ref for a scroll element that keeps its own position by staying mounted.
 * It sets a `data-scroll-restoration-id` new to every mount, so a position the
 * router saved for an earlier mount, kept across a reload, never lands on it.
 */
export function useOwnScrollPosition() {
  const [ref] = useState(() => {
    const id = Math.random().toString(36).slice(2);
    return (element: HTMLElement | Window | null) => {
      if (element instanceof HTMLElement) element.dataset.scrollRestorationId = id;
    };
  });
  return ref;
}
