import type { ClassValue } from 'class-variance-authority/types';
import { cx } from 'class-variance-authority';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
	extend: {
		theme: {
			spacing: ['fullscreen'],
		},
	},
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(cx(inputs));
}

export * from './accordion';
export * from './alert';
export * from './alert-dialog';
export * from './avatar';

export * from './badge';
export * from './breadcrumb';
export * from './button';

export * from './calendar';
export * from './card';
export * from './carousel';
export * from './chart';
export * from './collapsible';
export * from './command';

export * from './dialog';
export * from './drawer';
export * from './dropdown-menu';

export * from './form';

export * from './icon';
export * from './input';

export * from './label';

export * from './marquee';
export * from './menubar';

export * from './navigation-menu';

export * from './popover';

export * from './resizable';

export * from './scroll-area';
export * from './select';
export * from './separator';
export * from './sheet';
export * from './skeleton';
export * from './slider';
export * from './switch';

export * from './table';
export * from './tabs';
export * from './toast';
export * from './toaster';
export * from './tooltip';

export * from './use-toast';
