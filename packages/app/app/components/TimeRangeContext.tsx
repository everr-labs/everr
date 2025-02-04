import type { Range } from '@/lib/validators';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';

const routeApi = getRouteApi('/_authenticated/_app');

const TimeRangeContext = createContext<{
	range: Range;
	setRange: (range: Range) => void;
} | null>(null);

interface Props {
	children: ReactNode;
}
export function TimeRangeContextProvider({ children }: Props) {
	const routeSearch = routeApi.useSearch();
	// TODO: maybe this could be the current route instead?
	const navigate = useNavigate({ from: '/' });

	const [range, applyRange] = useState<Range>(routeSearch);

	const setRange = useCallback(
		(range: Range) => {
			void navigate({ search: range });
			applyRange(range);
		},
		[navigate],
	);

	return (
		<TimeRangeContext.Provider value={{ range, setRange }}>
			{children}
		</TimeRangeContext.Provider>
	);
}

export function useTimeRange() {
	const value = useContext(TimeRangeContext);

	if (!value) {
		throw new Error('useTimeRange must be used within a TimeRangeContext');
	}

	return value;
}
