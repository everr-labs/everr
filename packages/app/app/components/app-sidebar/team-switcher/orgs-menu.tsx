import { authClient, useActiveOrganization } from '@/lib/auth-client';

import {
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	Skeleton,
} from '@citric/ui';

export function OrgsMenu() {
	const { data: orgs, isPending } = authClient.useListOrganizations();
	const { data: activeOrg } = useActiveOrganization();

	if (isPending) {
		return <Skeleton className="h-12 w-full" />;
	}

	const otherOrgs = orgs?.filter((org) => org.id !== activeOrg?.id);

	if (otherOrgs && otherOrgs.length > 0) {
		return (
			<>
				<DropdownMenuLabel className="text-xs text-muted-foreground">
					Teams
				</DropdownMenuLabel>
				{otherOrgs.map((org, index) => (
					<DropdownMenuItem
						key={org.id}
						onClick={() => {
							void authClient.organization.setActive({
								organizationId: org.id,
							});
						}}
						className="gap-2 p-2"
					>
						<div className="flex size-6 items-center justify-center rounded-sm border">
							<img
								src={org.logo ?? undefined}
								alt={org.name}
								className="size-4 shrink-0"
							/>
						</div>
						{org.name}
						<DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
			</>
		);
	}

	return null;
}
