import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/auth')({
	component: AuthLayout,
	// TODO: not found redirect to login
	beforeLoad: ({ context: { user } }) => {
		if (user) {
			throw redirect({
				to: '/',
			});
		}
	},
});

function AuthLayout() {
	return (
		<div className="flex h-screen w-full items-center justify-center px-4">
			<Outlet />
		</div>
	);
}
