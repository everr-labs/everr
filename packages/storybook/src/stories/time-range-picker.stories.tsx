import {
  DEFAULT_TIME_RANGE,
  formatTimeRangeDisplay,
  isValidDatemath,
  QUICK_RANGE_GROUPS,
  type TimeRange,
  TimeRangePicker,
} from "@everr/ui/components/time-range-picker";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

const meta = {
  title: "Time/TimeRangePicker",
  component: TimeRangePicker,
  args: {
    value: DEFAULT_TIME_RANGE,
    onChange: () => {},
  },
  render: (args) => {
    const [range, setRange] = useState<TimeRange>(args.value);
    return (
      <div className="flex flex-col items-start gap-3">
        <TimeRangePicker value={range} onChange={setRange} />
        <code className="text-muted-foreground text-xs">
          {range.from} → {range.to}
        </code>
      </div>
    );
  },
} satisfies Meta<typeof TimeRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RelativePreset: Story = {
  args: { value: { from: "now-24h", to: "now" } },
};

export const CalendarPreset: Story = {
  args: { value: { from: "now/d", to: "now/d" } },
};

export const CustomRange: Story = {
  args: { value: { from: "now-3h", to: "now-30m" } },
};

export const AbsoluteRange: Story = {
  args: { value: { from: "2026-08-01T00:00:00Z", to: "2026-08-08T00:00:00Z" } },
};

export const PresetLabels: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {QUICK_RANGE_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs font-medium">
            {group.label}
          </span>
          {group.ranges.map((range) => (
            <code key={range.label} className="text-xs">
              {formatTimeRangeDisplay(range)}: {range.from} → {range.to}
            </code>
          ))}
        </div>
      ))}
    </div>
  ),
};

export const DatemathValidation: Story = {
  render: () => (
    <ul className="text-sm font-mono">
      {["now", "now-15m", "now/w", "now-1d/d", "yesterday", "5 minutes"].map(
        (expr) => (
          <li key={expr}>
            {expr} → {isValidDatemath(expr) ? "valid" : "invalid"}
          </li>
        ),
      )}
    </ul>
  ),
};
