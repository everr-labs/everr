import { authClient } from '@/lib/auth-client';
import { useRouteContext, useRouter } from '@tanstack/react-router';
import {
	ChevronsUpDownIcon,
	LogOutIcon,
	MoonIcon,
	PaletteIcon,
	SunIcon,
	SunMoonIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuPortal,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from '@citric/ui';

import { UserAvatar } from '../user-avatar';

export function NavUser() {
	const { isMobile } = useSidebar();
	const { user } = useRouteContext({ from: '/_authenticated' });
	const router = useRouter();
	const { theme, setTheme } = useTheme();

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<UserAvatar name={user.name} image={user.image ?? undefined} />
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-semibold">{user.name}</span>
								<span className="truncate text-xs">{user.email}</span>
							</div>
							<ChevronsUpDownIcon className="ml-auto size-4" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
						side={isMobile ? 'bottom' : 'top'}
						align="end"
						sideOffset={4}
					>
						<DropdownMenuLabel className="p-0 font-normal">
							<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
								<UserAvatar name={user.name} image={user.image ?? undefined} />

								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-semibold">{user.name}</span>
									<span className="truncate text-xs">{user.email}</span>
								</div>
							</div>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>
								<PaletteIcon />
								Theme
							</DropdownMenuSubTrigger>
							<DropdownMenuPortal>
								<DropdownMenuSubContent>
									<DropdownMenuRadioGroup
										value={theme}
										onValueChange={setTheme}
									>
										<DropdownMenuRadioItem value="light">
											<SunIcon className="mr-2 size-4" />
											Light
										</DropdownMenuRadioItem>
										<DropdownMenuRadioItem value="dark">
											<MoonIcon className="mr-2 size-4" />
											Dark
										</DropdownMenuRadioItem>
										<DropdownMenuRadioItem value="system">
											<SunMoonIcon className="mr-2 size-4" />
											System
										</DropdownMenuRadioItem>
									</DropdownMenuRadioGroup>
								</DropdownMenuSubContent>
							</DropdownMenuPortal>
						</DropdownMenuSub>

						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => {
								void authClient.signOut({
									fetchOptions: {
										onSuccess() {
											// !FIXME: This causes the router to re-run the beforeLoad 2 times.
											void router.invalidate();
										},
									},
								});
							}}
						>
							<LogOutIcon />
							Log out
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
