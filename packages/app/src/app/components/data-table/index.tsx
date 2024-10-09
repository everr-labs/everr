import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import {
	flexRender,
	getCoreRowModel,
	useReactTable,
} from '@tanstack/react-table';

import '@trpc/react-query';

import type {
	UseTRPCQueryOptions,
	UseTRPCQueryResult,
} from '@trpc/react-query/shared';
import { useState } from 'react';
import { DataTablePagination } from '@/components/data-table/pagination';
import { keepPreviousData } from '@tanstack/react-query';

import {
	cn,
	Skeleton,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@citric/ui';

interface PaginatedData<TData> {
	total: number;
	data: TData[];
}

type UseDataHookOptions<TData, TError> = UseTRPCQueryOptions<
	PaginatedData<TData>,
	PaginatedData<TData>,
	TError
>;

interface DataTableProps<TData, TValue, TError, TInput> {
	columns: ColumnDef<TData, TValue>[];
	/**
	 * a useQuery hook that returns a paginated data
	 */
	useDataHook: (
		input: TInput,
		opts: UseDataHookOptions<TData, TError>,
	) => UseTRPCQueryResult<PaginatedData<TData>, unknown>;

	params: Omit<TInput, 'pageIndex' | 'pageSize'>;
}

export function DataTable<TData, TValue, TError, TInput>({
	columns,
	useDataHook,
	params,
}: DataTableProps<TData, TValue, TError, TInput>) {
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: 10,
	});
	const { data, isLoading } = useDataHook(
		{ ...pagination, ...params } as TInput,
		{
			placeholderData: keepPreviousData, // don't have 0 rows flash while changing pages/loading next page
		},
	);

	const table = useReactTable({
		data: data?.data ?? [],
		columns,
		getCoreRowModel: getCoreRowModel(),
		onPaginationChange: setPagination,
		state: {
			pagination,
		},
		manualPagination: true,
		rowCount: data?.total,
		debugTable: true,
	});

	return (
		<div className="grid gap-4">
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									return (
										<TableHead key={header.id}>
											{header.isPlaceholder
												? null
												: flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
										</TableHead>
									);
								})}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									data-state={row.getIsSelected() && 'selected'}
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell
											key={cell.id}
											className={cn(
												{
													'w-0': cell.column.columnDef.meta?.shrink,
													'p-0': cell.column.columnDef.meta?.noPadding,
													'text-right':
														cell.column.columnDef.meta?.align === 'right',
													'text-center':
														cell.column.columnDef.meta?.align === 'center',
												},
												cell.column.columnDef.meta?.className,
											)}
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))
						) : isLoading ? (
							Array.from({ length: 5 }).map((_, i) => (
								<TableRow key={i}>
									<TableCell colSpan={columns.length} className="text-center">
										<Skeleton className="h-[22px] w-full" />
									</TableCell>
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-24 text-center"
								>
									No results.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			<DataTablePagination table={table} />
		</div>
	);
}
