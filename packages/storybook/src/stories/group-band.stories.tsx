import { Button } from "@everr/ui/components/button";
import { GroupBand } from "@everr/ui/components/group-band";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ClockIcon, FlameIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

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

/** The list around the groups: the rule between them is the frame's. */
function Frame({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`w-[36rem] divide-y border-y ${className ?? ""}`}>
      {children}
    </div>
  );
}

const meta = {
  title: "Data/GroupBand",
  component: GroupBand,
  args: { label: "Active", count: 1, hint: "now" },
  render: (args) => (
    <Frame>
      <GroupBand {...args}>
        <Rows names={["Collector pod memory spike"]} />
      </GroupBand>
    </Frame>
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
    <Frame>
      <GroupBand label="Firing" count={2} icon={FlameIcon} tone="danger">
        <Rows names={["Always firing (demo)", "Flapping (demo)"]} />
      </GroupBand>
      <GroupBand label="Pending" count={1} icon={ClockIcon} tone="warning">
        <Rows names={["Always pending (demo)"]} />
      </GroupBand>
    </Frame>
  ),
};

/** Each band sticks for exactly its own rows. */
export const Sticky: Story = {
  render: () => (
    <Frame className="h-64 overflow-auto">
      <GroupBand label="Active" count={2} hint="now">
        <Rows names={["Collector pod memory spike", "Checkout latency"]} />
      </GroupBand>
      <GroupBand label="History" count="200+" hint="in range">
        <Rows
          names={Array.from({ length: 12 }, (_, i) => `Silence ${i + 1}`)}
        />
      </GroupBand>
    </Frame>
  ),
};
