import { type Column, DataTable } from "@everr/ui/components/data-table";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { TableIcon } from "lucide-react";
import { useState } from "react";
import type { QueryResultRow, VisualizationProps } from "../index";

const QUERY_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function buildColumns(rows: QueryResultRow[]): Column<QueryResultRow>[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).map((key) => ({
    header: key,
    cell: (row: QueryResultRow) => {
      const val = row[key];
      if (val == null)
        return <span className="text-muted-foreground">NULL</span>;
      return String(val);
    },
  }));
}

export function TableVisualization({ plugin, data }: VisualizationProps) {
  const sets = data ?? [];
  const [selected, setSelected] = useState(0);

  if (sets.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <TableIcon className="size-8" />
        <p className="text-sm">No data — run a query to see results</p>
      </div>
    );
  }

  const index = Math.min(selected, sets.length - 1);
  const rows = sets[index] ?? [];
  const columns = buildColumns(rows);

  return (
    <div className="flex h-full flex-col border-t border-border">
      {sets.length > 1 && (
        <div className="border-b border-border p-1">
          <ToggleGroup
            value={[String(index)]}
            onValueChange={(next: string[]) => {
              const value = next[0];
              if (value !== undefined) setSelected(Number(value));
            }}
            size="sm"
          >
            {sets.map((_, i) => (
              <ToggleGroupItem
                // biome-ignore lint/suspicious/noArrayIndexKey: query order is stable within a render
                key={i}
                value={String(i)}
              >
                Query {QUERY_LABELS[i] ?? i + 1}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto overscroll-none">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No rows
          </div>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            rowKey={(_, i) => String(i)}
            stickyHeader={plugin.spec.stickyHeader === true}
            bordered
          />
        )}
      </div>
    </div>
  );
}
