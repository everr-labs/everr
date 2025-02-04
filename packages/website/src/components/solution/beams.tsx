import type { ReactNode } from 'react';
import { forwardRef, useRef } from 'react';
import {
	SiArgo,
	SiCircleci,
	SiGithub,
	SiGitlab,
	SiJenkins,
	SiTravisci,
} from '@icons-pack/react-simple-icons';

import { cn } from '@citric/ui';

import { Logo } from '../Logo';
import { AnimatedBeam } from '../ui/animated-beam';

const Circle = forwardRef<
	HTMLDivElement,
	{ className?: string; children?: ReactNode }
>(({ className, children }, ref) => {
	return (
		<div
			ref={ref}
			className={cn(
				'z-10 flex size-14 items-center justify-center rounded-full border-2 bg-white p-2',
				className,
			)}
		>
			{children}
		</div>
	);
});

interface Props {
	className?: string;
}
export function Beams({ className }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const githubRef = useRef<HTMLDivElement>(null);
	const jenkinsRef = useRef<HTMLDivElement>(null);
	const travisRef = useRef<HTMLDivElement>(null);
	const gitlabRef = useRef<HTMLDivElement>(null);
	const argoRef = useRef<HTMLDivElement>(null);
	const circleCIRef = useRef<HTMLDivElement>(null);
	const targetRef = useRef<HTMLDivElement>(null);

	return (
		<div
			className={cn(
				// TODO: maybe some of the followinfg class should be on the parent
				'relative flex w-full items-center justify-center transition-all duration-300 ease-out group-hover:scale-105',
				className,
			)}
			ref={containerRef}
		>
			<div className="flex w-full max-w-lg flex-col gap-10">
				<div className="flex flex-row justify-between px-10">
					<Circle ref={githubRef}>
						<SiGithub className="size-6 text-black" />
					</Circle>
					<Circle ref={gitlabRef}>
						<SiGitlab className="size-6 text-black" />
					</Circle>
				</div>
				<div className="flex flex-row items-center justify-between">
					<Circle ref={jenkinsRef} className="">
						<SiJenkins className="size-6 text-black" />
					</Circle>
					<Logo
						iconOnly
						ref={targetRef}
						logoClassName="scale-150"
						className="z-10"
					/>

					<Circle ref={argoRef}>
						<SiArgo className="size-6 text-black" />
					</Circle>
				</div>
				<div className="flex flex-row items-center justify-between px-8">
					<Circle ref={travisRef}>
						<SiTravisci className="size-6 text-black" />
					</Circle>
					<Circle ref={circleCIRef}>
						<SiCircleci className="size-6 text-black" />
					</Circle>
				</div>
			</div>

			<AnimatedBeam
				containerRef={containerRef}
				fromRef={githubRef}
				toRef={targetRef}
			/>
			<AnimatedBeam
				containerRef={containerRef}
				fromRef={jenkinsRef}
				toRef={targetRef}
			/>
			<AnimatedBeam
				containerRef={containerRef}
				fromRef={gitlabRef}
				toRef={targetRef}
				reverse
			/>
			<AnimatedBeam
				containerRef={containerRef}
				fromRef={argoRef}
				toRef={targetRef}
				reverse
			/>
			<AnimatedBeam
				containerRef={containerRef}
				fromRef={travisRef}
				toRef={targetRef}
			/>
			<AnimatedBeam
				containerRef={containerRef}
				fromRef={circleCIRef}
				toRef={targetRef}
				reverse
			/>
		</div>
	);
}
