import type { ComponentProps } from 'react';
import { SiJest } from '@icons-pack/react-simple-icons';
import {
	BellIcon,
	ClockArrowUpIcon,
	DollarSignIcon,
	LocateFixedIcon,
	PuzzleIcon,
	SettingsIcon,
	TextSearchIcon,
	TrendingUpIcon,
} from 'lucide-react';

import type { NotificationItem } from '../animated-list';
import jobInspection from '../../img/job-inspect.png';
import { AnimatedList, Notification } from '../animated-list';
import { BentoCard, BentoGrid } from '../ui/bento-grid';
import { GradientText } from '../ui/gradient-text';
import { Beams } from './beams';

let notifications = [
	{
		name: 'Average build time increased',
		description: "Job 'Build & Test' is taking longer than usual",
		time: '15m ago',
		Icon: ClockArrowUpIcon,
		color: '#FF3D71',
	},
	{
		name: 'Flaky test detected',
		description: 'Commit #6dfa7f8 introduced a flaky test',
		time: '10m ago',
		Icon: SiJest,
		color: '#FFB800',
	},
	{
		name: 'Failure rate increasing',
		description: '+8.2% compared to last week',
		time: '5m ago',
		Icon: TrendingUpIcon,
		color: '#FF3D71',
	},
	{
		name: 'Inefficient configuration found',
		description: 'Cache not being used in job #build',
		time: '2m ago',
		Icon: SettingsIcon,
		color: '#1E86FF',
	},
] satisfies NotificationItem[];

notifications = Array.from({ length: 10 }, () => notifications).flat();

const features = [
	{
		Icon: DollarSignIcon,
		name: 'Cost monitoring & optimization',
		description:
			'Gain visibility into your CI costs. Track expenses per pipeline, job, and runner to make data-driven decisions.',
		className: 'col-span-3 lg:col-span-1',
		background: <></>,
	},
	{
		Icon: TrendingUpIcon,
		name: 'Pipeline performance insights & health metrics',
		description:
			'Uncover bottlenecks and optimize your CI/CD pipelines. Track job durations and failure rates over time, identify slow steps, and stay on top of build times.',
		className: 'col-span-3 lg:col-span-2',
		background: <></>,
	},
	{
		Icon: PuzzleIcon,
		name: 'Integrate with your tools',
		description:
			'With GitHub Actions support baked in and more integrations soon, you can easily connect your existing tools and workflows.',
		className: 'col-span-3 lg:col-span-2',
		background: <Beams className="top-8 min-w-[300px]" />,
	},
	{
		Icon: LocateFixedIcon,
		name: 'Job & step inspection',
		description:
			'Dive deep into every job and step. Access outputs, logs, and detailed metrics to troubleshoot failures and identify flakiness efficiently.',
		className: 'col-span-3 lg:col-span-1',
		background: (
			<div className="transition-all duration-300 ease-out [mask-image:linear-gradient(to_top,transparent_2%,#000_100%)] group-hover:scale-105">
				<img src={jobInspection.src} className="blur-[1px]" />
			</div>
		),
	},
	{
		Icon: BellIcon,
		name: 'Tailored alerts',
		description:
			'Set up alerts to stay informed about pipeline anomalies and failures.',
		className: 'col-span-3 lg:col-span-1',
		background: (
			<div className="origin-top px-8 py-8 transition-all duration-300 ease-out group-hover:scale-105">
				<AnimatedList>
					{notifications.map((item, idx) => (
						<Notification {...item} key={idx} />
					))}
				</AnimatedList>
			</div>
		),
	},
	{
		Icon: TextSearchIcon,
		name: 'Search across pipelines',
		description:
			'Instantly search across workflows, jobs, and steps. Find the information you need without digging through countless runs.',
		className: 'col-span-3 lg:col-span-2',
		background: <></>,
	},
] satisfies ComponentProps<typeof BentoCard>[];

export function Solution() {
	return (
		<section className="bg-neutral-100 py-16 dark:bg-neutral-900">
			<div className="container">
				<div className="mx-auto max-w-3xl pb-6 text-center">
					<h2 className="mb-2 font-bold uppercase tracking-wider text-primary">
						solution
					</h2>

					<h3 className="mx-auto mt-4 text-3xl font-semibold sm:max-w-none sm:text-4xl md:text-5xl">
						<GradientText>Everything you need</GradientText> to understand your
						CI/CD pipelines
					</h3>
				</div>

				<BentoGrid className="mt-8">
					{features.map((feature, idx) => (
						<BentoCard key={idx} {...feature} />
					))}
				</BentoGrid>
			</div>
		</section>
	);
}
