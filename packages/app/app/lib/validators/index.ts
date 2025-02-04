import type { InferInput } from 'valibot';
import { addDays, endOfDay, startOfDay } from 'date-fns';
import { date, fallback, number, object } from 'valibot';

export function getDefaultRangeFrom() {
	return startOfDay(addDays(new Date(), -7));
}

export function getDefaultRangeTo() {
	return endOfDay(new Date());
}

export const RangeSchema = object({
	// TODO: From should be before to, and both should be in the past
	from: fallback(date(), () => startOfDay(addDays(new Date(), -7))),
	to: fallback(date(), () => endOfDay(new Date())),
});

export type Range = InferInput<typeof RangeSchema>;

export const PaginationSchema = object({
	pageSize: number(),
	pageIndex: number(),
});
