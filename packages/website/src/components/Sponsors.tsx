import { Marquee } from './ui/marquee';

interface sponsorsProps {
	image: string;
	name: string;
	showName: boolean;
}

const sponsors: sponsorsProps[] = [
	{
		image: '/meetwithwallet.svg',
		name: 'Meet with Wallet',
		showName: true,
	},
	{
		image: '/zenklub.svg',
		name: 'Zenklub',
		showName: false,
	},
	{
		image: '/meetwithwallet.svg',
		name: 'Meet with Wallet',
		showName: true,
	},
	{
		image: '/zenklub.svg',
		name: 'Zenklub',
		showName: false,
	},
	{
		image: '/meetwithwallet.svg',
		name: 'Meet with Wallet',
		showName: true,
	},
	{
		image: '/zenklub.svg',
		name: 'Zenklub',
		showName: false,
	},
	{
		image: '/meetwithwallet.svg',
		name: 'Meet with Wallet',
		showName: true,
	},
	{
		image: '/zenklub.svg',
		name: 'Zenklub',
		showName: false,
	},
];

export function Sponsors() {
	return (
		<section id="sponsors" className="mx-auto max-w-[75%] pb-24 sm:pb-32">
			<div className="mx-auto">
				<Marquee className="gap-[3rem]" fade innerClassName="gap-[3rem]">
					{sponsors.map(({ image, name, showName }) => (
						<div
							key={name}
							className="flex items-center text-xl font-medium text-muted-foreground md:text-2xl"
						>
							<img
								src={image}
								className="mr-2 h-12 brightness-200 grayscale"
								alt={name}
								loading="lazy"
							/>
							{showName && name}
						</div>
					))}
				</Marquee>
			</div>
		</section>
	);
}
