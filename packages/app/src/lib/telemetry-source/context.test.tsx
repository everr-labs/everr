import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The cloud client imports the panel server function, which transitively pulls
// in the db client and its server-only env. Same stub as
// use-dashboard-panel-data.test.ts.
vi.mock("@/db/client", () => ({ db: {} }));

import { TelemetrySourceProvider, useTelemetrySource } from "./context";
import { TELEMETRY_SOURCE_STORAGE_KEY } from "./storage";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The probe succeeds, so Local is offerable. */
function collectorReachable() {
  fetchMock.mockResolvedValue(new Response("", { status: 200 }));
}

/** No collector answers on either candidate port. */
function collectorUnreachable() {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
}

function Probe() {
  const { kind, setKind, localAvailable, localUnreachable } =
    useTelemetrySource();
  return (
    <div>
      <span data-testid="kind">{kind}</span>
      <span data-testid="available">{String(localAvailable)}</span>
      <span data-testid="unreachable">{String(localUnreachable)}</span>
      <button type="button" onClick={() => setKind("local")}>
        use local
      </button>
      <button type="button" onClick={() => setKind("cloud")}>
        use cloud
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <TelemetrySourceProvider>
      <Probe />
    </TelemetrySourceProvider>,
  );
}

describe("TelemetrySourceProvider", () => {
  it("defaults to cloud when nothing is stored", async () => {
    collectorReachable();
    renderProvider();

    expect(screen.getByTestId("kind")).toHaveTextContent("cloud");
  });

  it("offers local once a collector answers the probe", async () => {
    collectorReachable();
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("available")).toHaveTextContent("true"),
    );
  });

  it("does not offer local when no collector answers", async () => {
    collectorUnreachable();
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("available")).toHaveTextContent("false"),
    );
  });

  it("restores a stored local choice", async () => {
    window.localStorage.setItem(TELEMETRY_SOURCE_STORAGE_KEY, "local");
    collectorReachable();
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("kind")).toHaveTextContent("local"),
    );
  });

  it("switches source and persists the choice", async () => {
    collectorReachable();
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("available")).toHaveTextContent("true"),
    );

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "use local" }));
    });

    expect(screen.getByTestId("kind")).toHaveTextContent("local");
    expect(window.localStorage.getItem(TELEMETRY_SOURCE_STORAGE_KEY)).toBe(
      "local",
    );
  });

  it("falls back to cloud, and reports it, when a stored local source is unreachable", async () => {
    window.localStorage.setItem(TELEMETRY_SOURCE_STORAGE_KEY, "local");
    collectorUnreachable();
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("unreachable")).toHaveTextContent("true"),
    );
    // Panels keep rendering cloud data rather than failing one by one.
    expect(screen.getByTestId("kind")).toHaveTextContent("cloud");
  });

  it("does not report unreachable while cloud is selected", async () => {
    collectorUnreachable();
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("available")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("unreachable")).toHaveTextContent("false");
  });
});
