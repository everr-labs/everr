import { useAuthQuery, useSignOutMutation } from '@/lib/auth-client';

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
	const { mutate: signOut } = useSignOutMutation();
	const {
		data: { user },
	} = useAuthQuery();

	if (!user) {
		return null;
	}

	const parts = user.name.split(' ').map((n) => n[0]);
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
						<AvatarImage src={user.image ?? void 0}></AvatarImage>
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
					onClick={() => {
						signOut();
					}}
				>
					Logout
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
