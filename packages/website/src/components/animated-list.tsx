import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { cn } from '@citric/ui';

export interface AnimatedListProps {
	className?: string;
	children: React.ReactNode;
	delay?: number;
}

export const AnimatedList = React.memo(
	({ className, children, delay = 1000 }: AnimatedListProps) => {
		const [index, setIndex] = useState(0);
		const childrenArray = useMemo(
			() => React.Children.toArray(children),
			[children],
		);

		useEffect(() => {
			if (index < childrenArray.length - 1) {
				const timeout = setTimeout(() => {
					setIndex((prevIndex) => prevIndex + 1);
				}, delay);

				return () => clearTimeout(timeout);
			}
			return;
		}, [index, delay, childrenArray.length]);

		const itemsToShow = useMemo(() => {
			const result = childrenArray.slice(0, index + 1).reverse();
			return result;
		}, [index, childrenArray]);

		return (
			<div className={`flex flex-col items-center gap-4 ${className}`}>
				<AnimatePresence>
					{itemsToShow.map((item) => (
						<AnimatedListItem key={(item as React.ReactElement).key}>
							{item}
						</AnimatedListItem>
					))}
				</AnimatePresence>
			</div>
		);
	},
);

export function AnimatedListItem({ children }: { children: React.ReactNode }) {
	const animations = {
		initial: { scale: 0, opacity: 0 },
		animate: { scale: 1, opacity: 1, originY: 0 },
		exit: { scale: 0, opacity: 0 },
		transition: { type: 'spring', stiffness: 350, damping: 40 },
	};

	return (
		<motion.div {...animations} layout className="mx-auto w-full">
			{children}
		</motion.div>
	);
}

export interface NotificationItem {
	name: string;
	description: string;
	Icon: any;
	color: string;
	time: string;
}
export const Notification = ({
	name,
	description,
	Icon,
	color,
	time,
}: NotificationItem) => {
	return (
		<figure
			className={cn(
				'relative mx-auto min-h-fit w-full max-w-[400px] cursor-pointer overflow-hidden rounded-2xl p-4',
				// animation styles
				'transition-all duration-200 ease-in-out hover:scale-[103%]',
				// light styles
				'bg-white [box-shadow:0_0_0_1px_rgba(0,0,0,.03),0_2px_4px_rgba(0,0,0,.05),0_12px_24px_rgba(0,0,0,.05)]',
				// dark styles
				'transform-gpu dark:bg-transparent dark:backdrop-blur-md dark:[border:1px_solid_rgba(255,255,255,.1)] dark:[box-shadow:0_-20px_80px_-20px_#ffffff1f_inset]',
			)}
		>
			<div className="flex flex-row items-center gap-3">
				<div
					className="flex size-10 items-center justify-center rounded-2xl"
					style={{
						backgroundColor: color,
					}}
				>
					<span className="text-lg">
						<Icon />
					</span>
				</div>
				<div className="flex flex-col overflow-hidden">
					<figcaption className="flex flex-col whitespace-pre text-lg font-medium dark:text-white">
						<span className="text-sm sm:text-lg">{name}</span>
						<span className="text-xs text-gray-500">{time}</span>
					</figcaption>
					<p className="text-sm font-normal dark:text-white/60">
						{description}
					</p>
				</div>
			</div>
		</figure>
	);
};
