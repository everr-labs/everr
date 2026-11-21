import type * as TelemetryTraces from "@everr/telemetry-explorer/traces";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { fakeExploreBackend } from "../../testing/backend";
import { renderExplore } from "../../testing/explore";

vi.mock("@everr/telemetry-explorer/traces", async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryTraces>();
  return {
    ...actual,
    TraceExplorer: () => <div>Trace full page route</div>,
    TracesSearch: ({
      renderTraceLink,
    }: {
      renderTraceLink: (props: {
        traceId: string;
        className: string;
        children: ReactNode;
      }) => ReactNode;
    }) => (
      <div>
        <div>Trace list page</div>
        {renderTraceLink({
          traceId: "trace-1",
          className: "trace-link",
          children: "Open trace trace-1",
        })}
      </div>
    ),
  };
});

describe("/traces route", () => {
  const renderTracesRoute = (url: string) =>
    renderExplore(url, fakeExploreBackend({ repos: { traces: { getTrace: async () => [] } } }))
      .router;

  it("renders the trace as a full page, not the list, when its URL is opened directly", async () => {
    renderTracesRoute("/traces/trace-1");

    expect(await screen.findByText("Trace full page route")).toBeInTheDocument();
    expect(screen.queryByText("Trace list page")).not.toBeInTheDocument();
  });

  it("opens a full-page trace and preserves list filters without adding trace timestamps", async () => {
    const user = userEvent.setup();
    const router = renderTracesRoute("/traces?from=now-1h&to=now");
    await user.click(await screen.findByRole("link", { name: "Open trace trace-1" }));
    expect(await screen.findByText("Trace full page route")).toBeInTheDocument();
    expect(screen.queryByText("Trace list page")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/traces/trace-1");
    expect(router.state.location.search).toMatchObject({
      from: "now-1h",
      to: "now",
    });
    expect(router.state.location.search).not.toHaveProperty("start");
    expect(router.state.location.search).not.toHaveProperty("end");
    expect(router.state.location.maskedLocation).toBeUndefined();
  });

  it("shows the load error with a way back to the list", async () => {
    const { router } = renderExplore(
      "/traces/trace-1?name=checkout&span=abc",
      fakeExploreBackend({
        repos: {
          traces: {
            getTrace: async () => {
              throw new Error("ClickHouse is down");
            },
          },
        },
      }),
    );

    expect(await screen.findByText("Failed to load trace")).toBeInTheDocument();
    expect(screen.getByText("ClickHouse is down")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back to traces" }));
    expect(await screen.findByText("Trace list page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/traces");
    expect(router.state.location.search).toEqual({ name: "checkout" });
  });
});
