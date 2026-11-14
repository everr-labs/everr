import { useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

/**
 * Calls `onNavigate` as every navigation starts, before its loaders run, so an
 * overlay closed from it goes away at the tap. Every navigation counts: one
 * to the page already open, and one started from outside the overlay (an item
 * in a portaled menu), which a click handler on the overlay's links misses.
 */
export function useOnNavigate(onNavigate: () => void) {
  const router = useRouter();
  const handle = useEffectEvent(onNavigate);
  useEffect(() => router.subscribe("onBeforeNavigate", () => handle()), [router]);
}
