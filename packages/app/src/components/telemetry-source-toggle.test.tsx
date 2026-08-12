import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {} }));

import { TelemetrySourceProvider } from "@/lib/telemetry-source/context";
import { TELEMETRY_SOURCE_STORAGE_KEY } from "@/lib/telemetry-source/storage";
import { TelemetrySourceBanner } from "./telemetry-source-banner";
import { TelemetrySourceToggle } from "./telemetry-source-toggle";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function collectorReachable() {
  fetchMock.mockResolvedValue(new Response("", { status: 200 }));
}

function collectorUnreachable() {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
}

function renderShell() {
  return render(
    <TelemetrySourceProvider>
      <TelemetrySourceToggle />
      <TelemetrySourceBanner />
    </TelemetrySourceProvider>,
  );
}

describe("TelemetrySourceToggle", () => {
  it("is absent when no collector is reachable and cloud is selected", async () => {
    collectorUnreachable();
    renderShell();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText("Cloud")).not.toBeInTheDocument();
    expect(screen.queryByText("Local")).not.toBeInTheDocument();
  });

  it("appears showing Cloud once a collector answers", async () => {
    collectorReachable();
    renderShell();

    expect(await screen.findByText("Cloud")).toBeInTheDocument();
  });

  it("names the surfaces it affects, so the mixture is not a surprise", async () => {
    collectorReachable();
    renderShell();

    await userEvent.click(await screen.findByText("Cloud"));

    expect(
      await screen.findByText(/Logs, traces and errors always read/i),
    ).toBeInTheDocument();
  });

  it("switches to local and reflects it in the trigger", async () => {
    collectorReachable();
    renderShell();

    await userEvent.click(await screen.findByText("Cloud"));
    await userEvent.click(
      await screen.findByRole("button", { name: /The collector running/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /The collector running/i }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(
      screen.getByRole("button", { name: /Telemetry ingested by Everr/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

describe("TelemetrySourceBanner", () => {
  it("stays hidden while the selected source is answering", async () => {
    collectorReachable();
    renderShell();

    await screen.findByText("Cloud");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("explains the fallback when a stored local source is unreachable", async () => {
    window.localStorage.setItem(TELEMETRY_SOURCE_STORAGE_KEY, "local");
    collectorUnreachable();
    renderShell();

    expect(
      await screen.findByText(/local collector is not answering/i),
    ).toBeInTheDocument();
  });
});
