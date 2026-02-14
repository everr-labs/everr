import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TimeRange } from "@/lib/time-range";
import { QUICK_RANGE_GROUPS } from "@/lib/time-range";
import { TimeRangePicker } from "./time-range-picker";

const mockSetTimeRange = vi.fn();

vi.mock("@/hooks/use-time-range", () => ({
  useTimeRange: () => ({
    timeRange: mockTimeRange,
    setTimeRange: mockSetTimeRange,
  }),
}));

let mockTimeRange: TimeRange = { from: "now-7d", to: "now" };

function renderPicker(
  value: TimeRange = { from: "now-7d", to: "now" },
  onChange = mockSetTimeRange,
) {
  mockTimeRange = value;
  mockSetTimeRange.mockReset();
  if (onChange !== mockSetTimeRange) {
    mockSetTimeRange.mockImplementation((...args: unknown[]) =>
      onChange(...args),
    );
  }
  const user = userEvent.setup();
  render(<TimeRangePicker />);
  return { user, onChange };
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole("button", { expanded: false });
  await user.click(trigger);
}

describe("TimeRangePicker", () => {
  it("renders the trigger with the current range label", () => {
    renderPicker();
    expect(
      screen.getByRole("button", { name: /last 7 days/i }),
    ).toBeInTheDocument();
  });

  it("shows group labels when opened", async () => {
    const { user } = renderPicker();
    await openPicker(user);

    for (const group of QUICK_RANGE_GROUPS) {
      expect(screen.getByText(group.label)).toBeInTheDocument();
    }
  });

  it("shows all quick range items when opened", async () => {
    const { user } = renderPicker();
    await openPicker(user);

    within(screen.getByRole("dialog"));
    for (const group of QUICK_RANGE_GROUPS) {
      for (const range of group.ranges) {
        expect(
          within(screen.getByRole("dialog")).getByRole("button", {
            name: range.label,
          }),
        ).toBeInTheDocument();
      }
    }
  });

  it("calls onChange when a quick range is clicked", async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);

    await user.click(screen.getByRole("button", { name: "Last 24 hours" }));
    expect(onChange).toHaveBeenCalledWith({ from: "now-24h", to: "now" });
  });

  describe("search", () => {
    it("filters quick ranges by search term", async () => {
      const { user } = renderPicker();
      await openPicker(user);

      await user.type(
        screen.getByRole("searchbox", { name: "search" }),
        "hour",
      );

      expect(
        screen.getByRole("button", { name: "Last 1 hour" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Last 6 hours" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Last 7 days" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Today" }),
      ).not.toBeInTheDocument();
    });

    it("shows 'No matches' when search has no results", async () => {
      const { user } = renderPicker();
      await openPicker(user);

      await user.type(
        screen.getByRole("searchbox", { name: "search" }),
        "zzzzz",
      );

      expect(screen.getByText("No matches")).toBeInTheDocument();
    });

    it("hides group labels when their ranges are all filtered out", async () => {
      const { user } = renderPicker();
      await openPicker(user);

      // "Today" only matches Calendar group
      await user.type(
        screen.getByRole("searchbox", { name: "search" }),
        "Today",
      );

      expect(screen.getByText("Calendar")).toBeInTheDocument();
      expect(screen.queryByText("Relative")).not.toBeInTheDocument();
    });

    it("is case-insensitive", async () => {
      const { user } = renderPicker();
      await openPicker(user);

      await user.type(
        screen.getByRole("searchbox", { name: "search" }),
        "YESTERDAY",
      );

      expect(
        screen.getByRole("button", { name: "Yesterday" }),
      ).toBeInTheDocument();
    });
  });

  describe("custom range", () => {
    it("shows From and To inputs", async () => {
      const { user } = renderPicker();
      await openPicker(user);

      expect(screen.getByLabelText("From")).toBeInTheDocument();
      expect(screen.getByLabelText("To")).toBeInTheDocument();
    });

    it("pre-fills custom inputs with current value", async () => {
      const { user } = renderPicker({ from: "now-2d", to: "now" });
      await openPicker(user);

      expect(screen.getByLabelText("From")).toHaveValue("now-2d");
      expect(screen.getByLabelText("To")).toHaveValue("now");
    });

    it("shows invalid expression for bad input", async () => {
      const { user } = renderPicker();
      await openPicker(user);

      const fromInput = screen.getByLabelText("From");
      await user.clear(fromInput);
      await user.type(fromInput, "garbage");

      expect(screen.getByText("Invalid expression")).toBeInTheDocument();
    });

    it("disables Apply button when expressions are invalid", async () => {
      const { user } = renderPicker();
      await openPicker(user);

      const fromInput = screen.getByLabelText("From");
      await user.clear(fromInput);
      await user.type(fromInput, "invalid");

      expect(
        screen.getByRole("button", { name: "Apply time range" }),
      ).toBeDisabled();
    });

    it("enables Apply button with valid expressions", async () => {
      const { user } = renderPicker();
      await openPicker(user);

      expect(
        screen.getByRole("button", { name: "Apply time range" }),
      ).not.toBeDisabled();
    });

    it("shows error and disables Apply when from is after to", async () => {
      const { user } = renderPicker();
      await openPicker(user);

      const fromInput = screen.getByLabelText("From");
      await user.clear(fromInput);
      await user.type(fromInput, "now");

      const toInput = screen.getByLabelText("To");
      await user.clear(toInput);
      await user.type(toInput, "now-7d");

      expect(
        screen.getByText(/"From" must be before "To"/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Apply time range" }),
      ).toBeDisabled();
    });

    it("calls onChange with custom values on Apply", async () => {
      const { user, onChange } = renderPicker();
      await openPicker(user);

      const fromInput = screen.getByLabelText("From");
      await user.clear(fromInput);
      await user.type(fromInput, "now-3h");

      await user.click(
        screen.getByRole("button", { name: "Apply time range" }),
      );

      expect(onChange).toHaveBeenCalledWith({ from: "now-3h", to: "now" });
    });
  });
});
