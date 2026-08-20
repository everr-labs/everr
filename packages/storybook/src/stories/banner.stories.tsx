import {
  Banner,
  BannerActions,
  BannerContent,
  bannerFrameVariants,
} from "@everr/ui/components/banner";
import { Button } from "@everr/ui/components/button";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { InfoIcon, XIcon } from "lucide-react";

const variants = ["neutral", "info", "success", "warning", "danger"] as const;

const meta = {
  title: "Data/Banner",
  component: Banner,
  args: {
    variant: "info",
    className: "w-full justify-between py-1 pl-3.5 pr-1.5",
  },
  render: (args) => (
    <Banner {...args}>
      <div className="flex min-w-0 items-center gap-2">
        <InfoIcon className="size-3.5 shrink-0" />
        <BannerContent className="truncate">
          You are viewing a preview of the alerting rules.
        </BannerContent>
      </div>
      <BannerActions>
        <Button variant="ghost" size="sm">
          Apply
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss">
          <XIcon />
        </Button>
      </BannerActions>
    </Banner>
  ),
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};

export const Neutral: Story = { args: { variant: "neutral" } };

export const Success: Story = { args: { variant: "success" } };

export const Warning: Story = { args: { variant: "warning" } };

export const Danger: Story = { args: { variant: "danger" } };

export const MessageOnly: Story = {
  render: (args) => (
    <Banner {...args} className="w-full py-1 pl-3.5 pr-3.5">
      <BannerContent>Data is delayed by about 40 seconds.</BannerContent>
    </Banner>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex w-full flex-col gap-3">
      {variants.map((variant) => (
        <Banner
          key={variant}
          variant={variant}
          className="w-full justify-between py-1 pl-3.5 pr-1.5"
        >
          <BannerContent className="truncate">{variant}</BannerContent>
          <BannerActions>
            <Button variant="ghost" size="icon-sm" aria-label="Dismiss">
              <XIcon />
            </Button>
          </BannerActions>
        </Banner>
      ))}
    </div>
  ),
};

export const InsideFrame: Story = {
  render: () => (
    <div className="flex w-full flex-col gap-4">
      {variants.map((variant) => (
        <div
          key={variant}
          className={bannerFrameVariants({ variant, className: "rounded-lg" })}
        >
          <Banner
            variant={variant}
            className="w-full justify-between py-1 pl-3.5 pr-1.5"
          >
            <BannerContent className="truncate">
              The frame ring matches the {variant} banner.
            </BannerContent>
          </Banner>
          <div className="p-4 text-xs text-muted-foreground">
            Framed content goes here.
          </div>
        </div>
      ))}
    </div>
  ),
};
