import '@tanstack/react-table';

// import type { RowData } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	interface ColumnMeta<TData extends RowData, TValue> {
		shrink?: boolean;
		noPadding?: boolean;
		align?: 'left' | 'center' | 'right';
		className?: string;
	}
}
