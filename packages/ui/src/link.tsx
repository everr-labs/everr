import type { VariantProps } from 'class-variance-authority';
import type { AnchorHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';

export const linkVariants = cva('', {
	variants: {
		variant: {
			default: 'text-primary underline hover:text-primary/90',
			secondary: 'text-secondary-foreground underline',
			disabled: 'cursor-not-allowed text-muted-foreground',
		},
	},
	defaultVariants: {
		variant: 'default',
	},
});

interface LinkProps
	extends AnchorHTMLAttributes<HTMLAnchorElement>,
		VariantProps<typeof linkVariants> {
	className?: string;
}

export const Link = forwardRef(
	(
		{ variant, className, ...props }: LinkProps,
		ref: React.ForwardedRef<HTMLAnchorElement>,
	) => {
		return (
			<a
				{...props}
				ref={ref}
				className={linkVariants({ variant, className })}
			/>
		);
	},
);
