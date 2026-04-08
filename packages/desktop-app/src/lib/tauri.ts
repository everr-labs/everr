import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const AUTH_CHANGED_EVENT = "everr://auth-changed";
export const SETTINGS_CHANGED_EVENT = "everr://settings-changed";
export const NOTIFICATION_CHANGED_EVENT = "everr://notification-changed";
export const NOTIFICATION_HOVER_EVENT = "everr://notification-hover";
export const NOTIFICATION_HISTORY_CHANGED_EVENT =
  "everr://notification-history-changed";
export const NOTIFICATION_EXIT_EVENT = "everr://notification-exit";
export const NOTIFICATION_WINDOW_LABEL = "notification";

export function invokeCommand<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  return invoke<TResult>(command, args);
}

export function resolveWindowLabel(): string {
  return safeGetCurrentWindow()?.label ?? "main";
}

export function safeGetCurrentWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export async function closeCurrentWindow() {
  const appWindow = safeGetCurrentWindow();
  if (!appWindow) {
    return;
  }

  await appWindow.close();
}

export function toErrorMessageText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
