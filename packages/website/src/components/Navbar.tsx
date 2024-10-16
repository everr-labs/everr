'use client';

import { useState } from 'react';
import { ArrowRightIcon, Menu } from 'lucide-react';

import {
	Button,
	NavigationMenu,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	Sheet,
	SheetContent,
	SheetTrigger,
} from '@citric/ui';

import { Logo } from './Logo';

interface RouteProps {
	href: string;
	label: string;
}

const routeList: RouteProps[] = [
	{
		href: '#pricing',
		label: 'Pricing',
	},
	{
		href: '#faqs',
		label: 'FAQs',
	},
	{
		href: '/blog',
		label: 'Blog',
	},
	{
		href: '/contact-us',
		label: 'Contact Us',
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
										<a href={href}>{label}</a>
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
						{routeList.map(({ href, label }) => (
							<NavigationMenuLink key={href} asChild>
								<a href={href} className="px-2 text-base">
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
					target="_blank"
				>
					Join the beta
					<ArrowRightIcon className="ml-2 inline size-5 transition-transform group-hover/arrow:translate-x-1" />
				</a>
			</Button>
		</header>
	);
};
