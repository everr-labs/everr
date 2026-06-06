import type {
  DesktopAlertNotification,
  DesktopNotification,
} from "@everr/ui/lib/notification";
import { QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query-client";
import { NotificationCard } from "./notification-window";

function renderWithProviders(node: ReactNode) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      {node}
    </QueryClientProvider>,
  );
}

function createAlertNotification(
  overrides: Partial<DesktopAlertNotification> = {},
): DesktopAlertNotification {
  return {
    kind: "alert",
    dedupeKey: "alert:10:20",
    alertDefinitionId: 10,
    alertEventId: 20,
    service: "api",
    name: "high-5xx-routes",
    severity: "critical",
    status: "firing",
    summary: "2 routes have elevated 5xxs",
    description: "Top route: /api",
    occurredAt: "2026-06-06T10:00:00Z",
    detailsUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
    rowCount: 2,
    ...overrides,
  };
}

async function renderNotificationCard(notification: DesktopNotification) {
  const dismissSpy = vi.fn(() => null);
  const openSpy = vi.fn(() => null);
  const copySpy = vi.fn(() => null);

  mockIPC(
    (cmd) => {
      switch (cmd) {
        case "dismiss_active_notification":
          return dismissSpy();
        case "open_notification_target":
          return openSpy();
        case "copy_notification_auto_fix_prompt":
          return copySpy();
        default:
          throw new Error(`Unexpected IPC command: ${cmd}`);
      }
    },
    { shouldMockEvents: true },
  );

  await act(async () => {
    renderWithProviders(<NotificationCard notification={notification} />);
    await Promise.resolve();
    await Promise.resolve();
  });

  return {
    dismissSpy,
    openSpy,
    copySpy,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("NotificationCard alert rendering", () => {
  it("renders critical alert details without the auto-fix action", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T10:03:00Z"));

    await renderNotificationCard(createAlertNotification());

    expect(screen.getByText("Everr - Critical alert")).toBeInTheDocument();
    expect(screen.getByText("api / high-5xx-routes")).toBeInTheDocument();
    expect(screen.getByText("2 routes have elevated 5xxs")).toBeInTheDocument();
    expect(screen.getByText("2 matching rows")).toBeInTheDocument();
    expect(screen.getByText("3m ago")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Auto-fix prompt" }),
    ).not.toBeInTheDocument();
  });

  it("opens alert details from the shared open button", async () => {
    const { openSpy, copySpy } = await renderNotificationCard(
      createAlertNotification(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    expect(copySpy).not.toHaveBeenCalled();
  });
});
