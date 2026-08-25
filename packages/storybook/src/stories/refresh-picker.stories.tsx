import {
  getRefreshIntervalMs,
  REFRESH_INTERVALS,
  RefreshPicker,
} from "@everr/ui/components/refresh-picker";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

const meta = {
  title: "Time/RefreshPicker",
  component: RefreshPicker,
  args: {
    value: "off",
    isFetching: false,
    onChange: () => {},
    onRefresh: () => {},
  },
  render: (args) => {
    const [interval, setInterval] = useState(args.value);
    const [fetchCount, setFetchCount] = useState(0);
    return (
      <div className="flex flex-col items-start gap-3">
        <RefreshPicker
          value={interval}
          onChange={setInterval}
          onRefresh={() => setFetchCount((count) => count + 1)}
          isFetching={args.isFetching}
        />
        <code className="text-muted-foreground text-xs">
          interval: {interval} ({getRefreshIntervalMs(interval) ?? "manual"}) ·
          refreshes: {fetchCount}
        </code>
      </div>
    );
  },
} satisfies Meta<typeof RefreshPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};

export const EveryFiveSeconds: Story = {
  args: { value: "5s" },
};

export const EveryFiveMinutes: Story = {
  args: { value: "5m" },
};

export const Fetching: Story = {
  args: { value: "30s", isFetching: true },
};

export const Intervals: Story = {
  render: () => (
    <ul className="text-sm font-mono">
      {REFRESH_INTERVALS.map((entry) => (
        <li key={entry.value}>
          {entry.label}: {getRefreshIntervalMs(entry.value) ?? "no polling"}
        </li>
      ))}
    </ul>
  ),
};
