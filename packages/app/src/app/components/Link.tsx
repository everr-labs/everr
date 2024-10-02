import * as React from 'react';
import { Link as BaseLink, createLink } from '@tanstack/react-router';

import { cn } from '@citric/ui';

export const Link = createLink(
	React.forwardRef(
		(
			props: {
				className?: string;
			},
			ref: React.ForwardedRef<HTMLAnchorElement>,
		) => {
			return (
				<BaseLink
					{...props}
					ref={ref}
					className={cn(
						'text-primary underline hover:text-primary/80',
						props.className,
					)}
					preload="intent"
				/>
			);
		},
	),
);
