import { QUICK_RANGE_GROUPS } from "@everr/ui/components/time-range-picker";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { TimeRangePicker } from "./time-range-picker";

const mockSetTimeRange = vi.fn();

vi.mock("#app/hooks/use-time-range.ts", () => ({
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
    mockSetTimeRange.mockImplementation((...args: unknown[]) => onChange(...args));
  }
  const user = userEvent.setup({ skipHover: true });
  render(<TimeRangePicker />);
  return { user, onChange };
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole("button", { expanded: false });
  await user.click(trigger);
}

function setInputValue(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("TimeRangePicker", () => {
  it("lists every quick range and applies the one clicked", async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);

    const dialog = within(screen.getByRole("dialog"));
    for (const group of QUICK_RANGE_GROUPS) {
      expect(dialog.getByText(group.label)).toBeInTheDocument();
      for (const range of group.ranges) {
        expect(dialog.getByRole("button", { name: range.label })).toBeInTheDocument();
      }
    }

    await user.click(screen.getByRole("button", { name: "Last 24 hours" }));
    expect(onChange).toHaveBeenCalledWith({ from: "now-24h", to: "now" });
  });

  it("filters quick ranges case-insensitively and hides emptied groups", async () => {
    const { user } = renderPicker();
    await openPicker(user);
    const search = screen.getByRole("searchbox", { name: "search" });

    setInputValue(search, "hour");
    expect(screen.getByRole("button", { name: "Last 1 hour" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last 6 hours" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last 7 days" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();

    // "Today" only matches the Calendar group
    setInputValue(search, "Today");
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.queryByText("Relative")).not.toBeInTheDocument();

    setInputValue(search, "YESTERDAY");
    expect(screen.getByRole("button", { name: "Yesterday" })).toBeInTheDocument();

    setInputValue(search, "zzzzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("validates a custom range before applying it", async () => {
    const { user, onChange } = renderPicker({ from: "now-2d", to: "now" });
    expect(screen.getByRole("button", { name: /last 2 days/i })).toBeInTheDocument();
    await openPicker(user);

    const fromInput = screen.getByLabelText("From");
    const toInput = screen.getByLabelText("To");
    const apply = screen.getByRole("button", { name: "Apply time range" });
    expect(fromInput).toHaveValue("now-2d");
    expect(toInput).toHaveValue("now");
    expect(apply).not.toBeDisabled();

    setInputValue(fromInput, "garbage");
    expect(screen.getByText("Invalid expression")).toBeInTheDocument();
    expect(apply).toBeDisabled();

    setInputValue(fromInput, "now");
    setInputValue(toInput, "now-7d");
    expect(screen.getByText(/"From" must be before "To"/)).toBeInTheDocument();
    expect(apply).toBeDisabled();

    setInputValue(fromInput, "now-3h");
    setInputValue(toInput, "now");
    await user.click(apply);
    expect(onChange).toHaveBeenCalledWith({ from: "now-3h", to: "now" });
  });
});
