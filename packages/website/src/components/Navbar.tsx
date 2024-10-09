'use client';

import { useState } from 'react';
import { ArrowRightIcon, Menu } from 'lucide-react';

import {
	Button,
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
	Sheet,
	SheetContent,
	SheetTrigger,
} from '@citric/ui';

import { Logo } from './Logo';

interface RouteProps {
	href: string;
	label: string;
}

interface FeatureProps {
	title: string;
	description: string;
}

const routeList: RouteProps[] = [
	{
		href: '#testimonials',
		label: 'Testimonials',
	},
	{
		href: '#team',
		label: 'Team',
	},
	{
		href: '#contact',
		label: 'Contact',
	},
	{
		href: '#faq',
		label: 'FAQ',
	},
];

const featureList: FeatureProps[] = [
	{
		title: 'Showcase Your Value ',
		description: 'Highlight how your product solves user problems.',
	},
	{
		title: 'Build Trust',
		description:
			'Leverages social proof elements to establish trust and credibility.',
	},
	{
		title: 'Capture Leads',
		description:
			'Make your lead capture form visually appealing and strategically.',
	},
];

export const Navbar = () => {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<header className="sticky top-5 z-40 mx-auto flex w-[90%] items-center justify-between rounded-2xl border bg-card/50 p-2 shadow-inner backdrop-blur-md md:w-[70%] lg:w-[75%] lg:max-w-screen-xl">
			<a href="/" className="flex items-center text-lg font-bold">
				<Logo />
			</a>
			{/* <!-- Mobile --> */}
			<div className="flex items-center lg:hidden">
				<Sheet open={isOpen} onOpenChange={setIsOpen}>
					<SheetTrigger asChild>
						<Menu
							onClick={() => setIsOpen(!isOpen)}
							className="cursor-pointer lg:hidden"
						/>
					</SheetTrigger>

					<SheetContent
						side="left"
						className="flex flex-col justify-between border-secondary bg-card"
					>
						<div>
							<div className="flex flex-col gap-2">
								{routeList.map(({ href, label }) => (
									<Button
										key={href}
										onClick={() => setIsOpen(false)}
										asChild
										variant="ghost"
										className="justify-start text-base"
									>
										<a href={'/'}>{label}</a>
									</Button>
								))}
							</div>
						</div>
					</SheetContent>
				</Sheet>
			</div>
			{/* <!-- Desktop --> */}
			<NavigationMenu className="mx-auto hidden lg:block">
				<NavigationMenuList>
					<NavigationMenuItem>
						<NavigationMenuTrigger className="bg-card text-base">
							Features
						</NavigationMenuTrigger>
						<NavigationMenuContent>
							<div className="grid w-[600px] grid-cols-2 gap-5 p-4">
								<img
									src="https://avatars.githubusercontent.com/u/75042455?v=4"
									alt="RadixLogo"
									className="h-full w-full rounded-md object-cover"
									width={600}
									height={600}
								/>
								<ul className="flex flex-col gap-2">
									{featureList.map(({ title, description }) => (
										<li
											key={title}
											className="rounded-md p-3 text-sm hover:bg-muted"
										>
											<p className="mb-1 font-semibold leading-none text-foreground">
												{title}
											</p>
											<p className="line-clamp-2 text-muted-foreground">
												{description}
											</p>
										</li>
									))}
								</ul>
							</div>
						</NavigationMenuContent>
					</NavigationMenuItem>

					<NavigationMenuItem>
						{routeList.map(({ href, label }) => (
							<NavigationMenuLink key={href} asChild>
								<a href={'/'} className="px-2 text-base">
									{label}
								</a>
							</NavigationMenuLink>
						))}
					</NavigationMenuItem>
				</NavigationMenuList>
			</NavigationMenu>
			<Button
				asChild
				variant="default"
				className="group/arrow hidden items-center font-bold lg:flex"
			>
				<a
					// TODO: Link to app
					href="/"
				>
					Get Started
					<ArrowRightIcon className="ml-2 inline size-5 transition-transform group-hover/arrow:translate-x-1" />
				</a>
			</Button>
		</header>
	);
};
