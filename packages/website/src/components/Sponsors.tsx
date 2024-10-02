import { type icons } from 'lucide-react';

import { Icon, Marquee } from '@citric/ui';

interface sponsorsProps {
	icon: string;
	name: string;
}

const sponsors: sponsorsProps[] = [
	{
		icon: 'Crown',
		name: 'Acmebrand',
	},
	{
		icon: 'Vegan',
		name: 'Acmelogo',
	},
	{
		icon: 'Ghost',
		name: 'Acmesponsor',
	},
	{
		icon: 'Puzzle',
		name: 'Acmeipsum',
	},
	{
		icon: 'Squirrel',
		name: 'Acme',
	},
	{
		icon: 'Cookie',
		name: 'Accmee',
	},
	{
		icon: 'Drama',
		name: 'Acmetech',
	},
];

export function Sponsors() {
	return (
		<section id="sponsors" className="mx-auto max-w-[75%] pb-24 sm:pb-32">
			<h2 className="mb-6 text-center text-lg md:text-xl">
				Our Platinum Sponsors
			</h2>

			<div className="mx-auto">
				<Marquee
					className="gap-[3rem]"
					fade
					innerClassName="gap-[3rem]"
					pauseOnHover
				>
					{sponsors.map(({ icon, name }) => (
						<div
							key={name}
							className="flex items-center text-xl font-medium md:text-2xl"
						>
							<Icon
								name={icon as keyof typeof icons}
								size={32}
								color="white"
								className="mr-2"
							/>
							{name}
						</div>
					))}
				</Marquee>
			</div>
		</section>
	);
}
