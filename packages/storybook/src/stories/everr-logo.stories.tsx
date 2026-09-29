import { EverrLogo } from "@everr/ui/components/everr-logo";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Brand/EverrLogo",
  component: EverrLogo,
} satisfies Meta<typeof EverrLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Large: Story = {
  args: { size: "lg" },
};
