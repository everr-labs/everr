import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { EventName, UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useEffectEvent } from "react";
import { safeGetCurrentWindow } from "./tauri";

function setIsFullscreen(value: boolean) {
  document.documentElement.dataset.fullscreen = value ? "true" : "false";
}

function cleanupTauriListener(unlisten: UnlistenFn) {
  try {
    void Promise.resolve(unlisten()).catch(() => {});
  } catch {
    // Listener cleanup is best-effort; Tauri may have already removed it.
  }
}

/**
 * Tracks whether the main window is in native (macOS) fullscreen, where the
 * traffic-light buttons are hidden. Used to collapse the titlebar insets so the
 * UI reclaims the space the semaphore otherwise occupies.
 */
export function useIsFullscreen() {
  useEffect(() => {
    const appWindow = safeGetCurrentWindow();
    if (!appWindow) {
      return;
    }

    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    const sync = () => {
      void appWindow.isFullscreen().then((value) => {
        if (!cancelled) {
          setIsFullscreen(value);
        }
      });
    };

    sync();
    void appWindow.onResized(sync).then((cleanup) => {
      if (cancelled) {
        cleanupTauriListener(cleanup);
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      cancelled = true;
      if (unlisten) {
        cleanupTauriListener(unlisten);
      }
    };
  }, []);
}

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
    let cancelled = false;

    void appWindow
      .listen<T>(eventName, (event) => {
        handleEvent(event.payload);
      })
      .then((cleanup) => {
        if (cancelled) {
          cleanupTauriListener(cleanup);
        } else {
          unlisten = cleanup;
        }
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        cleanupTauriListener(unlisten);
      }
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
