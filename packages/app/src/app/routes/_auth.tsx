import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth')({
	component: () => <Outlet />,
	// TODO: not found redirect to login
});
