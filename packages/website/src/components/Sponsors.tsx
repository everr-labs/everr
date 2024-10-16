import { Marquee } from '@citric/ui';

interface sponsorsProps {
	image: string;
	name?: string;
}

const sponsors: sponsorsProps[] = [
	{
		image: '/public/meetwithwallet.svg',
		name: 'Meet with Wallet',
	},
	{
		image: '/public/zenklub.svg',
	},
	{
		image: '/public/meetwithwallet.svg',
		name: 'Meet with Wallet',
	},
	{
		image: '/public/zenklub.svg',
	},
	{
		image: '/public/meetwithwallet.svg',
		name: 'Meet with Wallet',
	},
	{
		image: '/public/zenklub.svg',
	},
	{
		image: '/public/meetwithwallet.svg',
		name: 'Meet with Wallet',
	},
	{
		image: '/public/zenklub.svg',
	},
];

export function Sponsors() {
	return (
		<section id="sponsors" className="mx-auto max-w-[75%] pb-24 sm:pb-32">
			<div className="mx-auto">
				<Marquee className="gap-[3rem]" fade innerClassName="gap-[3rem]">
					{sponsors.map(({ image, name }) => (
						<div
							key={name}
							className="flex items-center text-xl font-medium text-muted-foreground md:text-2xl"
						>
							<img src={image} className="mr-2 h-12 brightness-200 grayscale" />
							{name}
						</div>
					))}
				</Marquee>
			</div>
		</section>
	);
}
