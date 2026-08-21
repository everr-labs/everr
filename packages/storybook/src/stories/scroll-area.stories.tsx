import { ScrollArea } from "@everr/ui/components/scroll-area";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Layout/ScrollArea",
  component: ScrollArea,
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

const services = Array.from({ length: 40 }, (_, i) => `checkout-api-${i + 1}`);

const wideRow =
  "service.name = checkout-api  deployment.environment = production  http.route = /cart/checkout  http.status_code = 200";

export const Default: Story = {
  render: (args) => (
    <ScrollArea {...args} className="border-border h-64 w-72 rounded-md border">
      <ul className="grid gap-1 p-3 font-mono text-sm">
        {services.map((service) => (
          <li key={service}>{service}</li>
        ))}
      </ul>
    </ScrollArea>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <ScrollArea
      orientation="horizontal"
      className="border-border w-72 rounded-md border"
    >
      <p className="whitespace-nowrap p-3 font-mono text-sm">{wideRow}</p>
    </ScrollArea>
  ),
};

export const BothAxes: Story = {
  render: () => (
    <ScrollArea
      orientation="both"
      className="border-border h-64 w-72 rounded-md border"
    >
      <ul className="grid w-max gap-1 p-3 font-mono text-sm">
        {services.map((service) => (
          <li key={service} className="whitespace-nowrap">
            {service} {wideRow}
          </li>
        ))}
      </ul>
    </ScrollArea>
  ),
};

export const ContentThatFits: Story = {
  render: () => (
    <ScrollArea className="border-border h-64 w-72 rounded-md border">
      <p className="p-3 font-mono text-sm">checkout-api</p>
    </ScrollArea>
  ),
};
