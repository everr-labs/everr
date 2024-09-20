import '@tanstack/react-table'; //or vue, svelte, solid, qwik, etc.
import { RowData } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
	interface ColumnMeta<TData extends RowData, TValue> {
		shrink?: boolean;
		noPadding?: boolean;
		align?: 'left' | 'center' | 'right';
		className?: string;
	}
}
