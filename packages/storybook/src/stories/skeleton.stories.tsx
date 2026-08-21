import { Skeleton } from "@everr/ui/components/skeleton";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Data/Skeleton",
  component: Skeleton,
  args: { className: "h-4 w-48" },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Circle: Story = {
  args: { className: "size-8 rounded-full" },
};

export const TextBlock: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-4 w-40" />
    </div>
  ),
};

export const CardPlaceholder: Story = {
  render: () => (
    <div className="flex w-80 items-center gap-3 rounded-xl border border-border p-4">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
    </div>
  ),
};

export const TablePlaceholder: Story = {
  render: () => (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      {[
        "checkout-api",
        "payments-worker",
        "search-indexer",
        "edge-gateway",
      ].map((service) => (
        <div key={service} className="flex items-center gap-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 flex-1" />
        </div>
      ))}
    </div>
  ),
};
