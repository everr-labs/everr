import { FilterSearchBar } from "@everr/ui/components/filter-search-bar";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Hash } from "lucide-react";
import { useState } from "react";

// The bar keeps a draft of its own and reports the value it commits, so every
// story owns the committed value the way the filter rails do.
function StatefulSearchBar({
  value: initialValue,
  ...props
}: Parameters<typeof FilterSearchBar>[0]) {
  const [value, setValue] = useState(initialValue);
  return <FilterSearchBar {...props} value={value} onChange={setValue} />;
}

const meta = {
  title: "Data/FilterSearchBar",
  component: FilterSearchBar,
  args: {
    id: "search",
    label: "Search",
    value: "",
    placeholder: "Search messages, errors, IDs",
    onChange: () => {},
  },
  // Keyed on the arg so editing `value` in the controls panel seeds a fresh
  // draft, instead of leaving the mounted bar on the value it started with.
  render: (args) => (
    <div className="w-72">
      <StatefulSearchBar key={args.value} {...args} />
    </div>
  ),
} satisfies Meta<typeof FilterSearchBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// Focus the field to see the Enter hint: it holds the slot the clear button
// takes when the field has a committed value.
export const Default: Story = {};

export const WithValue: Story = {
  args: { value: "timeout" },
};

// The trace field of the Logs rail. It reads one kind of value, so it carries
// its own icon instead of the magnifier.
export const TraceId: Story = {
  args: {
    id: "trace-id",
    label: "Trace",
    icon: Hash,
    placeholder: "Any trace",
    value: "4bf92f3577b34da6a3ce929d0e0e4736",
  },
};

export const InAFilterRail: Story = {
  render: () => (
    <div className="flex w-64 flex-col gap-4 rounded-md border p-3">
      <StatefulSearchBar
        id="rail-search"
        label="Search"
        value="checkout"
        placeholder="Search messages, errors, IDs"
        onChange={() => {}}
      />
      <StatefulSearchBar
        id="rail-trace"
        label="Trace"
        icon={Hash}
        value=""
        placeholder="Any trace"
        onChange={() => {}}
      />
    </div>
  ),
} satisfies Story;
