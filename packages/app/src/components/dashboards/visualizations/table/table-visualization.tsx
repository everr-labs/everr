import { type Column, DataTable } from "@everr/ui/components/data-table";
import type { VisualizationProps } from "../index";

interface MockRow {
  endpoint: string;
  method: string;
  requests: number;
  avgLatency: string;
  errorRate: string;
}

const MOCK_DATA: MockRow[] = [
  {
    endpoint: "/api/v1/users",
    method: "GET",
    requests: 12843,
    avgLatency: "45ms",
    errorRate: "0.12%",
  },
  {
    endpoint: "/api/v1/orders",
    method: "POST",
    requests: 8421,
    avgLatency: "120ms",
    errorRate: "0.34%",
  },
  {
    endpoint: "/api/v1/products",
    method: "GET",
    requests: 6502,
    avgLatency: "38ms",
    errorRate: "0.08%",
  },
  {
    endpoint: "/api/v1/auth/login",
    method: "POST",
    requests: 4210,
    avgLatency: "95ms",
    errorRate: "1.2%",
  },
  {
    endpoint: "/api/v1/search",
    method: "GET",
    requests: 3891,
    avgLatency: "210ms",
    errorRate: "0.45%",
  },
  {
    endpoint: "/api/v1/webhooks",
    method: "POST",
    requests: 2105,
    avgLatency: "65ms",
    errorRate: "0.22%",
  },
];

const columns: Column<MockRow>[] = [
  {
    header: "Endpoint",
    cell: (row) => <span className="font-mono">{row.endpoint}</span>,
  },
  { header: "Method", cell: (row) => row.method },
  {
    header: "Requests",
    cell: (row) => row.requests.toLocaleString(),
    cellClassName:
      "border-b border-r border-border px-3 py-2 text-right tabular-nums last:border-r-0",
  },
  {
    header: "Avg Latency",
    cell: (row) => row.avgLatency,
    cellClassName:
      "border-b border-r border-border px-3 py-2 text-right tabular-nums last:border-r-0",
  },
  {
    header: "Error Rate",
    cell: (row) => row.errorRate,
    cellClassName:
      "border-b border-r border-border px-3 py-2 text-right tabular-nums last:border-r-0",
  },
];

export function TableVisualization({ plugin }: VisualizationProps) {
  return (
    <div className="flex h-full flex-col border-t border-border">
      <div className="min-h-0 flex-1 overflow-auto overscroll-none">
        <DataTable
          data={MOCK_DATA}
          columns={columns}
          rowKey={(row) => row.endpoint}
          stickyHeader={plugin.spec.stickyHeader === true}
        />
      </div>
    </div>
  );
}
