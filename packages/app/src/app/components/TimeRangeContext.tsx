import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import { routeApi } from '@/utils/routeApi';
import { useNavigate } from '@tanstack/react-router';

interface Range {
	from: Date;
	to: Date;
}

const TimeRangeContext = createContext<{
	range: Range;
	setRange: (range: Range) => void;
} | null>(null);

export function TimeRangeContextProvider({
	children,
}: {
	children: ReactNode;
}) {
	const routeSearch = routeApi.useSearch();
	const navigate = useNavigate({ from: '/' });

	const [range, applyRange] = useState<Range>(routeSearch);

	const setRange = useCallback(
		(range: Range) => {
			navigate({ to: '/', search: range }).catch(console.error);
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
