import type { ReactNode } from 'react';
import { ArrowRightIcon } from 'lucide-react';

import { Button, cn } from '@citric/ui';

const BentoGrid = ({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) => {
	return (
		<div
			className={cn(
				'grid w-full auto-rows-[22rem] grid-cols-3 gap-4',
				className,
			)}
		>
			{children}
		</div>
	);
};

interface BentoCardProps {
	name: string;
	className?: string;
	background: ReactNode;
	// TODO: Fix this
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Icon: any;
	description: string;
	href?: string;
	cta?: string;
}

const BentoCard = ({
	name,
	className,
	background,
	Icon,
	description,
	href,
	cta = 'Learn more',
}: BentoCardProps) => (
	<div
		className={cn(
			'group col-span-3 flex flex-col justify-end overflow-hidden rounded-xl',
			// light styles
			'bg-white [box-shadow:0_0_0_1px_rgba(0,0,0,.03),0_2px_4px_rgba(0,0,0,.05),0_12px_24px_rgba(0,0,0,.05)]',
			// dark styles
			'transform-gpu dark:bg-black dark:[border:1px_solid_rgba(255,255,255,.1)] dark:[box-shadow:0_-20px_80px_-20px_#ffffff1f_inset]',
			className,
		)}
	>
		<div className="pointer-events-none absolute h-full w-full [mask-image:linear-gradient(to_top,transparent_2%,#000_100%)]">
			{background}
		</div>
		<div
			className={cn(
				'z-10 flex flex-col gap-1 p-6',
				href &&
					'transform-gpu transition-all duration-300 group-hover:-translate-y-10',
			)}
		>
			<Icon
				className={cn(
					'h-12 w-12 text-primary',
					href &&
						'origin-left transform-gpu transition-all duration-300 ease-in-out group-hover:scale-75',
				)}
			/>
			<h3 className="text-lg font-semibold text-accent-foreground">{name}</h3>
			<p className="max-w-lg text-pretty text-muted-foreground">
				{description}
			</p>
		</div>

		{href && (
			<div
				className={cn(
					'pointer-events-none absolute bottom-0 flex w-full translate-y-10 transform-gpu flex-row items-center p-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100',
				)}
			>
				<Button
					variant="ghost"
					asChild
					size="sm"
					className="pointer-events-auto"
				>
					<a href={href}>
						{cta}
						<ArrowRightIcon className="ml-2 h-4 w-4" />
					</a>
				</Button>
			</div>
		)}
		<div className="pointer-events-none absolute inset-0 transform-gpu transition-all duration-300 group-hover:bg-black/[.03] group-hover:dark:bg-neutral-800/10" />
	</div>
);

export { BentoCard, BentoGrid };
