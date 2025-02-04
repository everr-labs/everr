import { TimeRangeContextProvider } from '@/components/TimeRangeContext';
import {
	getDefaultRangeFrom,
	getDefaultRangeTo,
	RangeSchema,
} from '@/lib/validators';
import {
	createFileRoute,
	Outlet,
	retainSearchParams,
	stripSearchParams,
} from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/_app')({
	component: AppLayout,
	validateSearch: RangeSchema,
	search: {
		middlewares: [
			retainSearchParams(['from', 'to']),
			// TODO: check this, we should strip from and to if they are the default values
			stripSearchParams({
				from: getDefaultRangeFrom(),
				to: getDefaultRangeTo(),
			}),
		],
	},
});

function AppLayout() {
	return (
		<TimeRangeContextProvider>
			<Outlet />
		</TimeRangeContextProvider>
	);
}
