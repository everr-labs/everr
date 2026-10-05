import { EverrLogoMark } from "@everr/ui/components/everr-logo";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Brand/EverrLogoMark",
  component: EverrLogoMark,
  args: { className: "size-8" },
} satisfies Meta<typeof EverrLogoMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Monochrome: Story = {
  args: { variant: "monochrome" },
};
