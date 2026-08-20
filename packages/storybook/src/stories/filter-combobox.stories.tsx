import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

const services = [
  "checkout-api",
  "payments-worker",
  "search-indexer",
  "edge-gateway",
  "notification-fanout",
  "session-store",
];

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const fetchServices = async () => {
  await delay(300);
  return services;
};

const fetchSlowly = async () => {
  await delay(1_000_000);
  return services;
};

const fetchNothing = async () => {
  await delay(300);
  return [] as string[];
};

const ServiceFilter = FilterCombobox<string[]>;

function StatefulFilter({
  initialValues = [],
  ...props
}: Omit<Parameters<typeof ServiceFilter>[0], "values" | "onChange"> & {
  initialValues?: string[];
}) {
  const [values, setValues] = useState(initialValues);
  return <ServiceFilter {...props} values={values} onChange={setValues} />;
}

const meta = {
  title: "Data/FilterCombobox",
  component: ServiceFilter,
  args: {
    label: "Service",
    placeholder: "All services",
    searchPlaceholder: "Search services...",
    values: [],
    onChange: () => {},
    options: {
      queryKey: ["stories", "services"],
      queryFn: fetchServices,
      select: (data: string[]) => data,
    },
  },
  render: ({ values, onChange, ...args }) => (
    <div className="h-72">
      <StatefulFilter {...args} initialValues={values} />
    </div>
  ),
} satisfies Meta<typeof ServiceFilter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OneSelected: Story = {
  args: { values: ["checkout-api"] },
};

export const ManySelected: Story = {
  args: { values: ["checkout-api", "payments-worker", "edge-gateway"] },
};

export const Loading: Story = {
  args: {
    options: {
      queryKey: ["stories", "services", "loading"],
      queryFn: fetchSlowly,
      select: (data: string[]) => data,
    },
  },
};

export const NoResults: Story = {
  args: {
    options: {
      queryKey: ["stories", "services", "empty"],
      queryFn: fetchNothing,
      select: (data: string[]) => data,
    },
  },
};

export const Wide: Story = {
  args: { className: "w-72" },
};

export const FilterBar: Story = {
  render: () => (
    <div className="flex h-72 items-start gap-3">
      <StatefulFilter
        label="Service"
        placeholder="All services"
        searchPlaceholder="Search services..."
        options={{
          queryKey: ["stories", "services"],
          queryFn: fetchServices,
          select: (data: string[]) => data,
        }}
      />
      <StatefulFilter
        label="Environment"
        placeholder="All environments"
        initialValues={["production"]}
        options={{
          queryKey: ["stories", "environments"],
          queryFn: async () => {
            await delay(200);
            return ["production", "staging", "development"];
          },
          select: (data: string[]) => data,
        }}
      />
      <StatefulFilter
        label="Severity"
        placeholder="All severities"
        options={{
          queryKey: ["stories", "severities"],
          queryFn: async () => {
            await delay(200);
            return ["page", "ticket", "info"];
          },
          select: (data: string[]) => data,
        }}
      />
    </div>
  ),
} satisfies Story;
