import { Badge } from "@everr/ui/components/badge";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchXIcon } from "lucide-react";

interface ServiceRow {
  service: string;
  environment: string;
  requests: number;
  errors: number;
  p95Ms: number;
  status: "healthy" | "degraded" | "firing";
}

const services: ServiceRow[] = [
  {
    service: "checkout-api",
    environment: "production",
    requests: 1_284_310,
    errors: 4128,
    p95Ms: 842,
    status: "firing",
  },
  {
    service: "payments-worker",
    environment: "production",
    requests: 402_887,
    errors: 311,
    p95Ms: 219,
    status: "degraded",
  },
  {
    service: "search-indexer",
    environment: "production",
    requests: 96_540,
    errors: 12,
    p95Ms: 143,
    status: "healthy",
  },
  {
    service: "edge-gateway",
    environment: "production",
    requests: 3_110_774,
    errors: 890,
    p95Ms: 61,
    status: "healthy",
  },
  {
    service: "notification-fanout",
    environment: "staging",
    requests: 18_204,
    errors: 0,
    p95Ms: 88,
    status: "healthy",
  },
];

const numberFormat = new Intl.NumberFormat("en-US");

const statusVariant = {
  healthy: "added",
  degraded: "changed",
  firing: "removed",
} as const;

const columns: Column<ServiceRow>[] = [
  {
    header: "Service",
    cell: (row) => <span className="font-medium">{row.service}</span>,
  },
  {
    header: "Environment",
    cell: (row) => (
      <span className="text-muted-foreground">{row.environment}</span>
    ),
  },
  {
    header: "Requests",
    cell: (row) => numberFormat.format(row.requests),
  },
  {
    header: "Errors",
    cell: (row) => numberFormat.format(row.errors),
  },
  {
    header: "p95",
    cell: (row) => `${row.p95Ms} ms`,
  },
  {
    header: "Status",
    cell: (row) => (
      <Badge variant={statusVariant[row.status]}>{row.status}</Badge>
    ),
  },
];

const ServiceTable = DataTable<ServiceRow>;

const meta = {
  title: "Data/DataTable",
  component: ServiceTable,
  args: {
    data: services,
    columns,
    rowKey: (row: ServiceRow) => row.service,
  },
} satisfies Meta<typeof ServiceTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Bordered: Story = {
  args: {
    bordered: true,
    containerClassName: "rounded-lg border border-border overflow-hidden",
  },
};

export const StickyHeader: Story = {
  args: {
    data: [
      ...services,
      ...services.map((row) => ({ ...row, environment: "staging" })),
    ],
    rowKey: (row: ServiceRow) => `${row.service}-${row.environment}`,
    stickyHeader: true,
    containerClassName: "h-56 overflow-auto rounded-lg border border-border",
  },
};

export const HighlightedRows: Story = {
  args: {
    rowClassName: (row: ServiceRow) =>
      row.status === "firing" ? "bg-red-500/10" : undefined,
  },
};

export const Clickable: Story = {
  args: {
    onRowClick: (row: ServiceRow) => {
      window.alert(`Open ${row.service}`);
    },
  },
};

export const EmptyState: Story = {
  args: {
    data: [],
    emptyState: (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>No services reported data</EmptyTitle>
          <EmptyDescription>
            Widen the time range or remove a filter.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    ),
  },
};

export const NoRowsWithoutEmptyState: Story = {
  args: { data: [] },
};

export const Loading: Story = {
  args: {
    data: services,
    columns: columns.map((column) => ({
      ...column,
      cell: () => <Skeleton className="h-4 w-20" />,
    })),
  },
};
