import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "@/data/runs/schemas";
import { LogViewer } from "./log-viewer";

// Virtuoso needs element dimensions that jsdom doesn't provide
beforeEach(() => {
  // Mock element dimensions so Virtuoso calculates a visible range
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 800;
    },
  });
});

// Mock the summarizer hook — Chrome Summarizer API not available in jsdom
vi.mock("@/hooks/use-log-summarizer", () => ({
  useLogSummarizer: () => ({
    isAvailable: false,
    status: "idle" as const,
    summary: "",
    error: null,
    summarize: vi.fn(),
    reset: vi.fn(),
  }),
}));

// Mock the chart — Recharts won't render in jsdom
vi.mock("./log-volume-chart", () => ({
  LogVolumeChart: () => <div data-testid="log-volume-chart" />,
}));

// Mock Virtuoso — it doesn't render items in jsdom due to missing layout
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    totalCount,
    itemContent,
    firstItemIndex = 0,
  }: {
    totalCount: number;
    itemContent: (index: number) => React.ReactNode;
    firstItemIndex?: number;
    [key: string]: unknown;
  }) => (
    <div data-testid="virtuoso-mock">
      {Array.from({ length: totalCount }, (_, i) => (
        <div key={i}>{itemContent(firstItemIndex + i)}</div>
      ))}
    </div>
  ),
}));

function makeLog(body: string, offsetSeconds = 0): LogEntry {
  const ts = new Date(Date.UTC(2024, 0, 1, 0, 0, offsetSeconds)).toISOString();
  return { timestamp: ts, body };
}

const simpleLogs: LogEntry[] = [
  makeLog("Starting build...", 0),
  makeLog("Compiling...", 1),
  makeLog("Done.", 2),
];

const groupedLogs: LogEntry[] = [
  makeLog("##[group]Setup", 0),
  makeLog("Installing deps...", 1),
  makeLog("##[endgroup]", 2),
  makeLog("##[group]Build", 3),
  makeLog("Compiling...", 4),
  makeLog("##[endgroup]", 5),
];

describe("LogViewer", () => {
  it("renders empty state when logs is empty", () => {
    render(<LogViewer logs={[]} />);
    expect(screen.getByText("No logs found")).toBeInTheDocument();
  });

  it("renders log lines for simple logs", () => {
    render(<LogViewer logs={simpleLogs} />);
    expect(screen.getByText("Starting build...")).toBeInTheDocument();
    expect(screen.getByText("Compiling...")).toBeInTheDocument();
    expect(screen.getByText("Done.")).toBeInTheDocument();
  });

  it("shows step name in the header", () => {
    render(<LogViewer logs={simpleLogs} stepName="Run tests" />);
    expect(screen.getByText("Run tests")).toBeInTheDocument();
  });

  it("hides Expand/Collapse buttons when there are no groups", () => {
    render(<LogViewer logs={simpleLogs} />);
    expect(screen.queryByText("Expand")).not.toBeInTheDocument();
    expect(screen.queryByText("Collapse")).not.toBeInTheDocument();
  });

  it("expands all groups when Expand is clicked", async () => {
    const user = userEvent.setup();
    render(<LogViewer logs={groupedLogs} />);

    // Groups are collapsed by default, so children should not be visible
    expect(screen.queryByText("Installing deps...")).not.toBeInTheDocument();
    expect(screen.queryByText("Compiling...")).not.toBeInTheDocument();

    await user.click(screen.getByText("Expand"));

    expect(screen.getByText("Installing deps...")).toBeInTheDocument();
    expect(screen.getByText("Compiling...")).toBeInTheDocument();
  });

  it("toggles group visibility when clicking a group header", async () => {
    const user = userEvent.setup();
    render(<LogViewer logs={groupedLogs} />);

    // Group headers should be visible
    expect(screen.getByText("Setup")).toBeInTheDocument();

    // Children hidden by default
    expect(screen.queryByText("Installing deps...")).not.toBeInTheDocument();

    // Click the Setup group header to expand it
    await user.click(screen.getByText("Setup"));
    expect(screen.getByText("Installing deps...")).toBeInTheDocument();

    // Click again to collapse
    await user.click(screen.getByText("Setup"));
    expect(screen.queryByText("Installing deps...")).not.toBeInTheDocument();
  });

  it("renders ANSI escape codes", () => {
    render(<LogViewer logs={[makeLog("\x1b[31mHello\x1b[0m", 0)]} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toHaveClass("ansi-red-fg");
  });
});
