import '@tanstack/react-table'; //or vue, svelte, solid, qwik, etc.

import type { RowData } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
	interface ColumnMeta<_TData extends RowData, _TValue> {
		shrink?: boolean;
		noPadding?: boolean;
		align?: 'left' | 'center' | 'right';
		className?: string;
	}
}
