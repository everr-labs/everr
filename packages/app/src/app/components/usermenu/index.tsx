import { useRouteContext } from '@tanstack/react-router';

import { signOut } from '@citric/auth';
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@citric/ui';

export function UserMenu() {
	const ctx = useRouteContext({ from: '/_authenticated/_app/' });

	const parts = ctx.user.name?.split(' ').map((n) => n[0]) ?? [];
	const inittials = [parts[0], parts[parts.length - 1]]
		.filter(Boolean)
		.join('');

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="icon"
					className="overflow-hidden rounded-full"
				>
					<Avatar>
						<AvatarImage src={ctx.user.image ?? void 0}></AvatarImage>
						<AvatarFallback>{inittials}</AvatarFallback>
					</Avatar>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-52">
				<DropdownMenuLabel>My Account</DropdownMenuLabel>
				<DropdownMenuSeparator />

				<DropdownMenuItem>Settings</DropdownMenuItem>
				<DropdownMenuItem>Support</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={async () => {
						await signOut();
					}}
				>
					Logout
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
