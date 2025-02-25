import { Suspense } from 'react';
import { useActiveOrganization } from '@/lib/auth-client';
import { useRouteContext } from '@tanstack/react-router';
import { ChevronsUpDown, Plus } from 'lucide-react';

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	Skeleton,
	useSidebar,
} from '@citric/ui';

import { UserAvatar } from '../../user-avatar';
import { OrgsMenu } from './orgs-menu';

export function TeamSwitcher() {
	const { isMobile } = useSidebar();
	const { user } = useRouteContext({ from: '/_authenticated' });
	const { data: activeOrg, isPending } = useActiveOrganization();

	if (isPending) {
		return <Skeleton className="h-12 w-full" />;
	}

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
								{!activeOrg ? (
									<UserAvatar
										name="Personal account"
										image={user.image ?? undefined}
									/>
								) : (
									<UserAvatar
										name={activeOrg.name}
										image={activeOrg.logo ?? undefined}
									/>
								)}
							</div>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-semibold">
									{activeOrg ? activeOrg.name : 'Personal account'}
								</span>
								{/* <span className="truncate text-xs">{activeOrg?.plan}</span> */}
							</div>
							<ChevronsUpDown className="ml-auto" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
						align="start"
						side={isMobile ? 'bottom' : 'right'}
						sideOffset={4}
					>
						<Suspense fallback={<Skeleton className="h-12 w-full" />}>
							<OrgsMenu />
						</Suspense>

						<DropdownMenuItem className="gap-2 p-2">
							<div className="flex size-6 items-center justify-center rounded-md border bg-background">
								<Plus className="size-4" />
							</div>
							<div className="font-medium text-muted-foreground">Add team</div>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
