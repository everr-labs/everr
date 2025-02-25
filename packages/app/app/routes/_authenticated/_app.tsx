import { TimeRangeContextProvider } from '@/components/TimeRangeContext';
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/_app')({
	component: AppLayout,
});

function AppLayout() {
	return (
		<TimeRangeContextProvider>
			<Outlet />
		</TimeRangeContextProvider>
	);
}
