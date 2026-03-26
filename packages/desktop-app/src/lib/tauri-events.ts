import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { EventName, UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useEffectEvent } from "react";
import { safeGetCurrentWindow } from "./tauri";

export function useTauriEvent<T = unknown>(
  eventName: EventName,
  onEvent: (payload: T) => void,
) {
  const handleEvent = useEffectEvent((payload: T) => {
    onEvent(payload);
  });

  useEffect(() => {
    const appWindow = safeGetCurrentWindow();
    if (!appWindow) {
      return;
    }

    let unlisten: UnlistenFn | undefined;

    void appWindow
      .listen<T>(eventName, (event) => {
        handleEvent(event.payload);
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });

    return () => {
      unlisten?.();
    };
  }, [eventName, handleEvent]);
}

export function useInvalidateOnTauriEvent(
  eventName: string,
  invalidate: (queryClient: QueryClient) => void,
) {
  const queryClient = useQueryClient();
  const handleInvalidate = useEffectEvent(() => {
    invalidate(queryClient);
  });

  useTauriEvent(eventName, () => {
    handleInvalidate();
  });
}
