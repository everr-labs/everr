import { type Column, DataTable } from "@everr/ui/components/data-table";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { TableIcon } from "lucide-react";
import { useState } from "react";
import { queryLabel } from "../data-utils";
import type { QueryResultRow, VisualizationProps } from "../index";
import type { TableSpec } from "./spec";

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

export function TableVisualization({
  spec,
  data,
}: VisualizationProps<TableSpec>) {
  const sets = data ?? [];
  const [selected, setSelected] = useState(0);

  const hasSelector = sets.length > 1;
  const index = Math.min(selected, Math.max(sets.length - 1, 0));
  const rows = sets[index] ?? [];

  // No queries, or a single query with no rows: show the borderless empty
  // state. This keeps an empty table from sprouting a stray top border (the
  // bordered container is only meaningful once there's a selector or rows).
  // With multiple queries we keep the selector so the user can still switch
  // frames, and an empty frame shows "No rows" inside the bordered container.
  if (!hasSelector && rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <TableIcon className="size-8" />
        <p className="text-sm">No data — run a query to see results</p>
      </div>
    );
  }

  const columns = buildColumns(rows);

  return (
    <div className="flex h-full flex-col border-t border-border">
      {hasSelector && (
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
              <ToggleGroupItem key={i} value={String(i)}>
                {queryLabel(i)}
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
            stickyHeader={spec.stickyHeader}
            bordered
          />
        )}
      </div>
    </div>
  );
}
