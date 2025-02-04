import type { VariantProps } from 'class-variance-authority';
import type { AnchorHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { Link as BaseLink, createLink } from '@tanstack/react-router';

import { linkVariants } from '@citric/ui';

interface LinkProps
	extends AnchorHTMLAttributes<HTMLAnchorElement>,
		VariantProps<typeof linkVariants> {
	className?: string;
}

export const Link = createLink(
	forwardRef(
		(
			{ variant, className, ...props }: LinkProps,
			ref: React.ForwardedRef<HTMLAnchorElement>,
		) => {
			return (
				<BaseLink
					{...props}
					ref={ref}
					className={linkVariants({ variant, className })}
					preload="intent"
				/>
			);
		},
	),
);
