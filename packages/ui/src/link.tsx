import type { AnchorHTMLAttributes, ReactNode } from 'react';

import type { ButtonProps } from './button';
import { Button } from './button';

export interface LinkProps extends ButtonProps {
	href: string;
	children: ReactNode;
	target?: AnchorHTMLAttributes<HTMLAnchorElement>['target'];
}

export function Link({ href, children, ...props }: LinkProps) {
	return (
		<Button {...props} asChild>
			<a href={href}>{children}</a>
		</Button>
	);
}
