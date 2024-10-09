import type { Session, User } from '@auth/core/types';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

interface RouterContext {
	user?: User;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	beforeLoad: async () => {
		// TODO: maybe this can be
		const res = await fetch('/api/me');

		const session = (await res.json()) as Session | null;

		return {
			user: session?.user,
		};
	},
	component: () => (
		<>
			<Outlet />
		</>
	),
});
