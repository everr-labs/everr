'use client';

import Link, { type LinkProps } from 'next/link';
import { usePathname } from 'next/navigation';
import React, { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface Props<T> extends LinkProps<T> {
	activeClass?: string;
	className?: string;
	children: ReactNode;
	exact?: boolean;
}

export function NavLink<T>({
	href,
	activeClass,
	className,
	exact = false,
	...props
}: Props<T>) {
	const pathname = usePathname();

	// Determine the href's pathname based on whether href is a string or an Url object
	const hrefPathname = typeof href === 'string' ? href : href.pathname;

	// Check if the current pathname starts with the href's pathname
	const isActive = exact
		? pathname === hrefPathname
		: pathname.startsWith(hrefPathname ?? '');

	return (
		<Link
			className={cn(className, isActive && activeClass)}
			href={href}
			{...props}
		/>
	);
}
