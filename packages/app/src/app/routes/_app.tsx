import { Sidebar } from '@/components/Sidebar';
import { TimeRangeContextProvider } from '@/components/TimeRangeContext';
import { TopNav } from '@/components/TopNav';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { fallback, zodSearchValidator } from '@tanstack/router-zod-adapter';
import { addDays, endOfDay, startOfDay } from 'date-fns';
import { z } from 'zod';

const timeRangeSchema = z.object({
	from: fallback(z.coerce.date(), startOfDay(addDays(new Date(), -7))).default(
		() => startOfDay(addDays(new Date(), -7)),
	),
	to: fallback(z.coerce.date(), endOfDay(new Date())).default(() =>
		endOfDay(new Date()),
	),
});

export const Route = createFileRoute('/_app')({
	component: AppLayout,
	validateSearch: zodSearchValidator(timeRangeSchema),
});

function AppLayout() {
	return (
		<TimeRangeContextProvider>
			<div className="flex min-h-screen w-full flex-col bg-muted/40">
				<Sidebar />
				<div className="flex min-h-screen flex-col sm:gap-4 sm:py-4 sm:pl-14">
					<TopNav />

					<main className="grid min-h-full flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
						<Outlet />
					</main>
				</div>
			</div>
		</TimeRangeContextProvider>
	);
}
