import { Button } from "@everr/ui/components/button";
import { GroupBand } from "@everr/ui/components/group-band";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ClockIcon, FlameIcon, PlusIcon } from "lucide-react";

function Rows({ names }: { names: string[] }) {
  return (
    <ul>
      {names.map((name) => (
        <li key={name} className="border-t px-3 py-2.5 text-sm">
          {name}
        </li>
      ))}
    </ul>
  );
}

const meta = {
  title: "Data/GroupBand",
  component: GroupBand,
  args: { label: "Active", count: 1, hint: "now" },
  render: (args) => (
    <div className="w-[36rem] border-y">
      <GroupBand {...args} />
      <Rows names={["Collector pod memory spike"]} />
    </div>
  ),
} satisfies Meta<typeof GroupBand>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A neutral band with the page's one control on its right. */
export const WithAction: Story = {
  args: {
    action: (
      <Button size="sm">
        <PlusIcon className="size-4" />
        New silence
      </Button>
    ),
  },
};

/** Toned bands carry an icon; the words stay muted in both. */
export const Toned: Story = {
  render: () => (
    <div className="w-[36rem] divide-y border-y">
      <div>
        <GroupBand label="Firing" count={2} icon={FlameIcon} tone="danger" />
        <Rows names={["Always firing (demo)", "Flapping (demo)"]} />
      </div>
      <div>
        <GroupBand label="Pending" count={1} icon={ClockIcon} tone="warning" />
        <Rows names={["Always pending (demo)"]} />
      </div>
    </div>
  ),
};

/** Each band wrapped with its rows, so it sticks for exactly those rows. */
export const Sticky: Story = {
  render: () => (
    <div className="h-64 w-[36rem] divide-y overflow-auto border-y">
      <div>
        <GroupBand label="Active" count={2} hint="now" />
        <Rows names={["Collector pod memory spike", "Checkout latency"]} />
      </div>
      <div>
        <GroupBand label="History" count="200+" hint="in range" />
        <Rows
          names={Array.from({ length: 12 }, (_, i) => `Silence ${i + 1}`)}
        />
      </div>
    </div>
  ),
};
