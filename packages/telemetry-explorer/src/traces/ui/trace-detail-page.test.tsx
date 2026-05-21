import { useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Span } from "../data/types";
import { TraceDetail } from "./trace-detail-page";

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

vi.mock("./timeline/timeline-view", () => ({
  TimelineView: () => <div data-testid="timeline-view" />,
}));

const repo = {
  search: vi.fn(),
  getTrace: vi.fn(),
  listServiceIdentities: vi.fn(),
};

const span: Span = {
  traceId: "trace-1",
  spanId: "span-1",
  parentSpanId: "",
  spanName: "GET /home",
  serviceName: "web",
  serviceNamespace: "",
  timestamp: "2026-05-20 12:00:00.000",
  timestampNs: "1000",
  duration: "500",
  statusCode: "Ok",
  spanKind: "Server",
  spanAttributes: {},
  resourceAttributes: {},
  events: [],
  links: [],
};

describe("TraceDetail", () => {
  it("renders a back button in the trace header", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    vi.mocked(useQuery).mockReturnValue({
      data: [span],
      isPending: false,
      error: null,
      refetch: vi.fn(),
    } as never);

    render(
      <TraceDetail
        repo={repo}
        traceId="trace-1"
        search={{}}
        onBack={onBack}
        onSpanChange={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /back to traces/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
