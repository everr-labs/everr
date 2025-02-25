import type { RangeOutput } from '@/lib/validators';
import type { ReactNode } from 'react';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from 'react';
import { getDefaultRangeFrom, getDefaultRangeTo } from '@/lib/validators';
import { useNavigate, useSearch } from '@tanstack/react-router';

const TimeRangeContext = createContext<{
	range: RangeOutput;
	setRange: (range: RangeOutput) => void;
} | null>(null);

interface Props {
	children: ReactNode;
}
// TODO: Fix the type errors in here, it all looks a bit weird
export function TimeRangeContextProvider({ children }: Props) {
	const routeSearch = useSearch({
		strict: false,
		select(state) {
			return {
				from: state.from ?? getDefaultRangeFrom(),
				to: state.to ?? getDefaultRangeTo(),
			};
		},
	});

	const navigate = useNavigate({ from: '/' });

	const [range, applyRange] = useState<RangeOutput>(routeSearch);

	const setRange = useCallback(
		(range: RangeOutput) => {
			void navigate({ search: range });
			applyRange(range);
		},
		[navigate],
	);

	useEffect(() => {
		applyRange(routeSearch);
	}, [routeSearch]);

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
