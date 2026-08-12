import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The cloud client imports the panel server function, which transitively pulls
// in the db client and its server-only env. Same stub as
// use-dashboard-panel-data.test.ts.
vi.mock("@/db/client", () => ({ db: {} }));

const mocks = vi.hoisted(() => ({
  useSearch: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: mocks.useSearch,
  useNavigate: () => mocks.navigate,
}));

import { TelemetrySourceProvider, useTelemetrySource } from "./context";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mocks.useSearch.mockReturnValue({ source: undefined });
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

/** The search updater the toggle handed to navigate, applied to a given URL. */
function navigatedSearch(prev: Record<string, unknown>) {
  const [call] = mocks.navigate.mock.calls;
  const updater = (call?.[0] as { search: (p: unknown) => unknown }).search;
  return updater(prev) as Record<string, unknown>;
}

describe("TelemetrySourceProvider", () => {
  it("defaults to cloud when the URL carries no source", async () => {
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

  it("reads local from the source param", async () => {
    mocks.useSearch.mockReturnValue({ source: "local" });
    collectorReachable();
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("kind")).toHaveTextContent("local"),
    );
  });

  it("writes the source param when switching to local", async () => {
    collectorReachable();
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("available")).toHaveTextContent("true"),
    );

    await userEvent.click(screen.getByRole("button", { name: "use local" }));

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(navigatedSearch({ from: "now-1h" })).toEqual({
      from: "now-1h",
      source: "local",
    });
  });

  it("clears the source param when switching back to cloud, keeping the URL clean", async () => {
    mocks.useSearch.mockReturnValue({ source: "local" });
    collectorReachable();
    renderProvider();

    await userEvent.click(screen.getByRole("button", { name: "use cloud" }));

    expect(navigatedSearch({ from: "now-1h", source: "local" })).toEqual({
      from: "now-1h",
      source: undefined,
    });
  });

  it("falls back to cloud, and reports it, when the source param is unreachable", async () => {
    mocks.useSearch.mockReturnValue({ source: "local" });
    collectorUnreachable();
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("unreachable")).toHaveTextContent("true"),
    );
    // Panels keep rendering cloud data rather than failing one by one, and the
    // param is left alone so the selection returns once the collector is back.
    expect(screen.getByTestId("kind")).toHaveTextContent("cloud");
    expect(mocks.navigate).not.toHaveBeenCalled();
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
