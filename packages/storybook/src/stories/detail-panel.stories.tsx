import {
  AttributeMap,
  CopyValueButton,
  DetailItem,
  DetailSection,
} from "@everr/ui/components/detail-panel";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ClockIcon, ServerIcon, TagIcon } from "lucide-react";

const meta = {
  title: "Layout/DetailPanel",
  component: DetailSection,
} satisfies Meta<typeof DetailSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Section: Story = {
  args: { title: "Span", children: null },
  render: (args) => (
    <div className="w-80">
      <DetailSection {...args}>
        <DetailItem
          icon={<ServerIcon />}
          label="service.name"
          value="checkout-api"
          mono
        />
        <DetailItem icon={<ClockIcon />} label="Duration" value="412 ms" />
      </DetailSection>
    </div>
  ),
};

export const ItemStates: Story = {
  args: { title: "Item states", children: null },
  render: (args) => (
    <div className="w-80">
      <DetailSection {...args}>
        <DetailItem label="Plain value" value="checkout-api" />
        <DetailItem
          label="Monospaced value"
          value="4f21ac9e0b1d47c8a3f5"
          mono
        />
        <DetailItem icon={<TagIcon />} label="With icon" value="production" />
        <DetailItem label="Missing value" />
        <DetailItem
          label="Long value"
          value="https://app.example.com/traces/4f21ac9e0b1d47c8a3f5e6b7c8d9e0f1"
          mono
        />
      </DetailSection>
    </div>
  ),
};

export const Attributes: Story = {
  args: { title: "Attributes", children: null },
  render: () => (
    <div className="w-80">
      <AttributeMap
        title="Resource attributes"
        map={{
          "service.name": "checkout-api",
          "service.version": "2.14.0",
          "deployment.environment": "production",
          "host.name": "ip-10-0-3-51",
        }}
      />
    </div>
  ),
};

export const CopyButton: Story = {
  args: { title: "Copy", children: null },
  render: () => (
    <div className="group bg-card w-64 rounded-md border px-2.5 py-2">
      <span className="flex items-center justify-between">
        trace_id
        <CopyValueButton value="4f21ac9e0b1d47c8a3f5e6b7c8d9e0f1" />
      </span>
    </div>
  ),
};

export const FullPanel: Story = {
  args: { title: "Full panel", children: null },
  render: () => (
    <div className="bg-card h-[28rem] w-80 overflow-y-auto rounded-lg border p-3">
      <DetailSection title="Span">
        <DetailItem icon={<ServerIcon />} label="Name" value="POST /checkout" />
        <DetailItem icon={<ClockIcon />} label="Duration" value="412 ms" />
        <DetailItem label="Status" value="OK" />
      </DetailSection>
      <AttributeMap
        title="Span attributes"
        map={{
          "http.request.method": "POST",
          "http.response.status_code": "200",
          "http.route": "/checkout",
          "url.path": "/checkout",
        }}
      />
      <AttributeMap
        title="Resource attributes"
        map={{
          "service.name": "checkout-api",
          "deployment.environment": "production",
        }}
      />
    </div>
  ),
};
