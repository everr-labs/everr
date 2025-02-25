import type { LinkOptions } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { ChevronRight, SquareTerminalIcon } from 'lucide-react';

import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from '@citric/ui';

interface NavItem {
	title: string;
	url: LinkOptions['to'];
	icon?: LucideIcon;
	isActive?: boolean;
	items?: {
		title: string;
		url: LinkOptions['to'];
	}[];
}

const navItems = [
	{
		title: 'Playground',
		url: '/',
		icon: SquareTerminalIcon,
		isActive: true,
		items: [
			{
				title: 'History',
				url: '/',
			},
			{
				title: 'Starred',
				url: '/',
			},
			{
				title: 'Settings',
				url: '/',
			},
		],
	},
] satisfies NavItem[];

export function NavMain() {
	return (
		<SidebarGroup>
			<SidebarGroupLabel>CI/CD</SidebarGroupLabel>
			<SidebarMenu>
				{navItems.map((item) => (
					<Collapsible
						key={item.title}
						asChild
						defaultOpen={item.isActive}
						className="group/collapsible"
					>
						<SidebarMenuItem>
							<CollapsibleTrigger asChild>
								<SidebarMenuButton tooltip={item.title}>
									<item.icon />
									<span>{item.title}</span>
									<ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
								</SidebarMenuButton>
							</CollapsibleTrigger>
							<CollapsibleContent>
								<SidebarMenuSub>
									{item.items.map((subItem) => (
										<SidebarMenuSubItem key={subItem.title}>
											<SidebarMenuSubButton asChild>
												<Link
													to={subItem.url}
													activeProps={{ 'data-active': true }}
												>
													<span>{subItem.title}</span>
												</Link>
											</SidebarMenuSubButton>
										</SidebarMenuSubItem>
									))}
								</SidebarMenuSub>
							</CollapsibleContent>
						</SidebarMenuItem>
					</Collapsible>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
