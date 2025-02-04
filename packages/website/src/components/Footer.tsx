import type { IconType } from '@icons-pack/react-simple-icons';
import { SiDiscord, SiGithub, SiX } from '@icons-pack/react-simple-icons';

import { Logo } from './Logo';

interface FooterLink {
	href: string;
	text: string;
	Icon?: IconType;
}

const socialLinks = [
	{
		text: 'GitHub',
		href: '#',
		Icon: SiGithub,
	},
	{
		text: 'X',
		href: '#',
		Icon: SiX,
	},
	{
		text: 'Discord',
		href: 'https://discord.gg/djNRYGN7',
		Icon: SiDiscord,
	},
] satisfies FooterLink[];

const links = [
	{
		text: 'Contact Us',
		href: '/contact-us',
	},
	{
		text: 'X',
		href: '#',
		Icon: SiX,
	},
	{
		text: 'FAQ',
		href: '/#faqs',
	},
] satisfies FooterLink[];

export const Footer = () => {
	return (
		<footer id="footer" className="container py-24 sm:py-32">
			<div className="rounded-2xl border border-secondary bg-card p-10">
				<div className="grid grid-cols-2 gap-x-12 gap-y-8 md:grid-cols-4 xl:grid-cols-6">
					<div className="col-span-full xl:col-span-2">
						<a href="/" className="flex items-center text-xl font-bold">
							<Logo />
						</a>
					</div>

					<div className="flex flex-col gap-2">
						<h3 className="text-lg font-bold">Connect</h3>
						<ul>
							{socialLinks.map(({ href, text, Icon }) => (
								<li key={text} className="mt-2">
									<a
										href={href}
										className="flex items-center opacity-60 hover:opacity-100"
									>
										{Icon && <Icon className="mr-2 size-5" />}
										{text}
									</a>
								</li>
							))}
						</ul>
					</div>

					<div className="flex flex-col gap-2">
						<h3 className="text-lg font-bold">Help</h3>
						<ul>
							{links.map(({ href, text }) => (
								<li key={text} className="mt-2">
									<a
										href={href}
										className="flex items-center opacity-60 hover:opacity-100"
									>
										{text}
									</a>
								</li>
							))}
						</ul>
					</div>
				</div>
			</div>
		</footer>
	);
};
