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
        expect(dialog.getByRole("option", { name: range.label })).toBeInTheDocument();
      }
    }

    await user.click(screen.getByRole("option", { name: "Last 24 hours" }));
    expect(onChange).toHaveBeenCalledWith({ from: "now-24h", to: "now" });
  });

  it("filters quick ranges case-insensitively and hides emptied groups", async () => {
    const { user } = renderPicker();
    await openPicker(user);
    const search = screen.getByRole("combobox", { name: "Search relative range" });

    setInputValue(search, "hour");
    expect(screen.getByRole("option", { name: "Last 1 hour" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Last 6 hours" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Last 7 days" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Today" })).not.toBeInTheDocument();

    // "Today" only matches the Calendar group
    setInputValue(search, "Today");
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.queryByText("Relative")).not.toBeInTheDocument();

    setInputValue(search, "YESTERDAY");
    expect(screen.getByRole("option", { name: "Yesterday" })).toBeInTheDocument();

    setInputValue(search, "zzzzz");
    expect(screen.getByText(/No range matches/)).toHaveTextContent("“zzzzz”");
  });

  it("turns a typed duration into a range", async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);
    const search = screen.getByRole("combobox", { name: "Search relative range" });

    // A preset typed as a duration finds the preset.
    setInputValue(search, "1h");
    expect(screen.getByRole("option", { name: "Last 1 hour" })).toBeInTheDocument();

    // "m" is minutes; months need "mo".
    setInputValue(search, "90m");
    expect(screen.getByRole("option", { name: "Last 90 minutes" })).toBeInTheDocument();
    setInputValue(search, "3 mo");
    expect(screen.getByRole("option", { name: "Last 3 months" })).toBeInTheDocument();

    setInputValue(search, "last 3 hours");
    await user.click(screen.getByRole("option", { name: "Last 3 hours" }));
    expect(onChange).toHaveBeenCalledWith({ from: "now-3h", to: "now" });
  });

  it("moves through the ranges with the arrow keys and picks with Enter", async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);
    const search = screen.getByRole("combobox", { name: "Search relative range" });

    // A search highlights its first match; Down moves to the next one.
    await user.type(search, "days{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith({ from: "now-7d", to: "now" });
  });

  it("picks a typed duration with Enter", async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);
    await user.type(screen.getByRole("combobox", { name: "Search relative range" }), "3h{Enter}");
    expect(onChange).toHaveBeenCalledWith({ from: "now-3h", to: "now" });
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
    expect(screen.getByText("Not a date or expression")).toBeInTheDocument();
    expect(apply).toBeDisabled();

    setInputValue(fromInput, "now");
    setInputValue(toInput, "now-7d");
    expect(screen.getByText("From must be before To")).toBeInTheDocument();
    expect(apply).toBeDisabled();

    setInputValue(fromInput, "now-3h");
    setInputValue(toInput, "now");
    await user.click(apply);
    expect(onChange).toHaveBeenCalledWith({ from: "now-3h", to: "now" });
  });

  it("picks a day on the calendar and stores it as UTC", async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);

    // One click picks the whole day, local time.
    await user.click(screen.getByRole("button", { name: /^Today/ }));
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 0);
    await user.click(screen.getByRole("button", { name: "Apply time range" }));
    expect(onChange).toHaveBeenCalledWith({ from: start.toISOString(), to: end.toISOString() });
  });

  it("keeps typed times when a day is picked", async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);
    setInputValue(screen.getByLabelText("From"), "2026-03-09 09:30");
    setInputValue(screen.getByLabelText("To"), "2026-03-10 18:00");
    await user.click(screen.getByRole("button", { name: /^Today/ }));
    await user.click(screen.getByRole("button", { name: "Apply time range" }));
    const today = new Date();
    const at = (h: number, m: number) =>
      new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m).toISOString();
    expect(onChange).toHaveBeenCalledWith({ from: at(9, 30), to: at(18, 0) });
  });

  it("reads a typed date as local time", async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);
    setInputValue(screen.getByLabelText("From"), "2026-03-09 9:30");
    setInputValue(screen.getByLabelText("To"), "2026-03-10");
    await user.click(screen.getByRole("button", { name: "Apply time range" }));
    expect(onChange).toHaveBeenCalledWith({
      from: new Date(2026, 2, 9, 9, 30).toISOString(),
      to: new Date(2026, 2, 10).toISOString(),
    });
  });

  it("applies a custom range with Enter", async () => {
    const { user, onChange } = renderPicker();
    await openPicker(user);
    setInputValue(screen.getByLabelText("From"), "now-90m");
    await user.type(screen.getByLabelText("To"), "{Enter}");
    expect(onChange).toHaveBeenCalledWith({ from: "now-90m", to: "now" });
  });
});
