import { useEffect, useRef, useState } from "react";
import { CcEventSchema } from "@/data/cc/schema";
import type { CcEvent } from "@/data/cc/types";

const MAX_EVENTS = 500;

/** Prepend `item`, cap length at `max`. Newest-first. Pure — unit tested. */
export function appendBounded<T>(buf: T[], item: T, max: number): T[] {
  const next = [item, ...buf];
  return next.length > max ? next.slice(0, max) : next;
}

export function useCcEvents() {
  const [events, setEvents] = useState<CcEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    const es = new EventSource("/api/cc/events-stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      if (pausedRef.current) return;
      const parsed = CcEventSchema.safeParse(JSON.parse(msg.data));
      if (parsed.success)
        setEvents((b) => appendBounded(b, parsed.data, MAX_EVENTS));
    };
    return () => es.close();
  }, []);

  return {
    events,
    connected,
    clear: () => setEvents([]),
    setPaused: (p: boolean) => {
      pausedRef.current = p;
    },
  };
}
